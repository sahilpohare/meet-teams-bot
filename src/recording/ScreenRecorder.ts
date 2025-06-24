import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as fs from 'fs'
import * as path from 'path'
import { Streaming } from '../streaming'

import { Page } from 'playwright'
import { GLOBAL } from '../singleton'
import { calculateVideoOffset } from '../utils/CalculVideoOffset'
import { PathManager } from '../utils/PathManager'
import { S3Uploader } from '../utils/S3Uploader'
import { sleep } from '../utils/sleep'
import { generateSyncSignal } from '../utils/SyncSignal'

const TRANSCRIPTION_CHUNK_DURATION = 3600
const GRACE_PERIOD_SECONDS = 3
const STREAMING_SAMPLE_RATE = 24_000
const FLASH_SCREEN_SLEEP_TIME = 5000
const SCREENSHOT_PERIOD = 2 // every 2 seconds
interface ScreenRecordingConfig {
    display: string
    audioDevice?: string
}

export class ScreenRecorder extends EventEmitter {
    private ffmpegProcess: ChildProcess | null = null
    private outputPath: string = ''
    private audioOutputPath: string = ''
    private config: ScreenRecordingConfig
    private isRecording: boolean = false
    private filesUploaded: boolean = false
    private recordingStartTime: number = 0
    private meetingStartTime: number = 0
    private gracePeriodActive: boolean = false

    constructor(config: Partial<ScreenRecordingConfig> = {}) {
        super()

        this.config = {
            display: ':99',
            audioDevice: 'pulse',
            ...config,
        }
    }

    private generateOutputPaths(): void {
        if (GLOBAL.get().recording_mode === 'audio_only') {
            this.audioOutputPath =
                PathManager.getInstance().getOutputPath() + '.wav'
        } else {
            this.outputPath = PathManager.getInstance().getOutputPath() + '.mp4'
            this.audioOutputPath =
                PathManager.getInstance().getOutputPath() + '.wav'
        }
    }

    public setMeetingStartTime(startTime: number): void {
        this.meetingStartTime = startTime
    }

    public async startRecording(page: Page): Promise<void> {
        if (this.isRecording) {
            throw new Error('Recording is already in progress')
        }

        this.generateOutputPaths()

        try {
            const ffmpegArgs = this.buildNativeFFmpegArgs()

            this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
                stdio: ['pipe', 'pipe', 'pipe'],
            })

            this.isRecording = true
            this.recordingStartTime = Date.now()
            this.gracePeriodActive = false
            this.setupProcessMonitoring()
            this.setupStreamingAudio()

            await sleep(FLASH_SCREEN_SLEEP_TIME)
            await generateSyncSignal(page)

            console.log('Native recording started successfully')
            this.emit('started', {
                outputPath: this.outputPath,
                isAudioOnly: GLOBAL.get().recording_mode === 'audio_only',
            })
        } catch (error) {
            console.error('Failed to start native recording:', error)
            this.isRecording = false
            this.emit('error', { type: 'startError', error })
            throw error
        }
    }

    private buildNativeFFmpegArgs(): string[] {
        const args: string[] = []

        console.log(
            '🛠️ Building FFmpeg args for separate audio/video recording...',
        )

        const screenshotsPath = PathManager.getInstance().getScreenshotsPath()
        const timestamp = Date.now()
        const screenshotPattern = path.join(
            screenshotsPath,
            `${timestamp}_%4d.png`,
        )

        if (GLOBAL.get().recording_mode === 'audio_only') {
            // Audio-only recording with screenshots
            const tempDir = PathManager.getInstance().getTempPath()
            const rawAudioPath = path.join(tempDir, 'raw.wav')

            args.push(
                // === AUDIO INPUT ===
                '-f',
                'pulse',
                '-i',
                'virtual_speaker.monitor',

                // === VIDEO INPUT FOR SCREENSHOTS ===
                '-f',
                'x11grab',
                '-video_size',
                '1280x880',
                '-framerate',
                '30',
                '-i',
                this.config.display,

                // === OUTPUT 1: RAW AUDIO ===
                '-map',
                '0:a:0',
                '-acodec',
                'pcm_s16le',
                '-ac',
                '1',
                '-ar',
                '16000',
                '-avoid_negative_ts',
                'make_zero',
                '-f',
                'wav',
                '-y',
                rawAudioPath,

                // === OUTPUT 2: SCREENSHOTS (every 2 seconds) ===
                '-map',
                '1:v:0',
                '-vf',
                `fps=${1 / SCREENSHOT_PERIOD},crop=1280:720:0:160`,
                '-f',
                'image2',
                '-y',
                screenshotPattern,

                // === OUTPUT 3: STREAMING AUDIO ===
                '-map',
                '0:a:0',
                '-acodec',
                'pcm_f32le',
                '-ac',
                '1',
                '-ar',
                STREAMING_SAMPLE_RATE.toString(),
                '-f',
                'f32le',
                'pipe:1',
            )
        } else {
            // Separate audio and video recording
            const tempDir = PathManager.getInstance().getTempPath()
            const rawVideoPath = path.join(tempDir, 'raw.mp4')
            const rawAudioPath = path.join(tempDir, 'raw.wav')

            args.push(
                // === VIDEO INPUT ===
                '-f',
                'x11grab',
                '-video_size',
                '1280x880',
                '-framerate',
                '30',
                '-i',
                this.config.display,

                // === AUDIO INPUT ===
                '-f',
                'pulse',
                '-i',
                'virtual_speaker.monitor',

                // === OUTPUT 1: RAW VIDEO (no audio) ===
                '-map',
                '0:v:0',
                '-c:v',
                'libx264',
                '-preset',
                'fast',
                '-crf',
                '23',
                '-profile:v',
                'main',
                '-level',
                '4.0',
                '-pix_fmt',
                'yuv420p',
                '-vf',
                'crop=1280:720:0:160',
                '-avoid_negative_ts',
                'make_zero',
                '-f',
                'mp4',
                '-y',
                rawVideoPath,

                // === OUTPUT 2: RAW AUDIO ===
                '-map',
                '1:a:0',
                '-vn',
                '-acodec',
                'pcm_s16le',
                '-ac',
                '1',
                '-ar',
                '16000',
                '-avoid_negative_ts',
                'make_zero',
                '-f',
                'wav',
                '-y',
                rawAudioPath,

                // === OUTPUT 3: SCREENSHOTS (every 2 seconds) ===
                '-map',
                '0:v:0',
                '-vf',
                `fps=${1 / SCREENSHOT_PERIOD},crop=1280:720:0:160`,
                '-f',
                'image2',
                '-y',
                screenshotPattern,

                // === OUTPUT 4: STREAMING AUDIO ===
                '-map',
                '1:a:0',
                '-acodec',
                'pcm_f32le',
                '-ac',
                '1',
                '-ar',
                STREAMING_SAMPLE_RATE.toString(),
                '-f',
                'f32le',
                'pipe:1',
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

    private setupStreamingAudio(): void {
        if (!Streaming.instance || !this.ffmpegProcess) return

        try {
            this.ffmpegProcess.stdout?.on('data', (data: Buffer) => {
                if (Streaming.instance) {
                    const float32Array = new Float32Array(
                        data.buffer,
                        data.byteOffset,
                        data.length / 4,
                    )
                    Streaming.instance.processAudioChunk(float32Array)
                }
            })
        } catch (error) {
            console.error('Failed to setup streaming audio:', error)
        }
    }

    private async uploadAudioChunks(
        chunksDir: string,
        botUuid: string,
    ): Promise<void> {
        if (!S3Uploader.getInstance()) return

        const files = fs.readdirSync(chunksDir)
        const chunkFiles = files.filter(
            (file) => file.startsWith(`${botUuid}-`) && file.endsWith('.wav'),
        )

        console.log(`📤 Uploading ${chunkFiles.length} audio chunks...`)

        for (const filename of chunkFiles) {
            const chunkPath = path.join(chunksDir, filename)

            if (!fs.existsSync(chunkPath)) {
                console.warn(`Chunk file not found: ${chunkPath}`)
                continue
            }

            try {
                const stats = fs.statSync(chunkPath)
                if (stats.size === 0) {
                    console.warn(`Chunk file is empty: ${filename}`)
                    continue
                }

                const s3Key = `${botUuid}/${filename}`
                console.log(
                    `📤 Uploading chunk: ${filename} (${stats.size} bytes)`,
                )

                await S3Uploader.getInstance().uploadFile(
                    chunkPath,
                    GLOBAL.get().aws_s3_temporary_audio_bucket,
                    s3Key,
                    [],
                    true,
                )

                console.log(`✅ Chunk uploaded: ${filename}`)
            } catch (error) {
                console.error(`Failed to upload chunk ${filename}:`, error)
            }
        }
    }

    public async uploadToS3(): Promise<void> {
        if (this.filesUploaded || !S3Uploader.getInstance()) {
            return
        }

        const identifier = PathManager.getInstance().getIdentifier()

        if (fs.existsSync(this.audioOutputPath)) {
            console.log(
                `📤 Uploading WAV audio to video bucket: ${GLOBAL.get().remote?.aws_s3_video_bucket}`,
            )
            await S3Uploader.getInstance().uploadFile(
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
            await S3Uploader.getInstance().uploadFile(
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

        const gracePeriodMs = GRACE_PERIOD_SECONDS * 1000

        // Wait for grace period to allow clean ending
        console.log(
            `⏳ Grace period: ${GRACE_PERIOD_SECONDS}s for clean ending`,
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
        gracePeriodActive: boolean
        recordingDurationMs: number
    } {
        return {
            isRecording: this.isRecording,
            gracePeriodActive: this.gracePeriodActive,
            recordingDurationMs:
                this.recordingStartTime > 0
                    ? Date.now() - this.recordingStartTime
                    : 0,
        }
    }

    private async handleSuccessfulRecording(): Promise<void> {
        console.log('Native recording completed')

        // Sync and merge separate audio/video files
        await this.syncAndMergeFiles()

        // Auto-upload if not serverless and wait for completion
        if (!GLOBAL.isServerless()) {
            try {
                await this.uploadToS3()
                console.log('✅ Upload completed successfully')
            } catch (error) {
                console.error('❌ Upload failed:', error)
            }
        }
    }

    private async syncAndMergeFiles(): Promise<void> {
        if (GLOBAL.get().recording_mode === 'audio_only') {
            // Audio-only mode: just copy raw audio to final output
            const tempDir = PathManager.getInstance().getTempPath()
            const rawAudioPath = path.join(tempDir, 'raw.wav')

            console.log('🔄 Processing audio-only recording...')

            if (fs.existsSync(rawAudioPath)) {
                // Copy raw audio to final output location
                fs.copyFileSync(rawAudioPath, this.audioOutputPath)
                console.log(`✅ Audio copied to: ${this.audioOutputPath}`)

                // Create audio chunks from the final audio file
                await this.createAudioChunks(this.audioOutputPath)
            } else {
                console.error('❌ Raw audio file not found:', rawAudioPath)
            }

            console.log('✅ Audio-only processing completed')
            return
        }

        // Video mode: full sync and merge process
        const tempDir = PathManager.getInstance().getTempPath()
        const rawVideoPath = path.join(tempDir, 'raw.mp4')
        const rawAudioPath = path.join(tempDir, 'raw.wav')

        console.log('🔄 Starting post-recording sync and merge...')

        // 1. Calculate sync offset (using your existing calculation)
        const syncResult = await calculateVideoOffset(
            rawAudioPath,
            rawVideoPath,
        )
        console.log(
            `🎯 Calculated sync offset: ${syncResult.offsetSeconds.toFixed(3)}s`,
        )

        // 2. Trim video and audio with offset
        const trimmedVideoPath = path.join(tempDir, 'trimmed.mp4')
        const trimmedAudioPath = path.join(tempDir, 'trimmed.wav')

        //DONT TUCH FOOD CLALCULATION
        const calcOffsetVideo =
            syncResult.videoTimestamp +
            (this.meetingStartTime -
                this.recordingStartTime -
                FLASH_SCREEN_SLEEP_TIME) /
                1000
        const calcOffsetAudio =
            syncResult.audioTimestamp +
            (this.meetingStartTime -
                this.recordingStartTime -
                FLASH_SCREEN_SLEEP_TIME) /
                1000

        await this.trimFromOffset(
            rawVideoPath,
            trimmedVideoPath,
            calcOffsetVideo,
        )
        await this.trimFromOffset(
            rawAudioPath,
            trimmedAudioPath,
            calcOffsetAudio,
        )

        // 3. Get durations to find shortest
        const videoDuration = await this.getDuration(trimmedVideoPath)
        const audioDuration = await this.getDuration(trimmedAudioPath)
        const shortestDuration = Math.min(videoDuration, audioDuration)

        console.log(`📊 Video duration: ${videoDuration.toFixed(2)}s`)
        console.log(`📊 Audio duration: ${audioDuration.toFixed(2)}s`)
        console.log(
            `📊 Using shortest duration: ${shortestDuration.toFixed(2)}s`,
        )

        // 4. Merge with shortest duration as reference
        await this.mergeWithShortestDuration(
            trimmedVideoPath,
            trimmedAudioPath,
            shortestDuration,
        )

        // 5. Copy trimmed audio to final output location
        fs.copyFileSync(trimmedAudioPath, this.audioOutputPath)
        console.log(`✅ Audio copied to: ${this.audioOutputPath}`)

        // 6. Create audio chunks from trimmed audio (not final audio)
        await this.createAudioChunks(trimmedAudioPath)

        // 7. Cleanup temporary files (keep trimmed audio for chunks)
        await this.cleanupTempFiles([
            rawVideoPath,
            rawAudioPath,
            trimmedVideoPath,
        ])

        console.log('✅ Sync and merge completed successfully')
    }

    private async mergeWithShortestDuration(
        videoPath: string,
        audioPath: string,
        duration: number,
    ): Promise<void> {
        const args = [
            '-i',
            videoPath,
            '-i',
            audioPath,
            '-c:v',
            'copy',
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            '-shortest',
            '-t',
            duration.toString(),
            '-avoid_negative_ts',
            'make_zero',
            '-y',
            this.outputPath,
        ]

        console.log(
            `🎬 Merging video and audio (duration: ${duration.toFixed(2)}s)`,
        )
        await this.runFFmpeg(args)
    }

    private async createAudioChunks(audioPath: string): Promise<void> {
        if (!GLOBAL.get().speech_to_text_provider) return

        const chunksDir = PathManager.getInstance().getAudioTmpPath()
        if (!fs.existsSync(chunksDir)) {
            fs.mkdirSync(chunksDir, { recursive: true })
        }

        // Get audio duration
        const duration = await this.getDuration(audioPath)
        const botUuid = GLOBAL.get().bot_uuid

        // Calculate chunk duration (max 1 hour = 3600 seconds)
        const chunkDuration = Math.min(duration, TRANSCRIPTION_CHUNK_DURATION)
        const chunkPattern = path.join(chunksDir, `${botUuid}-%d.wav`)

        const args = [
            '-i',
            audioPath,
            '-acodec',
            'pcm_s16le',
            '-ac',
            '1',
            '-ar',
            '16000',
            '-f',
            'segment',
            '-segment_time',
            chunkDuration.toString(),
            '-segment_format',
            'wav',
            '-y',
            chunkPattern,
        ]

        console.log(
            `🎵 Creating audio chunks (${chunkDuration}s each) from ${duration.toFixed(1)}s audio`,
        )
        await this.runFFmpeg(args)

        // Upload created chunks
        await this.uploadAudioChunks(chunksDir, botUuid)
    }

    private async getDuration(filePath: string): Promise<number> {
        const args = [
            '-v',
            'quiet',
            '-show_entries',
            'format=duration',
            '-of',
            'csv=p=0',
            filePath,
        ]
        const result = await this.runFFprobe(args)
        return parseFloat(result.trim())
    }

    private async cleanupTempFiles(filePaths: string[]): Promise<void> {
        // for (const filePath of filePaths) {
        //     if (fs.existsSync(filePath)) {
        //         fs.unlinkSync(filePath)
        //         console.log(`🗑️ Cleaned up: ${path.basename(filePath)}`)
        //     }
        // }
    }

    private async runFFmpeg(args: string[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const process = spawn('ffmpeg', args)

            process.on('close', (code) => {
                if (code === 0) {
                    resolve()
                } else {
                    reject(new Error(`FFmpeg failed with code ${code}`))
                }
            })

            process.on('error', (error) => {
                reject(error)
            })
        })
    }

    private async runFFprobe(args: string[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const process = spawn('ffprobe', args)
            let output = ''

            process.stdout?.on('data', (data) => {
                output += data.toString()
            })

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(output)
                } else {
                    reject(new Error(`FFprobe failed with code ${code}`))
                }
            })

            process.on('error', (error) => {
                reject(error)
            })
        })
    }

    private async trimFromOffset(
        inputPath: string,
        outputPath: string,
        offset: number,
    ): Promise<void> {
        const args = [
            '-i',
            inputPath,
            '-ss',
            offset.toString(),
            '-avoid_negative_ts',
            'make_zero',
            '-y',
            outputPath,
        ]

        console.log(
            `✂️ Trimming from offset ${offset.toFixed(3)}s: ${path.basename(inputPath)}`,
        )
        await this.runFFmpeg(args)
    }
}

export class ScreenRecorderManager {
    private static instance: ScreenRecorder

    public static getInstance(): ScreenRecorder {
        if (!ScreenRecorderManager.instance) {
            ScreenRecorderManager.instance = new ScreenRecorder()
        }
        return ScreenRecorderManager.instance
    }
}
