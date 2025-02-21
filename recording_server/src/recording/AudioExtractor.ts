import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PathManager } from '../utils/PathManager';
import { S3Uploader } from '../utils/S3Uploader';

export interface AudioExtractionOptions {
    sampleRate?: number;      // Par défaut 16000
    channels?: number;        // Par défaut 1 (mono)
    format?: string;         // Par défaut 'wav'
    maxRetries?: number;     // Par défaut 3
    retryDelay?: number;     // Par défaut 2000ms
}

export class AudioExtractor extends EventEmitter {
    private readonly DEFAULT_OPTIONS: AudioExtractionOptions = {
        sampleRate: 16000,
        channels: 1,
        format: 'wav',
        maxRetries: 3,
        retryDelay: 2000
    };

    private readonly pathManager: PathManager;
    private readonly options: AudioExtractionOptions;
    private readonly s3Uploader: S3Uploader;

    constructor(options: AudioExtractionOptions = {}) {
        super();
        this.options = { ...this.DEFAULT_OPTIONS, ...options };
        this.pathManager = PathManager.getInstance();
        this.s3Uploader = new S3Uploader();
    }

    public async extract(
        startTime: number,
        endTime: number,
        bucketName: string,
        s3Path: string
    ): Promise<string> {
        console.log('Starting audio extraction:', { startTime, endTime, s3Path });

        const audioFileName = `audio_${startTime}_${endTime}.${this.options.format}`;
        const outputPath = path.join(os.tmpdir(), audioFileName);
        const webmPath = this.pathManager.getWebmPath();

        try {
            // Extraire l'audio
            await this.extractAudioSegment(webmPath, startTime, endTime, outputPath);
            
            // Vérifier le fichier
            await this.validateAudioFile(outputPath);

            // Upload vers S3
            const s3Url = await this.s3Uploader.uploadFile(outputPath, bucketName, s3Path);

            this.emit('extractionComplete', {
                startTime,
                endTime,
                outputPath,
                s3Url
            });

            return s3Url;

        } catch (error) {
            this.emit('error', error);
            throw error;
        } finally {
            // Nettoyage
            try {
                await fs.unlink(outputPath);
            } catch (e) {
                console.error('Error cleaning up temp file:', e);
            }
        }
    }

    private async extractAudioSegment(
        webmPath: string,
        startTime: number,
        endTime: number,
        outputPath: string
    ): Promise<void> {
        const duration = (endTime - startTime) / 1000;
        const startSeconds = startTime / 1000;

        const ffmpegArgs = [
            '-y',
            '-ss', startSeconds.toString(),
            '-i', webmPath,
            '-t', duration.toString(),
            '-map', '0:a',
            '-acodec', 'pcm_s16le',
            '-ac', this.options.channels!.toString(),
            '-ar', this.options.sampleRate!.toString(),
            outputPath
        ];

        console.log('FFmpeg extraction command:', ffmpegArgs.join(' '));

        return new Promise((resolve, reject) => {
            const process = spawn('ffmpeg', ffmpegArgs);
            let errorOutput = '';

            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
                this.emit('progress', data.toString());
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`FFmpeg failed with code ${code}: ${errorOutput}`));
                }
            });

            process.on('error', reject);
        });
    }

    private async validateAudioFile(filePath: string): Promise<void> {
        const stats = await fs.stat(filePath);
        if (stats.size <= 44) { // Taille minimale d'un fichier WAV valide
            throw new Error('Generated audio file is invalid (too small)');
        }
    }

    public async retryOperation<T>(
        operation: () => Promise<T>,
        retries: number = this.options.maxRetries!
    ): Promise<T> {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                return await operation();
            } catch (error) {
                if (attempt === retries) throw error;
                await new Promise(resolve => 
                    setTimeout(resolve, this.options.retryDelay!)
                );
                this.emit('retrying', { attempt, error });
            }
        }
        throw new Error('Retry operation failed');
    }
}