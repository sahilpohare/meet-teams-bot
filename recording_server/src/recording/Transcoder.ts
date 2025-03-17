import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import { MEETING_CONSTANTS } from '../state-machine/constants'
import { RecordingMode } from '../types'
import { PathManager } from '../utils/PathManager'
import { S3Uploader } from '../utils/S3Uploader'
import { VideoChunkProcessor } from './VideoChunkProcessor'


export interface TranscoderConfig {
    chunkDuration: number
    transcribeDuration: number
    outputPath: string
    bucketName: string
    s3Path: string
    audioBucketName: string
    recordingMode: RecordingMode
    audioOutputPath?: string
    tempVideoPath?: string
}

export class Transcoder extends EventEmitter {
    private static readonly FFMPEG_CLOSE_TIMEOUT: number = 60_000
    private static readonly FASTSTART_TIMEOUT: number = 30_000

    // Configuration
    private config: TranscoderConfig

    // Composants essentiels
    private pathManager: PathManager | null = null
    private videoProcessor: VideoChunkProcessor
    private s3Uploader: S3Uploader
    
    private processedChunks: number = 0

    // Streams de sortie
    private ffmpegProcess: ChildProcess | null = null

    // États
    private isRecording: boolean = false
    private isPaused: boolean = false
    private isStopped: boolean = false
    private isConfigured: boolean = false
    private isAudioOnly: boolean = false

    // Nouveau processus pour l'extraction audio en parallèle
    private audioFfmpegProcess: ChildProcess | null = null

    constructor(initialConfig: Partial<TranscoderConfig>) {
        super()
        this.setMaxListeners(20)

        this.config = {
            chunkDuration: MEETING_CONSTANTS.CHUNK_DURATION,
            transcribeDuration:
                MEETING_CONSTANTS.CHUNKS_PER_TRANSCRIPTION *
                MEETING_CONSTANTS.CHUNK_DURATION,
            outputPath: '',
            bucketName:
                initialConfig.bucketName ||
                process.env.AWS_S3_VIDEO_BUCKET ||
                '',
            audioBucketName: process.env.AWS_S3_TEMPORARY_AUDIO_BUCKET || '',
            s3Path: '',
            recordingMode: initialConfig.recordingMode || 'speaker_view',
        }

        // Vérifier si on est en mode audio-only
        this.isAudioOnly = this.config.recordingMode === 'audio_only'

        this.initializeComponents()
        this.setupEventListeners()
    }

    private initializeComponents(): void {
        this.videoProcessor = new VideoChunkProcessor(this.config)
        this.s3Uploader = new S3Uploader()
        
    }

    public configure(
        pathManager: PathManager,
        recordingMode?: RecordingMode,
    ): void {
        if (!pathManager) {
            throw new Error('PathManager is required for configuration')
        }

        this.pathManager = pathManager

        // Mettre à jour le mode d'enregistrement si fourni
        if (recordingMode) {
            this.config.recordingMode = recordingMode
            this.isAudioOnly = recordingMode === 'audio_only'
        }

        // Ajuster l'extension du fichier de sortie selon le mode
        if (this.isAudioOnly) {
            // Utiliser WAV au lieu de MP3 pour l'audio
            this.config.outputPath = pathManager.getOutputPath() + '.wav'
        } else {
            // Mode vidéo normal
            this.config.outputPath = pathManager.getOutputPath() + '.mp4'
            // Ajouter un chemin pour le fichier audio WAV
            this.config.audioOutputPath = pathManager.getOutputPath() + '.wav'
        }

        const { bucketName, s3Path } = pathManager.getS3Paths()
        this.config.bucketName = bucketName
        this.config.s3Path = s3Path

        this.videoProcessor.updateConfig(this.config)
        this.isConfigured = true

        console.log('Transcoder configured:', {
            outputPath: this.config.outputPath,
            audioOutputPath: this.config.audioOutputPath,
            webmPath: this.pathManager.getWebmPath(),
            s3Path: this.config.s3Path,
            recordingMode: this.config.recordingMode,
            isAudioOnly: this.isAudioOnly,
        })
    }

    private validateStartConditions(): void {
        if (
            !this.isConfigured ||
            !this.pathManager
        ) {
            throw new Error(
                'Transcoder must be configured with PathManager before starting'
            )
        }

        if (this.isRecording) {
            throw new Error('Transcoder is already running')
        }

        // Valider l'extension du fichier en fonction du mode
        if (this.isAudioOnly) {
            if (!this.config.outputPath.endsWith('.wav')) {
                throw new Error(
                    'Output path must have .wav extension in audio-only mode',
                )
            }
        } else {
            if (!this.config.outputPath.endsWith('.mp4')) {
                throw new Error(
                    'Output path must have .mp4 extension in video mode',
                )
            }
            if (!this.config.audioOutputPath?.endsWith('.wav')) {
                throw new Error(
                    'Audio output path must have .wav extension',
                )
            }
        }
    }

    public async start(): Promise<void> {
        this.validateStartConditions()
        try {
            await this.pathManager!.ensureDirectories()
            
            if (this.isAudioOnly) {
                // En mode audio, on écrit directement en WAV
                await this.startFFmpeg()
            } else {
                // En mode vidéo, on écrit dans un fichier MP4 temporaire
                const tempVideoPath = this.config.outputPath + '.temp'
                this.config.tempVideoPath = tempVideoPath
                
                // Arguments FFmpeg pour écrire directement en MP4 et WAV simultanément
                const ffmpegArgs = [
                    '-i', 'pipe:0',
                    // Sortie MP4
                    '-map', '0',
                    '-c:v', 'copy',
                    '-c:a', 'aac',
                    '-b:a', '128k',
                    '-f', 'mp4',
                    '-movflags', '+frag_keyframe+empty_moov+separate_moof+omit_tfhd_offset+default_base_moof',
                    tempVideoPath,
                    // Sortie WAV simultanée
                    '-map', '0:a',
                    '-c:a', 'pcm_s16le',
                    '-ac', '1',
                    '-ar', '16000',
                    '-f', 'wav',
                    this.config.audioOutputPath
                ]

                this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
                    stdio: ['pipe', 'inherit', 'inherit'],
                })

                this.setupFFmpegListeners()
            }

            this.isRecording = true
            this.emit('started', {
                outputPath: this.config.outputPath,
                isAudioOnly: this.isAudioOnly,
            })
        } catch (error) {
            this.emit('error', { type: 'startError', error })
            throw error
        }
    }

    // Gestion des chunks - identique pour audio et vidéo
    public async uploadChunk(
        chunk: Buffer,
        isFinal: boolean = false,
    ): Promise<void> {
        if (!this.isReadyForChunks()) return

        try {
            // On n'écrit plus dans le WebM, seulement dans FFmpeg
            await this.writeToFFmpeg(chunk)

            await this.videoProcessor.processChunk(chunk, isFinal)
            if (isFinal) await this.stop()
            this.processedChunks++
        } catch (error) {
            console.error('Error processing chunk:', error)
            this.emit('error', { type: 'chunkError', error })
            throw error
        }
    }

    public async stop(): Promise<void> {
        if (this.isStopped) return

        try {
            // Finaliser le traitement des chunks
            await this.videoProcessor.finalize()

            // Fermer les flux
            await this.stopAllStreams()

            if (!this.isAudioOnly) {
                // Optimiser la vidéo en copiant le fichier temporaire vers le fichier final
                await this.finalizeVideo()
            }

            await this.uploadToS3()

            this.isRecording = false
            this.isStopped = true
            this.emit('stopped')
        } catch (error) {
            console.error('Error stopping transcoder:', error)
            throw error
        }
    }

    // Gestion des événements - identique pour audio et vidéo
    private setupEventListeners(): void {
        this.videoProcessor.on('error', (error) => {
            this.emit('error', { type: 'processorError', error })
        })
    }

    // Helpers d'état - identique pour audio et vidéo
    private isReadyForChunks(): boolean {
        if (this.isStopped || !this.isRecording) {
            console.log('Cannot process chunk: transcoder not ready')
            return false
        }
        return true
    }

    private async stopAllStreams(): Promise<void> {
        const closePromises = []

        if (this.ffmpegProcess) {
            closePromises.push(this.stopFFmpeg())
        }
        
        if (this.audioFfmpegProcess) {
            closePromises.push(this.stopAudioFFmpeg())
        }

        await Promise.all(closePromises)
    }

    public async pause(): Promise<void> {
        if (!this.canPause()) return

        await this.videoProcessor.pause()
        this.isPaused = true
        this.emit('paused')
    }

    public async resume(): Promise<void> {
        if (!this.canResume()) return

        await this.videoProcessor.resume()
        this.isPaused = false
        this.emit('resumed')
    }

    private canPause(): boolean {
        return this.isRecording && !this.isPaused
    }

    private canResume(): boolean {
        return this.isRecording && this.isPaused
    }

    private async startFFmpeg(): Promise<void> {
        let ffmpegArgs: string[] = []

        if (this.isAudioOnly) {
            // Configuration pour l'extraction audio WAV
            ffmpegArgs = [
                '-i',
                'pipe:0', // Entrée depuis stdin
                '-vn', // Pas de vidéo
                '-acodec',
                'pcm_s16le', // Codec WAV
                '-ac',
                '1', // Mono
                '-ar',
                '16000', // 16kHz
                '-f',
                'wav', // Format WAV
                '-y', // Écraser le fichier existant
                this.config.outputPath,
            ]
        } else {
            // Configuration MP4 standard (inchangée)
            ffmpegArgs = [
                '-i',
                'pipe:0',
                '-c:v',
                'copy',
                '-c:a',
                'aac',
                '-b:a',
                '128k',
                '-strict',
                'experimental',
                '-f',
                'mp4',
                '-movflags',
                '+frag_keyframe+empty_moov+faststart',
                '-y',
                this.config.outputPath,
            ]
            
            // Démarrer un second processus FFmpeg pour l'extraction audio
            this.startAudioExtraction();
        }

        this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['pipe', 'inherit', 'inherit'],
        })

        this.setupFFmpegListeners()

        console.log('Started FFmpeg process:', {
            isAudioOnly: this.isAudioOnly,
            outputPath: this.config.outputPath,
        })
    }

    private setupFFmpegListeners(): void {
        if (!this.ffmpegProcess) return

        this.ffmpegProcess.on('error', (error) => {
            console.error('FFmpeg process error:', error)
            this.emit('error', { type: 'ffmpegError', error })
        })

        this.ffmpegProcess.on('close', (code) => {
            if (code !== 0) {
                this.emit('error', {
                    type: 'ffmpegClose',
                    error: new Error(`FFmpeg exited with code ${code}`),
                })
            }
        })
    }

    private async writeToFFmpeg(chunk: Buffer): Promise<void> {
        if (!this.ffmpegProcess?.stdin) {
            throw new Error('FFmpeg stdin not available')
        }

        return new Promise<void>((resolve, reject) => {
            const stdin = this.ffmpegProcess!.stdin!

            const onDrain = () => {
                cleanup()
                resolve()
            }

            const onError = (error: Error) => {
                cleanup()
                reject(error)
            }

            const cleanup = () => {
                stdin.removeListener('drain', onDrain)
                stdin.removeListener('error', onError)
            }

            stdin.once('drain', onDrain)
            stdin.once('error', onError)

            const canContinue = stdin.write(chunk)
            if (canContinue) {
                cleanup()
                resolve()
            }
        })
    }

    private async stopFFmpeg(): Promise<void> {
        if (!this.ffmpegProcess) return

        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.ffmpegProcess) {
                    this.ffmpegProcess.kill('SIGTERM')
                    reject(new Error('FFmpeg stop timeout'))
                }
            }, Transcoder.FFMPEG_CLOSE_TIMEOUT)

            this.ffmpegProcess.on('close', () => {
                clearTimeout(timeout)
                this.ffmpegProcess = null
                resolve()
            })

            if (this.ffmpegProcess.stdin) {
                this.ffmpegProcess.stdin.end()
            }
        })
    }

    private async finalizeVideo(): Promise<void> {
        if (!this.config.tempVideoPath) return

        return new Promise<void>((resolve, reject) => {
            const fastStartProcess = spawn('ffmpeg', [
                '-i', this.config.tempVideoPath,
                '-c', 'copy',
                '-movflags', '+faststart',
                this.config.outputPath
            ])

            const timeout = setTimeout(() => {
                fastStartProcess.kill('SIGTERM')
                reject(new Error('Faststart optimization timeout'))
            }, Transcoder.FASTSTART_TIMEOUT)

            fastStartProcess.on('close', async (code) => {
                clearTimeout(timeout)
                if (code === 0) {
                    try {
                        // Supprimer le fichier temporaire
                        await fs.promises.unlink(this.config.tempVideoPath)
                        resolve()
                    } catch (error) {
                        reject(error)
                    }
                } else {
                    // En cas d'erreur lors de l'optimisation, on garde le fichier temporaire comme backup
                    try {
                        await fs.promises.rename(this.config.tempVideoPath, this.config.outputPath)
                        resolve()
                    } catch (error) {
                        reject(error)
                    }
                }
            })
        })
    }

    public async uploadToS3(): Promise<string[]> {
        if (!this.pathManager)
            return Promise.reject(new Error('PathManager not configured'))

        const uploadPromises: Promise<string>[] = [];
        const filesToDelete: string[] = [];

        if (this.isAudioOnly) {
            // Upload WAV seulement
            const localPath = this.config.outputPath;
            const s3Key = `${this.config.s3Path}.wav`;
            
            console.log('Uploading audio to S3:', {
                localPath,
                bucketName: this.config.bucketName,
                s3Key,
            });
            
            uploadPromises.push(
                this.s3Uploader.uploadFile(
                    localPath,
                    this.config.bucketName,
                    s3Key,
                )
            );
            filesToDelete.push(localPath);
        } else {
            // Upload MP4
            const videoLocalPath = this.config.outputPath;
            const videoS3Key = `${this.config.s3Path}.mp4`;
            
            console.log('Uploading video to S3:', {
                localPath: videoLocalPath,
                bucketName: this.config.bucketName,
                s3Key: videoS3Key,
            });
            
            uploadPromises.push(
                this.s3Uploader.uploadFile(
                    videoLocalPath,
                    this.config.bucketName,
                    videoS3Key,
                )
            );
            filesToDelete.push(videoLocalPath);
            
            // Upload WAV
            if (this.config.audioOutputPath) {
                const audioLocalPath = this.config.audioOutputPath;
                const audioS3Key = `${this.config.s3Path}.wav`;
                
                console.log('Uploading audio to S3:', {
                    localPath: audioLocalPath,
                    bucketName: this.config.bucketName,
                    s3Key: audioS3Key,
                });
                
                uploadPromises.push(
                    this.s3Uploader.uploadFile(
                        audioLocalPath,
                        this.config.bucketName,
                        audioS3Key,
                    )
                );
                filesToDelete.push(audioLocalPath);
            }
        }

        try {
            // Attendre que tous les uploads soient terminés
            const uploadResults = await Promise.all(uploadPromises);
            
            // Supprimer les fichiers locaux
            await Promise.all(filesToDelete.map(async (filePath) => {
                try {
                    await fs.promises.unlink(filePath);
                    console.log(`Deleted local file: ${filePath}`);
                } catch (error) {
                    console.error(`Error deleting file ${filePath}:`, error);
                }
            }));

            return uploadResults;
        } catch (error) {
            console.error('Error during S3 upload:', error);
            throw error;
        }
    }

    // Nouveau processus pour l'extraction audio en parallèle
    private async startAudioExtraction(): Promise<void> {
        if (this.isAudioOnly || !this.config.audioOutputPath) return;
        
        const webmPath = this.pathManager!.getWebmPath();
        
        const audioArgs = [
            '-i',
            webmPath,
            '-vn',
            '-acodec',
            'pcm_s16le',
            '-ac',
            '1',
            '-ar',
            '16000',
            '-f',
            'wav',
            '-y',
            this.config.audioOutputPath,
        ];
        
        this.audioFfmpegProcess = spawn('ffmpeg', audioArgs, {
            stdio: ['ignore', 'inherit', 'inherit'],
        });
        
        this.audioFfmpegProcess.on('error', (error) => {
            console.error('Audio extraction FFmpeg process error:', error);
            this.emit('error', { type: 'audioFfmpegError', error });
        });
        
        this.audioFfmpegProcess.on('close', (code) => {
            if (code !== 0 && !this.isStopped) { // On ignore l'erreur si on a arrêté volontairement
                this.emit('error', {
                    type: 'audioFfmpegClose',
                    error: new Error(`Audio extraction FFmpeg exited with code ${code}`),
                });
            } else {
                console.log('Audio extraction completed successfully');
            }
        });
        
        console.log('Started audio extraction process:', {
            outputPath: this.config.audioOutputPath,
        });
    }

    private async stopAudioFFmpeg(): Promise<void> {
        if (!this.audioFfmpegProcess) return;

        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.audioFfmpegProcess) {
                    this.audioFfmpegProcess.kill('SIGTERM');
                    reject(new Error('Audio FFmpeg stop timeout'));
                }
            }, Transcoder.FFMPEG_CLOSE_TIMEOUT);

            this.audioFfmpegProcess.on('close', () => {
                clearTimeout(timeout);
                this.audioFfmpegProcess = null;
                resolve();
            });

            this.audioFfmpegProcess.kill('SIGINT');
        });
    }

    public getStatus(): {
        isRecording: boolean
        isPaused: boolean
        isStopped: boolean
        chunksProcessed: number
        isConfigured: boolean
        isAudioOnly: boolean
    } {
        return {
            isRecording: this.isRecording,
            isPaused: this.isPaused,
            isStopped: this.isStopped,
            chunksProcessed: this.processedChunks,
            isConfigured: this.isConfigured,
            isAudioOnly: this.isAudioOnly,
        }
    }
}

// Instance globale unique
export const TRANSCODER = new Transcoder({
    chunkDuration: MEETING_CONSTANTS.CHUNK_DURATION,
    transcribeDuration:
        MEETING_CONSTANTS.CHUNKS_PER_TRANSCRIPTION *
        MEETING_CONSTANTS.CHUNK_DURATION,
    bucketName: process.env.AWS_S3_VIDEO_BUCKET || '',
    audioBucketName: process.env.AWS_S3_TEMPORARY_AUDIO_BUCKET || '',
})
