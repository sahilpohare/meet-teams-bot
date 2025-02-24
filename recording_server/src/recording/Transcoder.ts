import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import { MEETING_CONSTANTS } from '../state-machine/constants';
import { TranscriptionSegment, TranscriptionService } from '../transcription/TranscriptionService';
import { PathManager } from '../utils/PathManager';
import { S3Uploader } from '../utils/S3Uploader';
import { AudioExtractor } from './AudioExtractor';
import { VideoChunkProcessor } from './VideoChunkProcessor';
import { TranscriptionStateManager } from './transcription-state-manager';

export interface TranscoderConfig {
    chunkDuration: number;
    transcribeDuration: number;
    outputPath: string;
    bucketName: string;
    s3Path: string;
    audioBucketName: string;
}

export class Transcoder extends EventEmitter {
    private static readonly FFMPEG_CLOSE_TIMEOUT: number = 60_000;
    private static readonly FASTSTART_TIMEOUT: number = 30_000;

    // Configuration
    private config: TranscoderConfig;

    // Composants essentiels
    private pathManager: PathManager | null = null;
    private videoProcessor: VideoChunkProcessor;
    private audioExtractor: AudioExtractor;
    private s3Uploader: S3Uploader;
    private transcriptionState: TranscriptionStateManager;
    private processedChunks: number = 0;

    private transcriptionService: TranscriptionService;
    
    // Streams de sortie
    private ffmpegProcess: ChildProcess | null = null;
    private webmWriteStream: fs.WriteStream | null = null;

    // États
    private isRecording: boolean = false;
    private isPaused: boolean = false;
    private isStopped: boolean = false;
    private isConfigured: boolean = false;

    constructor(initialConfig: Partial<TranscoderConfig>) {
        super();
        this.setMaxListeners(20);
        
        this.config = {
            chunkDuration: MEETING_CONSTANTS.CHUNK_DURATION,
            transcribeDuration: MEETING_CONSTANTS.CHUNKS_PER_TRANSCRIPTION * MEETING_CONSTANTS.CHUNK_DURATION,
            outputPath: '',
            bucketName: initialConfig.bucketName || process.env.AWS_S3_VIDEO_BUCKET || '',
            audioBucketName: process.env.AWS_S3_TEMPORARY_AUDIO_BUCKET || '',
            s3Path: ''
        };

        this.initializeComponents();
        this.setupEventListeners();
    }

    private initializeComponents(): void {
        this.videoProcessor = new VideoChunkProcessor(this.config);
        this.audioExtractor = new AudioExtractor();
        this.s3Uploader = new S3Uploader();
        this.transcriptionState = new TranscriptionStateManager();
    }

    public configure(pathManager: PathManager, transcriptionService: TranscriptionService): void {
        if (!pathManager) {
            throw new Error('PathManager is required for configuration');
        }
        if (!transcriptionService) {
            throw new Error('TranscriptionService is required for configuration');
        }

        this.pathManager = pathManager;
        this.transcriptionService = transcriptionService;

        this.config.outputPath = pathManager.getVideoPath();
        const { bucketName, s3Path } = pathManager.getS3Paths();
        this.config.bucketName = bucketName;
        this.config.s3Path = s3Path;
        
        this.videoProcessor.updateConfig(this.config);
        this.isConfigured = true;

        console.log('Transcoder configured:', {
            outputPath: this.config.outputPath,
            webmPath: this.pathManager.getWebmPath(),
            s3Path: this.config.s3Path,
            hasTranscriptionService: !!this.transcriptionService
        });
    }

    private validateStartConditions(): void {
        if (!this.isConfigured || !this.pathManager || !this.transcriptionService) {
            throw new Error('Transcoder must be configured with PathManager and TranscriptionService before starting');
        }

        if (this.isRecording) {
            throw new Error('Transcoder is already running');
        }

        if (!this.config.outputPath.endsWith('.mp4')) {
            throw new Error('Output path must have .mp4 extension');
        }
    }

    public async start(): Promise<void> {
        this.validateStartConditions();
        try {
            await this.pathManager!.ensureDirectories();
            await Promise.all([
                this.startFFmpeg(),
                this.startWebmStream()
            ]);
            
            this.isRecording = true;
            this.emit('started', {
                outputPath: this.config.outputPath
            });
        } catch (error) {
            this.emit('error', { type: 'startError', error });
            throw error;
        }
    }
    
    // Gestion des chunks
    public async uploadChunk(chunk: Buffer, isFinal: boolean = false): Promise<void> {
        if (!this.isReadyForChunks()) return;
    
        try {
            await Promise.all([
                this.writeToFFmpeg(chunk),
                this.writeToWebm(chunk)
            ]);
    
            await this.videoProcessor.processChunk(chunk, isFinal);
            if (isFinal) await this.stop();
            this.processedChunks++;
        } catch (error) {
            this.emit('error', { type: 'chunkError', error });
            throw error;
        }
    }
    
    // Gestion de la transcription
    private async processTranscriptionSegment(segment: TranscriptionSegment): Promise<void> {
        if (!this.transcriptionService) {
            throw new Error('TranscriptionService not configured');
        }
    
        try {
            const audioUrl = await this.audioExtractor.extract(
                segment.startTime,
                segment.endTime,
                this.config.audioBucketName,  // Utiliser le bucket audio temporaire
                `${this.config.s3Path}`
            );
    
            await this.transcriptionService.transcribeSegment(
                segment.startTime,
                segment.endTime,
                audioUrl
            );
        } catch (error) {
            console.error('Error processing transcription:', error);
            this.emit('error', { type: 'transcriptionError', error });
        }
    }

    public async stop(): Promise<void> {
        if (this.isStopped) return;

        try {
            // Finaliser le traitement des chunks
            await this.videoProcessor.finalize();

            // Vérifier s'il reste un segment à transcrire
            const finalSegment = this.transcriptionState.finalize();
            if (finalSegment) {
                await this.processTranscriptionSegment(finalSegment);
            }

            // Fermer les flux
            await this.stopAllStreams();
            await this.optimizeVideo();
            await this.uploadVideoToS3();

            this.isRecording = false;
            this.isStopped = true;
            this.emit('stopped');
        } catch (error) {
            console.error('Error stopping transcoder:', error);
            throw error;
        }
    }
    
    // Gestion des événements
    private setupEventListeners(): void {
        this.videoProcessor.on('chunkProcessed', async ({ metadata }) => {
            const segment = this.transcriptionState.addChunk(metadata.timestamp);
            if (segment) {
                try {
                    await this.processTranscriptionSegment(segment);
                } catch (error) {
                    console.error('Error handling transcription segment:', error);
                    this.emit('error', { type: 'transcriptionError', error });
                }
            }
        });
       
        this.videoProcessor.on('error', (error) => {
            this.emit('error', { type: 'processorError', error });
        });
    }
    
    // Helpers d'état
    private isReadyForChunks(): boolean {
        if (this.isStopped || !this.isRecording) {
            console.log('Cannot process chunk: transcoder not ready');
            return false;
        }
        return true;
    }

    private async stopAllStreams(): Promise<void> {
        const closePromises = [];
        
        if (this.webmWriteStream) {
            closePromises.push(new Promise<void>(resolve => {
                this.webmWriteStream!.end(() => resolve());
            }));
        }
        
        if (this.ffmpegProcess) {
            closePromises.push(this.stopFFmpeg());
        }
    
        await Promise.all(closePromises);
    }

    public async pause(): Promise<void> {
        if (!this.canPause()) return;
        
        await this.videoProcessor.pause();
        this.isPaused = true;
        this.emit('paused');
    }
    
    public async resume(): Promise<void> {
        if (!this.canResume()) return;
        
        await this.videoProcessor.resume();
        this.isPaused = false;
        this.emit('resumed');
    }
    
    private canPause(): boolean {
        return this.isRecording && !this.isPaused;
    }
    
    private canResume(): boolean {
        return this.isRecording && this.isPaused;
    }

    private async startWebmStream(): Promise<void> {
        const webmPath = this.pathManager!.getWebmPath();
        this.webmWriteStream = fs.createWriteStream(webmPath);
        
        console.log('Started WebM stream:', { path: webmPath });
    }

    private async startFFmpeg(): Promise<void> {
        const ffmpegArgs = [
            '-i', 'pipe:0',
            '-c:v', 'copy',
            '-c:a', 'aac',
            '-b:a', '128k',
            '-strict', 'experimental',
            '-f', 'mp4',
            '-movflags', '+frag_keyframe+empty_moov+faststart',
            '-y',
            this.config.outputPath
        ];

        this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['pipe', 'inherit', 'inherit']
        });

        this.setupFFmpegListeners();
    }

    private setupFFmpegListeners(): void {
        if (!this.ffmpegProcess) return;

        this.ffmpegProcess.on('error', (error) => {
            console.error('FFmpeg process error:', error);
            this.emit('error', { type: 'ffmpegError', error });
        });

        this.ffmpegProcess.on('close', (code) => {
            if (code !== 0) {
                this.emit('error', { 
                    type: 'ffmpegClose',
                    error: new Error(`FFmpeg exited with code ${code}`)
                });
            }
        });
    }

    private async writeToFFmpeg(chunk: Buffer): Promise<void> {
        if (!this.ffmpegProcess?.stdin) {
            throw new Error('FFmpeg stdin not available');
        }

        return new Promise<void>((resolve, reject) => {
            const stdin = this.ffmpegProcess!.stdin!;
            
            const onDrain = () => {
                cleanup();
                resolve();
            };
            
            const onError = (error: Error) => {
                cleanup();
                reject(error);
            };

            const cleanup = () => {
                stdin.removeListener('drain', onDrain);
                stdin.removeListener('error', onError);
            };

            stdin.once('drain', onDrain);
            stdin.once('error', onError);

            const canContinue = stdin.write(chunk);
            if (canContinue) {
                cleanup();
                resolve();
            }
        });
    }

    private async writeToWebm(chunk: Buffer): Promise<void> {
        if (!this.webmWriteStream) {
            throw new Error('WebM write stream not available');
        }

        return new Promise<void>((resolve, reject) => {
            const canContinue = this.webmWriteStream!.write(chunk);
            if (canContinue) {
                resolve();
            } else {
                this.webmWriteStream!.once('drain', resolve);
                this.webmWriteStream!.once('error', reject);
            }
        });
    }

    private async stopFFmpeg(): Promise<void> {
        if (!this.ffmpegProcess) return;

        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.ffmpegProcess) {
                    this.ffmpegProcess.kill('SIGTERM');
                    reject(new Error('FFmpeg stop timeout'));
                }
            }, Transcoder.FFMPEG_CLOSE_TIMEOUT);

            this.ffmpegProcess.on('close', () => {
                clearTimeout(timeout);
                this.ffmpegProcess = null;
                resolve();
            });

            if (this.ffmpegProcess.stdin) {
                this.ffmpegProcess.stdin.end();
            }
        });
    }

    private async optimizeVideo(): Promise<void> {
        if (!this.pathManager) return;

        const tempPath = `${this.config.outputPath}_temp.mp4`;
        
        return new Promise<void>((resolve, reject) => {
            const fastStartProcess = spawn('ffmpeg', [
                '-i', this.config.outputPath,
                '-c', 'copy',
                '-movflags', '+faststart',
                tempPath
            ]);

            const timeout = setTimeout(() => {
                fastStartProcess.kill('SIGTERM');
                reject(new Error('Faststart optimization timeout'));
            }, Transcoder.FASTSTART_TIMEOUT);

            fastStartProcess.on('close', async (code) => {
                clearTimeout(timeout);
                if (code === 0) {
                    try {
                        await this.pathManager!.moveFile(tempPath, this.config.outputPath);
                        resolve();
                    } catch (error) {
                        reject(error);
                    }
                } else {
                    reject(new Error(`Faststart process failed with code ${code}`));
                }
            });
        });
    }

    public async uploadVideoToS3(): Promise<string> {
        if (!this.pathManager) return Promise.reject(new Error('PathManager not configured'));
        console.log('Uploading video to S3:', this.pathManager.getVideoPath(), this.config.bucketName, this.config.s3Path);
        return this.s3Uploader.uploadFile(this.pathManager.getVideoPath(), this.config.bucketName, this.config.s3Path + '.mp4');
    }

    public getStatus(): {
        isRecording: boolean;
        isPaused: boolean;
        isStopped: boolean;
        chunksProcessed: number;
        isConfigured: boolean;
    } {
        return {
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            isStopped: this.isStopped,
            chunksProcessed: this.processedChunks,
            isConfigured: this.isConfigured
        };
    }
}

// Instance globale unique
export const TRANSCODER = new Transcoder({
    chunkDuration: MEETING_CONSTANTS.CHUNK_DURATION,
    transcribeDuration: MEETING_CONSTANTS.CHUNKS_PER_TRANSCRIPTION * MEETING_CONSTANTS.CHUNK_DURATION,
    bucketName: process.env.AWS_S3_VIDEO_BUCKET || '',
    audioBucketName: process.env.AWS_S3_TEMPORARY_AUDIO_BUCKET || ''
});











    