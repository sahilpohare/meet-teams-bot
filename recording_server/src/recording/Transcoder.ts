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
    private static readonly FFMPEG_CLOSE_TIMEOUT: number = 60_000; // 60 seconds
    private static readonly FASTSTART_TIMEOUT: number = 30_000; // 30 seconds

    private ffmpegProcess: ChildProcess | null = null;
    private videoProcessor: VideoChunkProcessor;
    private audioExtractor: AudioExtractor;
    private pathManager: PathManager;
    private s3Uploader: S3Uploader;
    
    private isRecording: boolean = false;
    private isPaused: boolean = false;
    private isStopped: boolean = false;
    private chunkReceivedCounter: number = 0;

    constructor(private config: TranscoderConfig) {
        super();
        this.pathManager = PathManager.getInstance();
        this.videoProcessor = new VideoChunkProcessor(config);
        this.audioExtractor = new AudioExtractor();
        this.s3Uploader = new S3Uploader();
        this.setupEventListeners();
    }

    public async start(): Promise<void> {
        if (this.isRecording) {
            throw new Error('Transcoder is already running');
        }

        try {
            // Initialiser les chemins et dossiers nécessaires
            await this.pathManager.ensureDirectories();

            // Démarrer FFmpeg
            await this.startFFmpeg();

            this.isRecording = true;
            this.emit('started');
        } catch (error) {
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
        if (this.isStopped) {
            console.log('Transcoder is in stopped state');
            return;
        }

        if (!this.ffmpegProcess) {
            throw new Error('Transcoder not initialized');
        }

        try {
            this.chunkReceivedCounter++;
            await this.videoProcessor.processChunk(chunk, isFinal);

            if (isFinal) {
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
        const options: FFmpegProcessOptions = {
            outputPath: this.config.outputPath,
            logLevel: 'verbose',
            audioOptions: {
                codec: 'aac',
                bitrate: '128k'
            }
        };

        const ffmpegArgs = this.buildFFmpegArgs(options);

        this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['pipe', 'inherit', 'inherit']
        });

        this.ffmpegProcess.on('error', (error) => {
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

    private buildFFmpegArgs(options: FFmpegProcessOptions): string[] {
        return [
            '-i', 'pipe:0',                              // Input from pipe
            '-c:v', 'copy',                              // Copy video codec
            '-c:a', options.audioOptions?.codec || 'aac', // Audio codec
            '-b:a', options.audioOptions?.bitrate || '128k', // Audio bitrate
            '-movflags', '+frag_keyframe+empty_moov',    // Streaming optimizations
            '-y',                                        // Overwrite output
            options.outputPath,                          // Output path
            '-loglevel', options.logLevel || 'verbose'   // Log level
        ];
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

// Supprimer l'instance globale et la remplacer par une factory
export function createTranscoder(botUuid: string): Transcoder {
    const pathManager = PathManager.getInstance();
    pathManager.setBotUuid(botUuid);
    
    return new Transcoder({
        chunkDuration: MEETING_CONSTANTS.CHUNK_DURATION,
        transcribeDuration: MEETING_CONSTANTS.TRANSCRIBE_DURATION,
        outputPath: pathManager.getVideoPath(),
        bucketName: process.env.AWS_S3_VIDEO_BUCKET || '',
        s3Path: pathManager.getVideoPath()
    });
}