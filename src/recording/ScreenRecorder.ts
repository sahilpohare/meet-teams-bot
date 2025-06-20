import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import { Streaming } from '../streaming'

import { RecordingMode } from '../types'
import { PathManager } from '../utils/PathManager'
import { S3Uploader } from '../utils/S3Uploader'
import { SyncCalibrator } from './SyncCalibrator'
import { GLOBAL } from '../singleton'

interface ScreenRecordingConfig {
    display: string
    audioDevice?: string
    outputFormat: 'webm' | 'mp4'
    videoCodec: 'libx264' | 'libvpx-vp9' | 'libvpx'
    audioCodec: 'aac' | 'opus' | 'libmp3lame'
    width: number
    height: number
    framerate: number
    audioBitrate: string
    videoBitrate: string
    recordingMode?: RecordingMode
    enableTranscriptionChunking?: boolean
    transcriptionChunkDuration?: number
    s3Path?: string
    // Grace period settings for clean endings
    gracePeriodSeconds?: number
    trimEndSeconds?: number
}

export class ScreenRecorder extends EventEmitter {
    private ffmpegProcess: ChildProcess | null = null
    private chunkWatcher: fs.FSWatcher | null = null
    private streamingProcess: ChildProcess | null = null
    private outputPath: string = ''
    private audioOutputPath: string = ''
    private config: ScreenRecordingConfig
    private s3Uploader: S3Uploader | null = null
    private isConfigured: boolean = false
    private isRecording: boolean = false
    private filesUploaded: boolean = false
    private recordingStartTime: number = 0
    private syncCalibrator: SyncCalibrator
    private pathManager: PathManager | null = null
    private page: any = null
    private gracePeriodActive: boolean = false

    constructor(config: Partial<ScreenRecordingConfig> = {}) {
        super()

        this.config = {
            display: process.env.DISPLAY || ':99',
            audioDevice: 'pulse',
            outputFormat: 'mp4',
            videoCodec: 'libx264',
            audioCodec: 'aac',
            width: 1280,
            height: 720,
            framerate: 30,
            audioBitrate: '128k',
            videoBitrate: '1000k',
            recordingMode: 'speaker_view',
            enableTranscriptionChunking: false,
            transcriptionChunkDuration: 3600,
            s3Path: '',
            // Default grace period: 3s recording + 2s trim = clean ending
            gracePeriodSeconds: 3,
            trimEndSeconds: 2,
            ...config,
        }

        this.syncCalibrator = new SyncCalibrator()

        if (!GLOBAL.isServerless()) {
            this.s3Uploader = S3Uploader.getInstance()
        }

        console.log('Native ScreenRecorder initialized:', {
            recordingMode: this.config.recordingMode,
            enableTranscriptionChunking:
                this.config.enableTranscriptionChunking,
        })
    }

    public configure(
        pathManager: PathManager,
        recordingMode?: RecordingMode,
    ): void {
        if (!pathManager) {
            throw new Error('PathManager is required for configuration')
        }

        this.pathManager = pathManager

        if (recordingMode) {
            this.config.recordingMode = recordingMode
        }

        // Simple transcription detection
        if (GLOBAL.get().speech_to_text_provider) {
            this.config.enableTranscriptionChunking =
                GLOBAL.get().speech_to_text_provider !== null
        }

        // Native path generation (no legacy patterns)
        this.generateOutputPaths(pathManager)

        // Simple S3 configuration
        const { s3Path } = pathManager.getS3Paths()
        this.config.s3Path = s3Path

        this.isConfigured = true

        console.log('Native ScreenRecorder configured:', {
            outputPath: this.outputPath,
            audioOutputPath: this.audioOutputPath,
            recordingMode: this.config.recordingMode,
        })
    }

    private generateOutputPaths(pathManager: PathManager): void {
        if (GLOBAL.get().recording_mode === 'audio_only') {
            this.audioOutputPath = pathManager.getOutputPath() + '.wav'
        } else {
            this.outputPath = pathManager.getOutputPath() + '.mp4'
            this.audioOutputPath = pathManager.getOutputPath() + '.wav'
        }
    }

    public setPage(page: any): void {
        this.page = page
    }

    public async startRecording(): Promise<void> {
        this.validateConfiguration()

        if (this.isRecording) {
            throw new Error('Recording is already in progress')
        }

        console.log('🎬 Starting native recording...')

        try {
            await this.ensureOutputDirectory()
            const syncOffset = await this.calculateSyncOffset()
            const ffmpegArgs = this.buildNativeFFmpegArgs(syncOffset)

            this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
                stdio: ['pipe', 'pipe', 'pipe'],
            })

            this.isRecording = true
            this.recordingStartTime = Date.now()
            this.gracePeriodActive = false
            this.setupProcessMonitoring()
            this.startNativeAudioStreaming()

            console.log('Native recording started successfully')
            this.emit('started', {
                outputPath: this.outputPath,
                isAudioOnly: this.config.recordingMode === 'audio_only',
            })
        } catch (error) {
            console.error('Failed to start native recording:', error)
            this.isRecording = false
            this.emit('error', { type: 'startError', error })
            throw error
        }
    }

    private validateConfiguration(): void {
        if (!this.isConfigured) {
            throw new Error('ScreenRecorder must be configured before starting')
        }
    }

    private async ensureOutputDirectory(): Promise<void> {
        const outputDir = path.dirname(this.outputPath)
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true })
        }
    }

    private async calculateSyncOffset(): Promise<number> {
        // Native sync calculation (simplified)
        const systemLoad = await this.getSystemLoad()
        const roughEstimate = this.estimateOffsetFromLoad(systemLoad)

        if (this.page) {
            try {
                const preciseOffset =
                    await this.syncCalibrator.quickCalibrateOnceOptimized(
                        this.page,
                    )
                if (Math.abs(preciseOffset) > 0.001) {
                    return -preciseOffset + 0.02
                }
            } catch (error) {
                console.warn(
                    'Precise calibration failed, using system estimate',
                )
            }
        }

        return roughEstimate
    }

    private buildNativeFFmpegArgs(syncOffset: number): string[] {
        const args: string[] = []
        const isAudioOnly = this.config.recordingMode === 'audio_only'

        console.log('🛠️ Building FFmpeg args for native synchronization...')
        console.log(`🎯 Applying audio offset: ${syncOffset.toFixed(3)}s`)

        if (isAudioOnly) {
            args.push(
                '-f',
                'pulse',
                '-i',
                'virtual_speaker.monitor',
                '-itsoffset',
                syncOffset.toString(),
                '-acodec',
                'pcm_s16le',
                '-ac',
                '1',
                '-ar',
                '16000',
                '-f',
                'wav',
                '-y',
                this.outputPath,
            )
        } else {
            args.push(
                // Video input - simplified and optimized
                '-f',
                'x11grab',
                '-video_size',
                '1280x880',
                '-framerate',
                '30',
                '-i',
                this.config.display,
            )

            // Audio input - auto-detect PulseAudio config
            args.push(
                '-f',
                'pulse',
                '-itsoffset',
                syncOffset.toString(),
                '-i',
                'virtual_speaker.monitor',
            )

            // **FIXED: Restore simultaneous MP4 + WAV multi-output (like working version)**
            args.push(
                // === OUTPUT 1: MP4 (video + audio) ===
                '-map',
                '0:v:0',
                '-map',
                '1:a:0',
                '-c:v',
                'libx264',
                '-preset',
                'fast', // Optimized for real-time recording
                '-crf',
                '23', // Slightly higher CRF for faster encoding
                '-tune',
                'zerolatency', // Optimize for low-latency streaming
                '-vf',
                'crop=1280:720:0:160',
                '-c:a',
                'aac',
                '-b:a',
                '160k',
                '-avoid_negative_ts',
                'make_zero',
                '-max_muxing_queue_size',
                '1024',
                '-async',
                '1',
                '-f',
                'mp4',
                '-movflags',
                '+faststart+frag_keyframe+empty_moov', // Enhanced streaming support
                this.outputPath,

                // === OUTPUT 2: WAV (simultaneous audio for transcription) ===
                '-map',
                '1:a:0',
                '-vn',
                '-acodec',
                'pcm_s16le',
                '-ac',
                '1',
                '-ar',
                '16000',
                '-async',
                '1',
                '-avoid_negative_ts',
                'make_zero',
                '-f',
                'wav',
                this.audioOutputPath,
            )

            // === OUTPUT 3: Real-time chunks (if enabled) ===
            if (this.config.enableTranscriptionChunking) {
                // Use audio_tmp directory and UUID-based naming like production
                const chunksDir = this.pathManager
                    ? this.pathManager.getAudioTmpPath()
                    : path.join(path.dirname(this.outputPath), 'audio_tmp')
                if (!fs.existsSync(chunksDir)) {
                    fs.mkdirSync(chunksDir, { recursive: true })
                }

                // Use botUuid for chunk naming format: ${botUuid}-%d.wav
                const botUuid = GLOBAL.get().bot_uuid
                const chunkPattern = path.join(chunksDir, `${botUuid}-%d.wav`)

                args.push(
                    '-map',
                    '1:a:0',
                    '-vn',
                    '-acodec',
                    'pcm_s16le',
                    '-ac',
                    '1',
                    '-ar',
                    '16000',
                    '-f',
                    'segment',
                    '-segment_time',
                    (this.config.transcriptionChunkDuration || 3600).toString(),
                    '-segment_format',
                    'wav',
                    chunkPattern,
                )

                this.startChunkMonitoring(chunksDir)
                console.log(
                    `🎯 Real-time chunks: ${this.config.transcriptionChunkDuration}s chunks enabled`,
                )
                console.log(`🎯 Chunk naming format: ${botUuid}-[index].wav`)
            }

            console.log(
                `✅ FFmpeg itsoffset parameter: ${syncOffset.toFixed(3)}s`,
            )
            console.log(
                `🎯 Simultaneous generation: MP4 + WAV during recording`,
            )
        }

        return args
    }

    private setupProcessMonitoring(): void {
        if (!this.ffmpegProcess) return

        this.ffmpegProcess.on('error', (error) => {
            console.error('FFmpeg error:', error)
            this.emit('error', error)
        })

        this.ffmpegProcess.on('exit', async (code) => {
            console.log(`FFmpeg exited with code ${code}`)

            // Consider recording successful if:
            // - Exit code 0 (normal completion)
            // - Exit code 255 or 143 (SIGINT/SIGTERM) when we're in grace period (requested shutdown)
            const isSuccessful =
                code === 0 ||
                (this.gracePeriodActive && (code === 255 || code === 143))

            if (isSuccessful) {
                console.log('✅ Recording considered successful, uploading...')
                await this.handleSuccessfulRecording()
            } else {
                console.warn(
                    `⚠️ Recording failed - unexpected exit code: ${code}`,
                )
            }

            this.isRecording = false
            this.emit('stopped')
        })

        this.ffmpegProcess.stderr?.on('data', (data) => {
            const output = data.toString()
            if (output.includes('error')) {
                console.error('FFmpeg stderr:', output.trim())
            }
        })
    }

    private startNativeAudioStreaming(): void {
        if (!Streaming.instance) return

        try {
            const STREAMING_SAMPLE_RATE = 24_000

            this.streamingProcess = spawn(
                'ffmpeg',
                [
                    '-f',
                    'pulse',
                    '-i',
                    'virtual_speaker.monitor',
                    '-acodec',
                    'pcm_f32le',
                    '-ac',
                    '1',
                    '-ar',
                    STREAMING_SAMPLE_RATE.toString(),
                    '-f',
                    'f32le',
                    'pipe:1',
                ],
                { stdio: ['pipe', 'pipe', 'pipe'] },
            )

            this.streamingProcess.stdout?.on('data', (data: Buffer) => {
                if (Streaming.instance) {
                    const float32Array = new Float32Array(
                        data.buffer,
                        data.byteOffset,
                        data.length / 4,
                    )
                    Streaming.instance.processAudioChunk(float32Array)
                }
            })

            this.ffmpegProcess?.once('exit', () => {
                if (this.streamingProcess && !this.streamingProcess.killed) {
                    this.streamingProcess.kill('SIGINT')
                }
            })
        } catch (error) {
            console.error('Failed to start native audio streaming:', error)
        }
    }

    private startChunkMonitoring(chunksDir: string): void {
        this.chunkWatcher = fs.watch(chunksDir, async (eventType, filename) => {
            if (eventType === 'rename' && filename?.endsWith('.wav')) {
                const chunkPath = path.join(chunksDir, filename)
                setTimeout(
                    () => this.verifyAndUploadChunk(chunkPath, filename),
                    5000,
                )
            }
        })
    }

    private async verifyAndUploadChunk(
        chunkPath: string,
        filename: string,
    ): Promise<void> {
        if (!this.s3Uploader || !fs.existsSync(chunkPath)) {
            console.warn(`Chunk file not found: ${chunkPath}`)
            return
        }

        try {
            // Verify the file has content before uploading
            const stats = fs.statSync(chunkPath)
            if (stats.size === 0) {
                console.warn(`Chunk file is empty, waiting longer: ${filename}`)
                // Wait additional time for FFmpeg to finish writing
                setTimeout(
                    () => this.verifyAndUploadChunk(chunkPath, filename),
                    3000,
                )
                return
            }

            // Double-check file stability (size not changing)
            await new Promise((resolve) => setTimeout(resolve, 1000))
            const newStats = fs.statSync(chunkPath)
            if (newStats.size !== stats.size) {
                console.log(`Chunk still being written, waiting: ${filename}`)
                setTimeout(
                    () => this.verifyAndUploadChunk(chunkPath, filename),
                    2000,
                )
                return
            }

            console.log(
                `📤 Uploading complete chunk: ${filename} (${stats.size} bytes)`,
            )

            const botUuid = GLOBAL.get().bot_uuid || 'unknown'
            const s3Key = `${botUuid}/${filename}`

            await this.s3Uploader.uploadFile(
                chunkPath,
                GLOBAL.get().aws_s3_temporary_audio_bucket,
                s3Key,
                [],
                true,
            )

            console.log(`✅ Chunk uploaded successfully: ${filename}`)
        } catch (error) {
            console.error(`Failed to upload chunk ${filename}:`, error)
        }
    }

    private cleanupChunkMonitoring(): void {
        if (this.chunkWatcher) {
            this.chunkWatcher.close()
            this.chunkWatcher = null
        }
    }

    /**
     * Post-process recordings to remove corrupted endings
     * Creates trimmed copies and replaces originals
     */
    private async postProcessRecordings(): Promise<void> {
        const trimSeconds = this.config.trimEndSeconds || 2
        
        console.log(
            `🔧 Post-processing: trimming last ${trimSeconds}s to remove corruption`,
        )

        try {
            if (GLOBAL.get().recording_mode === 'audio_only') {
                // Audio-only mode: trim WAV file
                await this.trimAudioFile(this.audioOutputPath, trimSeconds)
            } else {
                // Video mode: trim both MP4 and WAV files
                await Promise.all([
                    this.trimVideoFile(this.outputPath, trimSeconds),
                    this.trimAudioFile(this.audioOutputPath, trimSeconds),
                ])
            }

            console.log('✅ Post-processing completed - clean endings applied')
        } catch (error) {
            console.error(
                '⚠️ Post-processing failed, keeping original files:',
                error,
            )
        }
    }

    /**
     * Trim end of MP4 video file using FFmpeg
     */
    private async trimVideoFile(
        filePath: string,
        trimSeconds: number,
    ): Promise<void> {
        if (!fs.existsSync(filePath)) {
            console.warn(`Video file not found for trimming: ${filePath}`)
            return
        }

        const tempPath = filePath + '.trimmed.mp4'

        return new Promise((resolve, reject) => {
            // Get video duration first, then calculate trim duration
            const durationProcess = spawn('ffprobe', [
                '-v',
                'quiet',
                '-show_entries',
                'format=duration',
                '-of',
                'csv=p=0',
                filePath,
            ])

            let durationOutput = ''
            durationProcess.stdout?.on('data', (data) => {
                durationOutput += data.toString()
            })

            durationProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error('Failed to get video duration'))
                    return
                }

                const duration = parseFloat(durationOutput.trim())
                const trimmedDuration = Math.max(1, duration - trimSeconds) // Minimum 1 second

                console.log(
                    `📹 Trimming MP4: ${duration.toFixed(1)}s → ${trimmedDuration.toFixed(1)}s`,
                )

                // Trim the video
                const trimProcess = spawn('ffmpeg', [
                    '-i',
                    filePath,
                    '-t',
                    trimmedDuration.toString(),
                    '-c',
                    'copy', // Copy streams without re-encoding for speed
                    '-avoid_negative_ts',
                    'make_zero',
                    '-y',
                    tempPath,
                ])

                trimProcess.on('close', (trimCode) => {
                    if (trimCode === 0 && fs.existsSync(tempPath)) {
                        // Replace original with trimmed version
                        fs.renameSync(tempPath, filePath)
                        resolve()
                    } else {
                        // Cleanup temp file if it exists
                        if (fs.existsSync(tempPath)) {
                            fs.unlinkSync(tempPath)
                        }
                        reject(
                            new Error(
                                `FFmpeg trim failed with code ${trimCode}`,
                            ),
                        )
                    }
                })
            })
        })
    }

    /**
     * Trim end of WAV audio file using FFmpeg
     */
    private async trimAudioFile(
        filePath: string,
        trimSeconds: number,
    ): Promise<void> {
        if (!fs.existsSync(filePath)) {
            console.warn(`Audio file not found for trimming: ${filePath}`)
            return
        }

        const tempPath = filePath + '.trimmed.wav'

        return new Promise((resolve, reject) => {
            // Get audio duration first
            const durationProcess = spawn('ffprobe', [
                '-v',
                'quiet',
                '-show_entries',
                'format=duration',
                '-of',
                'csv=p=0',
                filePath,
            ])

            let durationOutput = ''
            durationProcess.stdout?.on('data', (data) => {
                durationOutput += data.toString()
            })

            durationProcess.on('close', (code) => {
                if (code !== 0) {
                    reject(new Error('Failed to get audio duration'))
                    return
                }

                const duration = parseFloat(durationOutput.trim())
                const trimmedDuration = Math.max(1, duration - trimSeconds) // Minimum 1 second

                console.log(
                    `🎵 Trimming WAV: ${duration.toFixed(1)}s → ${trimmedDuration.toFixed(1)}s`,
                )

                // Trim the audio
                const trimProcess = spawn('ffmpeg', [
                    '-i',
                    filePath,
                    '-t',
                    trimmedDuration.toString(),
                    '-c',
                    'copy', // Copy stream without re-encoding
                    '-y',
                    tempPath,
                ])

                trimProcess.on('close', (trimCode) => {
                    if (trimCode === 0 && fs.existsSync(tempPath)) {
                        // Replace original with trimmed version
                        fs.renameSync(tempPath, filePath)
                        resolve()
                    } else {
                        // Cleanup temp file if it exists
                        if (fs.existsSync(tempPath)) {
                            fs.unlinkSync(tempPath)
                        }
                        reject(
                            new Error(
                                `FFmpeg audio trim failed with code ${trimCode}`,
                            ),
                        )
                    }
                })
            })
        })
    }

    public async uploadToS3(): Promise<void> {
        if (this.filesUploaded || !this.s3Uploader) {
            return
        }

        const identifier = PathManager.getInstance().getIdentifier()

        if (fs.existsSync(this.audioOutputPath)) {
            console.log(
                `📤 Uploading WAV audio to video bucket: ${GLOBAL.get().remote?.aws_s3_video_bucket}`,
            )
            await this.s3Uploader.uploadFile(
                this.audioOutputPath,
                GLOBAL.get().remote?.aws_s3_video_bucket!,
                `${identifier}.wav`,
            )
            fs.unlinkSync(this.audioOutputPath)
        }
        if (fs.existsSync(this.outputPath)) {
            console.log(
                `📤 Uploading MP4 to video bucket: ${GLOBAL.get().remote?.aws_s3_video_bucket}`,
            )
            await this.s3Uploader.uploadFile(
                this.outputPath,
                GLOBAL.get().remote?.aws_s3_video_bucket!,
                `${identifier}.mp4`,
            )
            fs.unlinkSync(this.outputPath)
        }
        this.filesUploaded = true
    }

    public async stopRecording(): Promise<void> {
        if (!this.isRecording || !this.ffmpegProcess) {
            return
        }

        console.log('🛑 Stop recording requested - starting grace period...')
        this.gracePeriodActive = true

        const gracePeriodMs = (this.config.gracePeriodSeconds || 3) * 1000

        // Wait for grace period to allow clean ending
        console.log(
            `⏳ Grace period: ${this.config.gracePeriodSeconds}s for clean ending`,
        )

        await new Promise<void>((resolve) => {
            setTimeout(() => {
                console.log(
                    '✅ Grace period completed - stopping FFmpeg cleanly',
                )
                resolve()
            }, gracePeriodMs)
        })

        return new Promise((resolve) => {
            // Wait for the 'stopped' event instead of 'exit' to ensure upload is complete
            this.once('stopped', () => {
                this.gracePeriodActive = false
                this.ffmpegProcess = null
                resolve()
            })

            // Send graceful termination signal
            this.ffmpegProcess!.kill('SIGINT')

            // Fallback force kill after timeout
            setTimeout(() => {
                if (this.ffmpegProcess && !this.ffmpegProcess.killed) {
                    console.warn('⚠️ Force killing FFmpeg process')
                    this.ffmpegProcess.kill('SIGKILL')
                }
            }, 8000)
        })
    }

    public isCurrentlyRecording(): boolean {
        return this.isRecording
    }

    public getStatus(): {
        isRecording: boolean
        isConfigured: boolean
        filesUploaded: boolean
        gracePeriodActive: boolean
        recordingDurationMs: number
    } {
        return {
            isRecording: this.isRecording,
            isConfigured: this.isConfigured,
            filesUploaded: this.filesUploaded,
            gracePeriodActive: this.gracePeriodActive,
            recordingDurationMs:
                this.recordingStartTime > 0
                    ? Date.now() - this.recordingStartTime
                    : 0,
        }
    }

    public getFilesUploaded(): boolean {
        return this.filesUploaded
    }

    // Helper methods
    private async getSystemLoad(): Promise<number> {
        try {
            const { exec } = require('child_process')
            const { promisify } = require('util')
            const execAsync = promisify(exec)

            const { stdout } = await execAsync('uptime')
            const loadMatch = stdout.match(/load average: ([\d.]+)/)
            return loadMatch ? parseFloat(loadMatch[1]) : 0
        } catch {
            return 0
        }
    }

    private estimateOffsetFromLoad(load: number): number {
        if (load < 1.5) return -0.065
        else if (load < 2.5) return 0.0
        else return -0.05
    }

    private async handleSuccessfulRecording(): Promise<void> {
        console.log('Native recording completed')

        // Post-process files to remove corrupted endings
        await this.postProcessRecordings()

        // Auto-upload if not serverless and wait for completion
        if (!GLOBAL.isServerless()) {
            try {
                await this.uploadToS3()
                console.log('✅ Upload completed successfully')
            } catch (error) {
                console.error('❌ Upload failed:', error)
            }
        }

        this.cleanupChunkMonitoring()
    }
}

export class ScreenRecorderManager {
    private static instance: ScreenRecorder

    public static getInstance(): ScreenRecorder {
        if (!ScreenRecorderManager.instance) {
            ScreenRecorderManager.instance = new ScreenRecorder({
                recordingMode: 'speaker_view',
                enableTranscriptionChunking:
                    GLOBAL.get().speech_to_text_provider !== null,
                transcriptionChunkDuration: 3600,
                // Clean endings by default
                gracePeriodSeconds: 3,
                trimEndSeconds: 2,
            })
        }
        return ScreenRecorderManager.instance
    }
}
