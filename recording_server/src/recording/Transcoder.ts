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
    enableTranscriptionChunking?: boolean
    transcriptionChunkDuration?: number
    transcriptionAudioBucket?: string
}

export class Transcoder extends EventEmitter {
    private static readonly FFMPEG_CLOSE_TIMEOUT: number = 60_000

    // Configuration
    private config: TranscoderConfig

    // Essential components
    private pathManager: PathManager | null = null
    private videoProcessor: VideoChunkProcessor
    private s3Uploader: S3Uploader

    private processedChunks: number = 0

    // Output streams
    private ffmpegProcess: ChildProcess | null = null

    // States
    private isRecording: boolean = false
    private isPaused: boolean = false
    private isStopped: boolean = false
    private isConfigured: boolean = false
    private isAudioOnly: boolean = false

    // Track if files have been uploaded
    private filesUploaded = false

    constructor(initialConfig: Partial<TranscoderConfig>) {
        super()
        this.setMaxListeners(20)

        // Determine which audio bucket to use based on environment
        const env = process.env.ENVIRON || 'local'
        let transcriptionAudioBucket: string

        if (env === 'prod') {
            transcriptionAudioBucket = 'meeting-baas-audio'
        } else if (env === 'preprod') {
            transcriptionAudioBucket = 'preprod-meeting-baas-audio'
        } else {
            // Default to local bucket for development/test environments
            transcriptionAudioBucket =
                process.env.AWS_S3_TEMPORARY_AUDIO_BUCKET ||
                'local-meeting-baas-audio'
        }

        console.log(
            `Using transcription audio bucket for environment ${env}: ${transcriptionAudioBucket}`,
        )

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
            enableTranscriptionChunking:
                initialConfig.enableTranscriptionChunking || false,
            transcriptionChunkDuration:
                initialConfig.transcriptionChunkDuration || 3600, // 1 hour in seconds
            transcriptionAudioBucket:
                initialConfig.transcriptionAudioBucket ||
                process.env.TRANSCRIPTION_AUDIO_BUCKET ||
                transcriptionAudioBucket,
        }

        // Check if we are in audio-only mode
        this.isAudioOnly = this.config.recordingMode === 'audio_only'

        this.s3Uploader = S3Uploader.getInstance()

        this.initializeComponents()
        this.setupEventListeners()
    }

    private initializeComponents(): void {
        this.videoProcessor = new VideoChunkProcessor(this.config)
    }

    public configure(
        pathManager: PathManager,
        recordingMode?: RecordingMode,
        meetingParams?: any,
    ): void {
        if (!pathManager) {
            throw new Error('PathManager is required for configuration')
        }

        this.pathManager = pathManager

        // Update recording mode if provided
        if (recordingMode) {
            this.config.recordingMode = recordingMode
            this.isAudioOnly = recordingMode === 'audio_only'
        }

        // Update transcription chunking settings if meeting params are provided
        if (meetingParams) {
            // Check both formats of speech-to-text configuration
            const hasTranscription =
                (meetingParams.speech_to_text_provider &&
                    meetingParams.speech_to_text_provider !== 'None') ||
                (meetingParams.speech_to_text &&
                    meetingParams.speech_to_text.provider &&
                    meetingParams.speech_to_text.provider !== 'None')

            this.config.enableTranscriptionChunking = hasTranscription

            console.log('Transcription chunking setting:', {
                speech_to_text_provider: meetingParams.speech_to_text_provider,
                speech_to_text: meetingParams.speech_to_text,
                hasTranscription: hasTranscription,
                enableTranscriptionChunking:
                    this.config.enableTranscriptionChunking,
            })
        }

        // Set output file paths based on mode
        if (this.isAudioOnly) {
            this.config.outputPath = pathManager.getOutputPath() + '.wav'
        } else {
            this.config.outputPath = pathManager.getOutputPath() + '.mp4'
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
            enableTranscriptionChunking:
                this.config.enableTranscriptionChunking,
        })
    }

    private validateStartConditions(): void {
        if (!this.isConfigured || !this.pathManager) {
            throw new Error(
                'Transcoder must be configured with PathManager before starting',
            )
        }

        if (this.isRecording) {
            throw new Error('Transcoder is already running')
        }

        // Validate file extension based on mode
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
                throw new Error('Audio output path must have .wav extension')
            }
        }
    }

    public async start(): Promise<void> {
        this.validateStartConditions()
        try {
            await this.pathManager!.ensureDirectories()
            await this.startFFmpeg()

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

    // Simplified chunk processing
    public async uploadChunk(
        chunk: Buffer,
        isFinal: boolean = false,
    ): Promise<void> {
        if (!this.isReadyForChunks()) return

        try {
            // Write directly to FFmpeg stdin
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
            // Finalize chunk processing
            await this.videoProcessor.finalize()

            // Close streams
            await this.stopFFmpeg()

            // Create audio file for transcription if in video mode and transcription is enabled
            if (!this.isAudioOnly && this.config.enableTranscriptionChunking && this.pathManager) {
                console.log('Creating audio file for transcription before chunking...')
                await this.createAudioFileForTranscription()
            }

            // Create and upload audio chunks for transcription
            if (this.pathManager && this.config.enableTranscriptionChunking) {
                console.log('Starting audio chunking process for transcription')
                await this.createAndUploadTranscriptionChunks()
            }

            // Upload the full recording and delete the files
            if (process.env.SERVERLESS !== 'true') {
                await this.uploadToS3()
            }

            this.isRecording = false
            this.isStopped = true
            this.emit('stopped')
        } catch (error) {
            console.error('Error stopping transcoder:', error)
            throw error
        }
    }

    // Event listeners setup
    private setupEventListeners(): void {
        this.videoProcessor.on('error', (error) => {
            this.emit('error', { type: 'processorError', error })
        })
    }

    // State helpers
    private isReadyForChunks(): boolean {
        if (this.isStopped || !this.isRecording) {
            console.log('Cannot process chunk: transcoder not ready')
            return false
        }
        return true
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
            // SIMPLIFIED Audio-only configuration
            ffmpegArgs = [
                '-f', 'webm',           // Input format (WebM from chunks)
                '-i', 'pipe:0',         // Read from stdin
                '-vn',                  // No video
                '-acodec', 'pcm_s16le', // WAV codec
                '-ac', '1',             // Mono
                '-ar', '16000',         // 16kHz sample rate
                '-f', 'wav',            // Output format
                '-y',                   // Overwrite output
                this.config.outputPath,
            ]
        } else {
            // SIMPLIFIED Video + Audio configuration (single output MP4)
            ffmpegArgs = [
                '-f', 'webm',           // Input format (WebM from browser chunks)
                '-i', 'pipe:0',         // Read from stdin
                // Video settings - simple and fast
                '-c:v', 'libx264',      // H264 codec
                '-preset', 'faster',    // Balanced speed/quality
                '-crf', '23',           // Good quality
                '-pix_fmt', 'yuv420p',  // Compatibility
                // Audio settings
                '-c:a', 'aac',          // AAC codec
                '-b:a', '128k',         // Audio bitrate
                '-ac', '2',             // Stereo
                '-ar', '44100',         // Standard sample rate
                // Output settings
                '-f', 'mp4',            // MP4 format
                '-movflags', '+faststart', // Optimize for streaming
                '-y',                   // Overwrite output
                this.config.outputPath,
            ]
        }

        console.log('Starting FFmpeg with args:', ffmpegArgs)

        this.ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['pipe', 'pipe', 'pipe'],
        })

        this.setupFFmpegListeners()

        console.log('Started simplified FFmpeg process:', {
            isAudioOnly: this.isAudioOnly,
            outputPath: this.config.outputPath,
            inputFormat: 'WebM chunks from browser',
            outputFormat: this.isAudioOnly ? 'WAV' : 'MP4'
        })
    }

    private setupFFmpegListeners(): void {
        if (!this.ffmpegProcess) return

        this.ffmpegProcess.stdout?.on('data', (data) => {
            // Log FFmpeg output for debugging
            console.log('FFmpeg stdout:', data.toString())
        })

        this.ffmpegProcess.stderr?.on('data', (data) => {
            const output = data.toString()
            // Only log important FFmpeg messages, not all debug info
            if (output.includes('error') || output.includes('Error') || output.includes('failed')) {
                console.error('FFmpeg stderr:', output)
            }
        })

        this.ffmpegProcess.on('error', (error) => {
            console.error('FFmpeg process error:', error)
            this.emit('error', { type: 'ffmpegError', error })
        })

        this.ffmpegProcess.on('close', (code) => {
            console.log(`FFmpeg process closed with code: ${code}`)
            if (code !== 0 && !this.isStopped) {
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

        console.log('Stopping FFmpeg process...')

        return new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => {
                if (this.ffmpegProcess) {
                    console.log('FFmpeg timeout, forcing kill...')
                    this.ffmpegProcess.kill('SIGKILL')
                    reject(new Error('FFmpeg stop timeout'))
                }
            }, Transcoder.FFMPEG_CLOSE_TIMEOUT)

            this.ffmpegProcess.on('close', (code) => {
                clearTimeout(timeout)
                console.log(`FFmpeg stopped with code: ${code}`)
                this.ffmpegProcess = null
                resolve()
            })

            // Gracefully close stdin to signal end of input
            if (this.ffmpegProcess.stdin && !this.ffmpegProcess.stdin.destroyed) {
                console.log('Closing FFmpeg stdin...')
                this.ffmpegProcess.stdin.end()
            }
        })
    }

    public async uploadToS3(): Promise<void> {
        console.log(
            `Currently using transcription audio bucket: ${this.config.transcriptionAudioBucket}`,
        )
        if (!this.pathManager) {
            throw new Error('PathManager not available for S3 upload')
        }

        // Skip upload if files have already been uploaded
        if (this.filesUploaded) {
            console.log(
                'Files already uploaded to S3, skipping duplicate upload',
            )
            return
        }

        try {
            // Upload main output file
            if (!fs.existsSync(this.config.outputPath)) {
                throw new Error(
                    `Output file does not exist for upload: ${this.config.outputPath}`,
                )
            }

            const fileExtension = this.isAudioOnly ? '.wav' : '.mp4'
            const s3Key = `${this.pathManager.getIdentifier()}${fileExtension}`

            console.log('Uploading file to S3:', {
                localPath: this.config.outputPath,
                bucketName: this.config.bucketName,
                s3Key: s3Key,
            })

            await this.s3Uploader.uploadFile(
                this.config.outputPath,
                this.config.bucketName,
                s3Key,
            )

            console.log(
                `File uploaded successfully, deleting local file: ${this.config.outputPath}`,
            )
            try {
                fs.unlinkSync(this.config.outputPath)
                console.log('Local file deleted successfully')
            } catch (deleteError) {
                console.error(
                    'Failed to delete local file:',
                    deleteError,
                )
            }

            // Mark files as uploaded to prevent duplicate uploads
            this.filesUploaded = true
            console.log('S3 upload completed')
        } catch (error) {
            console.error('Error during S3 upload:', error)
            throw error
        }
    }

    private async createAudioFileForTranscription(): Promise<void> {
        if (!this.pathManager || this.isAudioOnly) return

        const audioPath = this.config.outputPath.replace('.mp4', '.wav')
        
        console.log('Creating audio file for transcription from video...')
        console.log(`Input MP4 file: ${this.config.outputPath}`)
        console.log(`Output WAV file: ${audioPath}`)

        // Verify the input MP4 file exists
        if (!fs.existsSync(this.config.outputPath)) {
            throw new Error(`Input MP4 file does not exist: ${this.config.outputPath}`)
        }

        const inputStats = fs.statSync(this.config.outputPath)
        console.log(`Input MP4 file size: ${inputStats.size} bytes`)

        return new Promise<void>((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-i', this.config.outputPath,  // Input MP4 file
                '-vn',                          // No video
                '-acodec', 'pcm_s16le',        // WAV codec
                '-ac', '1',                     // Mono
                '-ar', '16000',                 // 16kHz for transcription
                '-y',                           // Overwrite
                audioPath,                      // Output WAV file
            ])

            ffmpeg.stderr?.on('data', (data) => {
                const output = data.toString()
                // Log important FFmpeg messages
                if (output.includes('error') || output.includes('Error') || output.includes('failed')) {
                    console.error('FFmpeg audio extraction stderr:', output)
                }
            })

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    // Verify the output file was created
                    if (fs.existsSync(audioPath)) {
                        const outputStats = fs.statSync(audioPath)
                        console.log(`Audio file for transcription created successfully: ${audioPath} (${outputStats.size} bytes)`)
                        this.config.audioOutputPath = audioPath
                        resolve()
                    } else {
                        reject(new Error('Audio file was not created despite FFmpeg success'))
                    }
                } else {
                    console.error(`Audio extraction failed with FFmpeg exit code: ${code}`)
                    reject(new Error(`Audio extraction failed with code ${code}`))
                }
            })

            ffmpeg.on('error', (error) => {
                console.error('FFmpeg audio extraction process error:', error)
                reject(error)
            })
        })
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

    private async createAndUploadTranscriptionChunks(): Promise<void> {
        // Check if transcription chunking is enabled
        if (!this.config.enableTranscriptionChunking) {
            console.log(
                'Transcription chunking is disabled, skipping audio chunk creation',
            )
            return
        }

        // Use the audio file that was created during recording
        const audioFilePath = this.isAudioOnly
            ? this.config.outputPath
            : this.config.audioOutputPath!

        // Get the appropriate bucket based on environment
        const env = process.env.ENVIRON || 'local'
        const bucketName =
            this.config.transcriptionAudioBucket ||
            (env === 'prod'
                ? 'meeting-baas-audio'
                : env === 'preprod'
                  ? 'preprod-meeting-baas-audio'
                  : process.env.AWS_S3_TEMPORARY_AUDIO_BUCKET ||
                    'local-meeting-baas-audio')

        console.log('Starting audio chunking process for transcription')
        console.log(`Looking for audio file at: ${audioFilePath}`)
        console.log(`Audio mode: ${this.isAudioOnly ? 'audio-only' : 'video with separate audio file'}`)

        if (!fs.existsSync(audioFilePath)) {
            console.error('Audio file not found for chunking:', audioFilePath)
            console.error('Available files in directory:')
            try {
                const dirPath = require('path').dirname(audioFilePath)
                const files = fs.readdirSync(dirPath)
                files.forEach(file => console.error(`  - ${file}`))
            } catch (dirError) {
                console.error('Could not list directory contents:', dirError)
            }
            return
        }

        console.log('Found audio file for chunking:', audioFilePath)

        try {
            // Get the total duration of the audio file using ffprobe
            const duration = await this.getAudioDuration(audioFilePath)
            if (duration <= 0) {
                console.error(
                    'Could not determine audio duration or file is empty',
                )
                return
            }

            console.log(`Audio file duration: ${duration} seconds`)

            // Calculate how many chunks we need
            const chunkDurationSecs = this.config.transcriptionChunkDuration
            // Math.ceil ensures we create at least 1 chunk even for recordings shorter than 1 hour
            const numChunks = Math.ceil(duration / chunkDurationSecs)

            console.log(
                `Splitting into ${numChunks} chunks of ${chunkDurationSecs} seconds (or less for the final chunk)`,
            )

            const botUuid = this.pathManager!.getBotUuid()

            // Create a temporary directory for chunks
            const tempDir = await fs.promises.mkdtemp(
                `${this.pathManager!.getTempPath()}/audio_chunks_`,
            )

            // Always upload at least one chunk, even for short recordings
            console.log(
                `Will upload ${numChunks} audio chunk(s) for transcription to bucket: ${bucketName}`,
            )

            // For each chunk
            for (let i = 0; i < numChunks; i++) {
                const startTime = i * chunkDurationSecs
                const endTime = Math.min((i + 1) * chunkDurationSecs, duration)
                const chunkDuration = endTime - startTime

                // Generate the output filename: bot_uuid-[chunk_number].wav
                const chunkFilename = `${botUuid}-${i}.wav`
                const chunkPath = `${tempDir}/${chunkFilename}`

                console.log(
                    `Processing chunk ${i}/${numChunks}: ${startTime}s to ${endTime}s (duration: ${chunkDuration}s)`,
                )

                try {
                    // Extract the chunk using ffmpeg
                    console.log(`Extracting audio chunk to: ${chunkPath}`)
                    await this.extractAudioChunk(
                        audioFilePath,
                        startTime,
                        chunkDuration,
                        chunkPath,
                    )

                    // Verify the chunk file exists and has data
                    try {
                        const stats = await fs.promises.stat(chunkPath)
                        console.log(
                            `Audio chunk created successfully: ${chunkPath} (${stats.size} bytes)`,
                        )

                        // Upload the chunk to S3
                        if (process.env.SERVERLESS !== 'true') {
                            const s3Key = `${botUuid}/${chunkFilename}`

                            console.log(
                                `Uploading chunk to S3: bucket=${bucketName}, key=${s3Key}`,
                            )

                            const url = await this.s3Uploader.uploadFile(
                                chunkPath,
                                bucketName,
                                s3Key,
                                true,
                            )
                            console.log(
                                `Successfully uploaded chunk ${i + 1} to: ${url}`,
                            )
                        }
                    } catch (statErr) {
                        console.error(
                            `Error verifying chunk file: ${chunkPath}`,
                            statErr,
                        )
                    }
                } catch (chunkErr) {
                    console.error(`Error processing chunk ${i + 1}:`, chunkErr)
                }
            }

            // Clean up temporary files
            if (process.env.SERVERLESS !== 'true') {
                try {
                    console.log(`Cleaning up temporary directory: ${tempDir}`)
                    for (const file of await fs.promises.readdir(tempDir)) {
                        await fs.promises.unlink(`${tempDir}/${file}`)
                    }
                    await fs.promises.rmdir(tempDir)
                    console.log('Temporary chunk files cleaned up successfully')
                } catch (error) {
                    console.error(
                        'Error cleaning up temporary chunk files:',
                        error,
                    )
                }
            }
            console.log(
                'Audio chunking for transcription completed successfully',
            )
        } catch (error) {
            console.error('Error in audio chunking process:', error)
            // Don't throw so it doesn't interrupt the rest of the stopping process
        }
    }

    public getFilesUploaded(): boolean {
        return this.filesUploaded
    }

    private async getAudioDuration(filePath: string): Promise<number> {
        return new Promise<number>((resolve, reject) => {
            const ffprobe = spawn('ffprobe', [
                '-v',
                'error',
                '-show_entries',
                'format=duration',
                '-of',
                'default=noprint_wrappers=1:nokey=1',
                filePath,
            ])

            let output = ''
            ffprobe.stdout.on('data', (data) => {
                output += data.toString()
            })

            ffprobe.on('close', (code) => {
                if (code !== 0) {
                    console.error(`ffprobe process exited with code ${code}`)
                    reject(
                        new Error(`ffprobe process exited with code ${code}`),
                    )
                    return
                }

                const duration = parseFloat(output.trim())
                if (isNaN(duration)) {
                    reject(new Error('Failed to parse duration'))
                    return
                }

                resolve(duration)
            })

            ffprobe.on('error', (err) => {
                reject(err)
            })
        })
    }

    private async extractAudioChunk(
        inputPath: string,
        startTime: number,
        duration: number,
        outputPath: string,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            const ffmpegArgs = [
                '-y', // Overwrite output file
                '-i',
                inputPath, // Input file
                '-ss',
                startTime.toString(), // Start time
                '-t',
                duration.toString(), // Duration
                '-vn', // No video
                '-acodec',
                'pcm_s16le', // Audio codec
                '-ar',
                '16000', // Sample rate
                '-ac',
                '1', // Mono audio
                outputPath, // Output file
            ]

            const ffmpeg = spawn('ffmpeg', ffmpegArgs)

            ffmpeg.on('close', (code) => {
                if (code === 0) {
                    resolve()
                } else {
                    reject(new Error(`FFmpeg process exited with code ${code}`))
                }
            })

            ffmpeg.on('error', (err) => {
                reject(err)
            })
        })
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
    enableTranscriptionChunking:
        process.env.ENABLE_TRANSCRIPTION_CHUNKING === 'true',
    transcriptionAudioBucket: process.env.TRANSCRIPTION_AUDIO_BUCKET,
})
