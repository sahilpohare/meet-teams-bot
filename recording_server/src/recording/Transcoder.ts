import { ChildProcess, spawn } from 'child_process';
import { EventEmitter } from 'events';
import { MEETING_CONSTANTS } from '../state-machine/constants';
import { PathManager } from '../utils/PathManager';
import { S3Uploader } from '../utils/S3Uploader';
import { AudioExtractor } from './AudioExtractor';
import { VideoChunkProcessor } from './VideoChunkProcessor';

export interface TranscoderConfig {
    chunkDuration: number;
    transcribeDuration: number;
    outputPath: string;
    bucketName: string;
    s3Path: string;
}

interface FFmpegProcessOptions {
    outputPath: string;
    logLevel?: string;
    audioOptions?: {
        codec: string;
        bitrate: string;
    };
}

export class Transcoder extends EventEmitter {
    private static readonly FFMPEG_CLOSE_TIMEOUT: number = 60_000;
    private static readonly FASTSTART_TIMEOUT: number = 30_000;

    private ffmpegProcess: ChildProcess | null = null;
    private videoProcessor: VideoChunkProcessor;
    private audioExtractor: AudioExtractor;
    private s3Uploader: S3Uploader;
    private pathManager: PathManager | null = null; // Initialisé à null
    
    private isRecording: boolean = false;
    private isPaused: boolean = false;
    private isStopped: boolean = false;
    private chunkReceivedCounter: number = 0;
    private isConfigured: boolean = false; // Nouveau flag pour vérifier la configuration

    private config: TranscoderConfig;

    constructor(initialConfig: Partial<TranscoderConfig>) {
        super();
        this.config = {
            chunkDuration: initialConfig.chunkDuration || MEETING_CONSTANTS.CHUNK_DURATION,
            transcribeDuration: initialConfig.transcribeDuration || MEETING_CONSTANTS.TRANSCRIBE_DURATION,
            outputPath: '',
            bucketName: initialConfig.bucketName || process.env.AWS_S3_VIDEO_BUCKET || '',
            s3Path: ''
        };

        this.videoProcessor = new VideoChunkProcessor(this.config);
        this.audioExtractor = new AudioExtractor();
        this.s3Uploader = new S3Uploader();
        this.setupEventListeners();
    }

    public configure(pathManager: PathManager): void {
        if (!pathManager) {
            throw new Error('PathManager is required for configuration');
        }
        this.pathManager = pathManager;
        this.config.outputPath = pathManager.getVideoPath();
        const { bucketName, s3Path } = pathManager.getS3Paths();
        this.config.bucketName = bucketName;
        this.config.s3Path = s3Path;
        this.videoProcessor.updateConfig(this.config);
        this.isConfigured = true;

        console.log('Transcoder configured with paths:', {
            outputPath: this.config.outputPath,
            webmPath: this.pathManager.getWebmPath(),
            s3Path: this.config.s3Path
        });
    }

    public async start(): Promise<void> {
        if (!this.isConfigured || !this.pathManager) {
            throw new Error('Transcoder must be configured with PathManager before starting');
        }

        if (this.isRecording) {
            throw new Error('Transcoder is already running');
        }

        try {
            // S'assurer que les répertoires existent
            await this.pathManager.ensureDirectories();
            
            // Log les chemins importants
            console.log('Starting transcoder with paths:', {
                outputPath: this.config.outputPath,
                webmPath: this.pathManager.getWebmPath()
            });

            // Démarrer FFmpeg
            await this.startFFmpeg();
            
            this.isRecording = true;
            this.emit('started', {
                timestamp: Date.now(),
                outputPath: this.config.outputPath
            });

        } catch (error) {
            console.error('Failed to start transcoder:', error);
            this.emit('error', { type: 'startError', error });
            throw error;
        }
    }

    public async stop(): Promise<void> {
        if (this.isStopped || !this.isRecording) {
            return;
        }

        try {
            // Arrêter le processeur vidéo
            await this.videoProcessor.finalize();

            // Arrêter FFmpeg proprement
            await this.stopFFmpeg();

            // Optimiser la vidéo pour le streaming
            await this.optimizeVideo();

            this.isRecording = false;
            this.isStopped = true;
            this.emit('stopped');
        } catch (error) {
            this.emit('error', { type: 'stopError', error });
            throw error;
        }
    }

    public async pause(): Promise<void> {
        if (!this.isRecording || this.isPaused) return;

        try {
            await this.videoProcessor.pause();
            this.isPaused = true;
            this.emit('paused');
        } catch (error) {
            this.emit('error', { type: 'pauseError', error });
            throw error;
        }
    }

    public async resume(): Promise<void> {
        if (!this.isRecording || !this.isPaused) return;

        try {
            await this.videoProcessor.resume();
            this.isPaused = false;
            this.emit('resumed');
        } catch (error) {
            this.emit('error', { type: 'resumeError', error });
            throw error;
        }
    }

    public async uploadChunk(chunk: Buffer, isFinal: boolean = false): Promise<void> {
        console.log('Transcoder receiving chunk:', {
            size: chunk.length,
            isFinal,
            isRecording: this.isRecording,
            isPaused: this.isPaused
        });
    
        if (this.isStopped) {
            console.log('Transcoder is in stopped state');
            return;
        }
    
        if (!this.ffmpegProcess) {
            throw new Error('Transcoder not initialized');
        }
    
        try {
            this.chunkReceivedCounter++;
            console.log(`Processing chunk #${this.chunkReceivedCounter}`);
    
            await this.videoProcessor.processChunk(chunk, isFinal);
    
            if (isFinal) {
                console.log('Processing final chunk');
                await this.videoProcessor.finalize();
            }
        } catch (error) {
            console.error('Error processing chunk:', error);
            throw error;
        }
    }

    public async extractAudio(
        startTime: number,
        endTime: number,
    ): Promise<string> {
        try {
            const audioUrl = await this.audioExtractor.extract(
                startTime,
                endTime,
                this.config.bucketName,
                `${this.config.s3Path}/audio`
            );
            return audioUrl;
        } catch (error) {
            this.emit('error', { type: 'audioExtractionError', error });
            throw error;
        }
    }

    private async startFFmpeg(): Promise<void> {
        const outputPath = this.config.outputPath;
        
        console.log('Starting FFmpeg with output path:', outputPath);
    
        // Vérifier que le chemin de sortie a une extension
        if (!outputPath.endsWith('.mp4')) {
            throw new Error('Output path must have .mp4 extension');
        }
    
        const ffmpegArgs = [
            '-i', 'pipe:0',                // Input from pipe
            '-c:v', 'copy',                // Copy video codec
            '-c:a', 'aac',                 // Convert audio to AAC
            '-b:a', '128k',                // Audio bitrate
            '-strict', 'experimental',      // Allow experimental codecs
            '-f', 'mp4',                   // Force MP4 format
            '-movflags', '+frag_keyframe+empty_moov+faststart', // Optimizations
            '-y',                          // Overwrite output
            outputPath
        ];
    
        console.log('FFmpeg command:', ffmpegArgs.join(' '));
    
        this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['pipe', 'inherit', 'inherit']
        });
    
        this.ffmpegProcess.on('error', (error) => {
            console.error('FFmpeg process error:', error);
            this.emit('error', { type: 'ffmpegError', error });
        });
    
        this.ffmpegProcess.on('close', (code) => {
            console.log('FFmpeg process closed with code:', code);
            if (code !== 0) {
                this.emit('error', { 
                    type: 'ffmpegClose',
                    error: new Error(`FFmpeg exited with code ${code}`)
                });
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

            // Fermer proprement stdin
            if (this.ffmpegProcess.stdin) {
                this.ffmpegProcess.stdin.end();
            }
        });
    }

    private async optimizeVideo(): Promise<void> {
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
                        await this.pathManager.moveFile(tempPath, this.config.outputPath);
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

    private setupEventListeners(): void {
        this.videoProcessor.on('chunkReady', async ({ chunk }) => {
            try {
                await this.writeToFFmpeg(chunk);
            } catch (error) {
                this.emit('error', { type: 'writeError', error });
            }
        });

        this.videoProcessor.on('error', (error) => {
            this.emit('error', { type: 'processorError', error });
        });

        this.audioExtractor.on('error', (error) => {
            this.emit('error', { type: 'audioError', error });
        });
    }

    private async writeToFFmpeg(chunk: Buffer): Promise<void> {
        if (!this.ffmpegProcess?.stdin) {
            throw new Error('FFmpeg stdin not available');
        }

        return new Promise<void>((resolve, reject) => {
            const canContinue = this.ffmpegProcess!.stdin!.write(chunk);
            
            if (canContinue) {
                resolve();
            } else {
                this.ffmpegProcess!.stdin!.once('drain', resolve);
                this.ffmpegProcess!.stdin!.once('error', reject);
            }
        });
    }

    public async uploadVideoToS3(): Promise<void> {
        try {
            await this.s3Uploader.uploadFile(
                this.config.outputPath,
                this.config.bucketName,
                this.config.s3Path
            );
        } catch (error) {
            this.emit('error', { type: 's3UploadError', error });
            throw error;
        }
    }

    public getStatus(): {
        isRecording: boolean;
        isPaused: boolean;
        isStopped: boolean;
        chunksProcessed: number;
    } {
        return {
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            isStopped: this.isStopped,
            chunksProcessed: this.chunkReceivedCounter
        };
    }
}

// Création d'une instance globale unique
export const TRANSCODER = new Transcoder({
    chunkDuration: MEETING_CONSTANTS.CHUNK_DURATION,      // 10 secondes par chunk
    transcribeDuration: MEETING_CONSTANTS.TRANSCRIBE_DURATION, // 3 minutes de transcription
    bucketName: process.env.AWS_S3_VIDEO_BUCKET || '',
});