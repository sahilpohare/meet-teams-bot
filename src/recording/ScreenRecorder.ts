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
const FLASH_SCREEN_SLEEP_TIME = 4200
const SCREENSHOT_PERIOD = 5 // every 5 seconds instead of 2
const SCREENSHOT_WIDTH = 640 // reduced from 1280
const SCREENSHOT_HEIGHT = 360 // reduced from 720
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

                // === OUTPUT 2: SCREENSHOTS (every 5 seconds) ===
                '-map',
                '1:v:0',
                '-vf',
                `fps=${1 / SCREENSHOT_PERIOD},crop=${SCREENSHOT_WIDTH}:${SCREENSHOT_HEIGHT}:0:160,scale=${SCREENSHOT_WIDTH}:${SCREENSHOT_HEIGHT}`,
                '-q:v',
                '3', // High quality JPEG compression
                '-f',
                'image2',
                '-y',
                screenshotPattern.replace('.png', '.jpg'),

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
                '-bf',
                '0',
                '-refs',
                '1',
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

                // === OUTPUT 3: SCREENSHOTS (every 5 seconds) ===
                '-map',
                '0:v:0',
                '-vf',
                `fps=${1 / SCREENSHOT_PERIOD},crop=${SCREENSHOT_WIDTH}:${SCREENSHOT_HEIGHT}:0:160,scale=${SCREENSHOT_WIDTH}:${SCREENSHOT_HEIGHT}`,
                '-q:v',
                '3', // High quality JPEG compression
                '-f',
                'image2',
                '-y',
                screenshotPattern.replace('.png', '.jpg'),

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

        // Video mode: efficient sync and merge process for long recordings
        const tempDir = PathManager.getInstance().getTempPath()
        const rawVideoPath = path.join(tempDir, 'raw.mp4')
        const rawAudioPath = path.join(tempDir, 'raw.wav')

        console.log('🔄 Starting efficient sync and merge for long recording...')

        // 1. Calculate sync offset (using your existing calculation)
        const syncResult = await calculateVideoOffset(
            rawAudioPath,
            rawVideoPath,
        )
        console.log(
            `🎯 Calculated sync offset: ${syncResult.offsetSeconds.toFixed(3)}s`,
        )

        // 2. Calculate final trim points
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

        console.log(`📊 Debug values:`)
        console.log(`   syncResult.videoTimestamp: ${syncResult.videoTimestamp}s`)
        console.log(`   syncResult.audioTimestamp: ${syncResult.audioTimestamp}s`)
        console.log(`   meetingStartTime: ${this.meetingStartTime}`)
        console.log(`   recordingStartTime: ${this.recordingStartTime}`)
        console.log(`   FLASH_SCREEN_SLEEP_TIME: ${FLASH_SCREEN_SLEEP_TIME}`)
        console.log(`   Time diff: ${(this.meetingStartTime - this.recordingStartTime - FLASH_SCREEN_SLEEP_TIME) / 1000}s`)
        console.log(`📊 Video trim point: ${calcOffsetVideo.toFixed(3)}s`)
        console.log(`📊 Audio trim point: ${calcOffsetAudio.toFixed(3)}s`)

        // Safety check for unreasonable values
        if (calcOffsetVideo < 0 || calcOffsetVideo > 86400) { // 0s to 24h
            console.error(`❌ Invalid calcOffsetVideo: ${calcOffsetVideo}s - using syncResult.videoTimestamp instead`)
            const safeOffsetVideo = Math.max(0, syncResult.videoTimestamp)
            console.log(`✅ Using safe video offset: ${safeOffsetVideo}s`)
        }

        if (calcOffsetAudio < 0 || calcOffsetAudio > 86400) { // 0s to 24h  
            console.error(`❌ Invalid calcOffsetAudio: ${calcOffsetAudio}s - using syncResult.audioTimestamp instead`)
            const safeOffsetAudio = Math.max(0, syncResult.audioTimestamp)
            console.log(`✅ Using safe audio offset: ${safeOffsetAudio}s`)
        }

        // 3. Calculate audio padding needed (if video starts before audio)
        const audioPadding = Math.max(0, syncResult.videoTimestamp - syncResult.audioTimestamp)
        
        console.log(`🔇 Audio padding needed: ${audioPadding.toFixed(3)}s`)
        
        // 4. Prepare audio with padding or trimming if needed
        const processedAudioPath = path.join(tempDir, 'processed.wav')
        if (audioPadding > 0) {
            console.log(`🔇 Adding ${audioPadding.toFixed(3)}s silence to audio start (video ahead)...`)
            await this.addSilencePadding(rawAudioPath, processedAudioPath, audioPadding)
        } else if (audioPadding < 0) {
            console.log(`✂️ Trimming ${(audioPadding* -1).toFixed(3)}s from audio start (video behind)...`)
            await this.trimAudioStart(rawAudioPath, processedAudioPath, (audioPadding* -1))
        } else {
            // No padding or trimming needed, just copy
            fs.copyFileSync(rawAudioPath, processedAudioPath)
        }

        // 5. Merge video and audio (both files are now synchronized from start)
        const mergedPath = path.join(tempDir, 'merged.mp4')
        await this.mergeWithSync(
            rawVideoPath,
            processedAudioPath,
            mergedPath
        )

        // 6. Final trim to remove content before the actual start and after the end
        const videoDuration = await this.getDuration(rawVideoPath)
        const audioDuration = await this.getDuration(processedAudioPath)
        const finalDuration = Math.min(videoDuration - calcOffsetVideo, audioDuration)
        
        console.log(`📊 Final duration: ${finalDuration.toFixed(2)}s`)
        
        // Trim from calcOffsetVideo to remove the pre-meeting content
        await this.finalTrimFromOffset(mergedPath, this.outputPath, calcOffsetVideo, finalDuration)

        // 7. Extract audio from the final trimmed video (ensures perfect sync)
        await this.extractAudioFromVideo(this.outputPath, this.audioOutputPath)
        console.log(`✅ Audio extracted from final video: ${this.audioOutputPath}`)

        // 8. Create audio chunks from the extracted audio
        await this.createAudioChunks(this.audioOutputPath)

        // 9. Cleanup temporary files
        await this.cleanupTempFiles([
            rawVideoPath,
            rawAudioPath,
            processedAudioPath,
            mergedPath,
        ])

        console.log('✅ Efficient sync and merge completed successfully')
    }

    private async addSilencePadding(
        inputAudioPath: string,
        outputAudioPath: string,
        paddingSeconds: number,
    ): Promise<void> {
        const tempDir = PathManager.getInstance().getTempPath()
        const silenceFile = path.join(tempDir, 'silence.wav')
        const concatListFile = path.join(tempDir, 'concat_list.txt')
        
        // Create silence file with exact same format as input
        const silenceArgs = [
            '-f',
            'lavfi',
            '-i',
            `anullsrc=channel_layout=mono:sample_rate=16000:duration=${paddingSeconds}`,
            '-c:a',
            'pcm_s16le',
            '-ar',
            '16000',
            '-ac',
            '1',
            '-y',
            silenceFile,
        ]
        
        console.log(`🔇 Creating ${paddingSeconds.toFixed(3)}s silence file`)
        await this.runFFmpeg(silenceArgs)
        
        // Create concat list with absolute paths (no escaping needed)
        const absoluteSilencePath = path.resolve(silenceFile)
        const absoluteInputPath = path.resolve(inputAudioPath)
        
        const concatContent = `file '${absoluteSilencePath}'
file '${absoluteInputPath}'`
        
        fs.writeFileSync(concatListFile, concatContent, 'utf8')
        console.log(`📝 Created concat list:`)
        console.log(`   - ${absoluteSilencePath}`)
        console.log(`   - ${absoluteInputPath}`)
        
        // Concatenate using concat demuxer with stream copy
        const concatArgs = [
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            concatListFile,
            '-c',
            'copy',
            '-y',
            outputAudioPath,
        ]

        console.log(`🔇 Concatenating with demuxer (stream copy - no re-encoding)`)
        await this.runFFmpeg(concatArgs)
        
        // Cleanup temp files
        if (fs.existsSync(silenceFile)) {
            fs.unlinkSync(silenceFile)
        }
        if (fs.existsSync(concatListFile)) {
            fs.unlinkSync(concatListFile)
        }
    }

    private async trimAudioStart(
        inputAudioPath: string,
        outputAudioPath: string,
        trimSeconds: number,
    ): Promise<void> {
        const args = [
            '-i',
            inputAudioPath,
            '-ss',
            trimSeconds.toString(),
            '-c:a',
            'copy',
            '-avoid_negative_ts',
            'make_zero',
            '-y',
            outputAudioPath,
        ]

        console.log(`✂️ Trimming ${trimSeconds.toFixed(3)}s from audio start`)
        await this.runFFmpeg(args)
    }

    private async mergeWithSync(
        videoPath: string,
        audioPath: string,
        outputPath: string,
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
            '-avoid_negative_ts',
            'make_zero',
            '-y',
            outputPath,
        ]

        console.log(
            `🎬 Merging video and synchronized audio`,
        )
        await this.runFFmpeg(args)
    }

    private async getVideoStartTime(videoPath: string): Promise<number> {
        const args = [
            '-v',
            'quiet',
            '-show_streams',
            '-select_streams',
            'v:0',
            '-show_entries',
            'stream=start_time',
            '-of',
            'csv=p=0',
            videoPath,
        ]
        const result = await this.runFFprobe(args)
        const startTime = parseFloat(result.trim().split(',')[0])
        return isNaN(startTime) ? 0 : startTime
    }

    private async finalTrimFromOffset(
        inputPath: string,
        outputPath: string,
        calcOffset: number,
        duration: number,
    ): Promise<void> {
        // Get the actual video start time to compensate for timestamp offset
        const videoStartTime = await this.getVideoStartTime(inputPath)
        const adjustedOffset = calcOffset + videoStartTime
        
        // Simple solution: re-encode the entire trim with ultrafast for frame-perfect cutting
        const args = [
            '-i',
            inputPath,
            '-ss',
            adjustedOffset.toString(),
            '-t',
            duration.toString(),
            '-c:v',
            'libx264',
            '-preset',
            'ultrafast',
            '-crf',
            '18',
            '-c:a',
            'aac',
            '-b:a',
            '160k',
            '-movflags',
            '+faststart',
            '-avoid_negative_ts',
            'make_zero',
            '-y',
            outputPath,
        ]

        console.log(`✂️ Final trim: re-encoding ${duration.toFixed(2)}s from ${adjustedOffset.toFixed(3)}s (ultrafast, no freeze guaranteed)`)
        await this.runFFmpeg(args)
    }

    private async extractAudioFromVideo(videoPath: string, audioPath: string): Promise<void> {
        const args = [
            '-i',
            videoPath,
            '-vn',
            '-c:a',
            'pcm_s16le',
            '-ar',
            '16000',
            '-ac',
            '1',
            '-y',
            audioPath,
        ]

        console.log('🎵 Extracting audio from video (converting to WAV PCM 16kHz mono)')
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
