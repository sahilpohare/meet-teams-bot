import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { Writable } from 'stream'
import { Logger } from './logger'

import { FrameAnalyzer } from './FrameAnalyzer'
import { WordsPoster } from './words_poster/words_poster'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class Transcoder {
    private videoOutputPath: string
    private bucketName: string
    private ffmpeg_process: ChildProcess | null = null
    private videoS3Path: string
    private webmPath: string
    private transcoder_successfully_stopped: boolean = false
    private chunkDuration: number // Duration of one uploaded chunk
    private transcribeDuration: number // Duration of one transcribe to WordsPoster
    private chunkReceavedCounter: number = 0 // Number of chunks received
    static FFMPEG_CLOSE_TIMEOUT: number = 60_000 // 60 seconds
    private currentTranscriptionPromises: Array<Promise<void>> = []

    static EXTRACT_AUDIO_MAX_RETRIES: number = 5
    static EXTRACT_AUDIO_RETRY_DELAY: number = 10_000 // 10 seconds

    constructor() {
        this.webmPath = path.join(os.tmpdir(), 'output.webm')

        // Set a new empty webm file for voice transcription
        const fs = require('fs')
        try {
            fs.writeFileSync(this.webmPath, Buffer.alloc(0))
        } catch (err) {
            console.error(`Cannot create new webm file: ${err}`)
        }
    }

    public async init(
        bucketName: string,
        videoS3Path: string,
        chunkDuration: number,
        transcribeDuration: number,
    ): Promise<void> {
        if (this.ffmpeg_process) {
            console.log('Transcoder already initialized')
            return
        }
        this.videoOutputPath = Logger.instance.get_video_directory()
        this.bucketName = bucketName
        this.videoS3Path = videoS3Path
        this.chunkDuration = chunkDuration
        this.transcribeDuration = transcribeDuration

        // Séparation en deux processus FFmpeg distincts
        try {
            // Premier processus FFmpeg pour la vidéo principale
            const mainFfmpegArgs = [
                '-i',
                'pipe:0',
                '-c:v',
                'copy',
                '-c:a',
                'aac',
                '-b:a',
                '128k',
                '-movflags',
                '+frag_keyframe+empty_moov',
                '-y',
                this.videoOutputPath,
                '-loglevel',
                'verbose',
            ]

            console.log(
                'Launching main FFmpeg process with args:',
                mainFfmpegArgs.join(' '),
            )
            this.ffmpeg_process = spawn('ffmpeg', mainFfmpegArgs, {
                stdio: ['pipe', 'inherit', 'inherit'],
            })

            // Gérer les erreurs du processus principal
            this.ffmpeg_process.on('error', (err) => {
                console.error('Main FFmpeg process error:', err)
            })

            // Processus séparé pour les frames
            try {
                const frameAnalyzer = FrameAnalyzer.getInstance()
                const framesDir = await frameAnalyzer.getFramesDirectory()
                console.log(`Using frames directory: ${framesDir}`)

                const frameProcess = spawn(
                    'ffmpeg',
                    [
                        '-i',
                        this.webmPath,
                        '-vf',
                        'fps=1/2',
                        '-update',
                        '1',
                        '-atomic_writing',
                        '1',
                        '-y',
                        path.join(framesDir, 'temp_frame.jpg'),
                    ],
                    {
                        stdio: ['ignore', 'pipe', 'pipe'], // Changé pour capturer la sortie
                    },
                )

                // Capture des logs pour le debug
                frameProcess.stdout?.on('data', (data) => {
                    console.log('Frame FFmpeg stdout:', data.toString())
                })

                frameProcess.stderr?.on('data', (data) => {
                    console.log('Frame FFmpeg stderr:', data.toString())
                })

                frameProcess.on('error', (err) => {
                    console.error('Frame extraction process error:', err)
                })

                frameProcess.on('exit', (code) => {
                    console.log(
                        `Frame extraction process exited with code ${code}`,
                    )
                })

                // S'assurer que le processus continue en arrière-plan
                frameProcess.unref()
            } catch (frameErr) {
                console.error('Frame extraction setup failed:', frameErr)
            }

            console.log('FFmpeg processes launched successfully')
        } catch (error) {
            console.error('Error in transcoder initialization:', error)
            throw error // On ne propage que les erreurs critiques
        }
        return
    }

    // Asynchronous method to write to stdin.
    private async writeToChildStdin(data: Buffer): Promise<void> {
        if (!this.ffmpeg_process || !this.ffmpeg_process.stdin) {
            throw new Error(
                'The child process is not initialized or stdin is not available',
            )
        }

        return new Promise<void>((resolve, reject) => {
            const stdin = this.ffmpeg_process!.stdin as Writable
            const canContinue = stdin.write(data)

            if (canContinue) {
                resolve()
            } else {
                stdin.once('drain', resolve)
            }
        })
    }

    public async stop(): Promise<void> {
        if (this.transcoder_successfully_stopped) {
            console.log('Transcoder already stopped')
            return
        }
        if (!this.ffmpeg_process) {
            console.log('Transcoder not initialized, nothing to stop')
            return
        }
        // New method to close stdin
        if (this.ffmpeg_process.stdin) {
            this.ffmpeg_process.stdin.end()
            console.log('Child process stdin closed')
        } else {
            console.log('stdin is unavailable')
        }
        console.log('Transcoder stopped')

        // Wait for the child process to finish
        await new Promise<void>((resolve, reject) => {
            this.ffmpeg_process!.on('close', async (code) => {
                console.log(`Process ffmpeg finished with code ${code}`)

                if (code === 0) {
                    try {
                        const tempOutputPath = `${this.videoOutputPath}_temp.mp4`

                        console.log('Starting faststart process...')

                        await new Promise<void>((resolve, reject) => {
                            const fastStartProcess = spawn('ffmpeg', [
                                '-i',
                                this.videoOutputPath,
                                '-c',
                                'copy',
                                '-movflags',
                                '+faststart',
                                tempOutputPath,
                            ])

                            fastStartProcess.stdout.on('data', (data) => {
                                console.log(`Faststart stdout: ${data}`)
                            })

                            fastStartProcess.stderr.on('data', (data) => {
                                console.log(`Faststart stderr: ${data}`)
                            })
                            // prettier-ignore
                            fastStartProcess.on('close',async (fastStartCode) => {
                                if (fastStartCode === 0) {
                                    await fs.rename(
                                        tempOutputPath,
                                        this.videoOutputPath,
                                    )
                                    console.log(
                                        'Faststart process completed successfully',
                                    )
                                    resolve()
                                } else {
                                    console.error(
                                        `Faststart process failed with code ${fastStartCode}`,
                                    )
                                    reject(
                                        new Error(
                                            `Faststart process failed with code ${fastStartCode}`,
                                        ),
                                    )
                                }
                            })
                        })
                    } catch (err) {
                        console.error('Error during faststart process:', err)
                        throw err
                    }
                } else {
                    console.error(`Faststart process failed with code ${code}`)
                    reject(
                        new Error(`Faststart process failed with code ${code}`),
                    )
                }
                this.ffmpeg_process = null
                resolve()
            })
            setTimeout(() => {
                if (this.ffmpeg_process) {
                    this.ffmpeg_process.kill('SIGTERM')
                    reject(new Error('Timeout while stopping the transcoder'))
                }
            }, Transcoder.FFMPEG_CLOSE_TIMEOUT) // 60 seconds before timeout
        })
        this.transcoder_successfully_stopped = true
    }

    public async uploadChunk(chunk: Buffer, isFinal: boolean): Promise<void> {
        console.log(
            `Processing chunk: isFinal=${isFinal}, size=${chunk.length}`,
        )

        if (this.transcoder_successfully_stopped) {
            console.log('Transcoder is in stop state!')
            return
        }
        if (!this.ffmpeg_process) {
            throw new Error('Transcoder not initialized')
        }

        try {
            this.chunkReceavedCounter += 1
            console.log(`Processing chunk #${this.chunkReceavedCounter}`)

            await this.appendChunkToWebm(chunk)
            console.log('Incoming video data written to WebM')

            let chunksPerTranscribe =
                this.transcribeDuration / this.chunkDuration
            console.log(`Chunks per transcribe: ${chunksPerTranscribe}`)

            // Garder trace des segments déjà traités
            const processedSegments = new Set<string>()

            if (!isFinal) {
                if (this.chunkReceavedCounter % chunksPerTranscribe === 0) {
                    const timeStart =
                        (this.chunkReceavedCounter - chunksPerTranscribe) *
                        this.chunkDuration
                    const timeEnd = timeStart + this.transcribeDuration
                    const segmentKey = `${timeStart}-${timeEnd}`

                    if (processedSegments.has(segmentKey)) {
                        console.log(`Skipping duplicate segment ${segmentKey}`)
                        return
                    }

                    console.log(
                        `Requesting transcription for segment ${timeStart}ms to ${timeEnd}ms`,
                    )

                    processedSegments.add(segmentKey)

                    const transcriptionPromise = WordsPoster.TRANSCRIBER?.push(
                        timeStart,
                        timeEnd,
                    )

                    if (transcriptionPromise) {
                        const wrappedPromise = transcriptionPromise
                            .catch((error) => {
                                console.error(
                                    `Transcription failed for segment ${timeStart}-${timeEnd}:`,
                                    error,
                                )
                                processedSegments.delete(segmentKey)
                                this.currentTranscriptionPromises =
                                    this.currentTranscriptionPromises.filter(
                                        (p) => p !== wrappedPromise,
                                    )
                                throw error
                            })
                            .then(() => {
                                console.log(
                                    `Transcription completed for segment ${timeStart}-${timeEnd}`,
                                )
                                this.currentTranscriptionPromises =
                                    this.currentTranscriptionPromises.filter(
                                        (p) => p !== wrappedPromise,
                                    )
                            })

                        this.currentTranscriptionPromises.push(wrappedPromise)
                        console.log(
                            `Added transcription promise. Current promises: ${this.currentTranscriptionPromises.length}`,
                        )
                    }
                }
            } else {
                console.log(
                    'Processing final chunk. Waiting for pending transcriptions...',
                )
                await Promise.all(this.currentTranscriptionPromises)

                const lastProcessedSegment =
                    Math.floor(
                        this.chunkReceavedCounter / chunksPerTranscribe,
                    ) * chunksPerTranscribe
                const remainingChunks =
                    this.chunkReceavedCounter - lastProcessedSegment

                if (remainingChunks > 0) {
                    const timeStart = lastProcessedSegment * this.chunkDuration
                    const timeEnd =
                        this.chunkReceavedCounter * this.chunkDuration

                    console.log(
                        `Requesting final transcription from ${timeStart}ms to ${timeEnd}ms`,
                    )
                    const transcriptionPromise = WordsPoster.TRANSCRIBER?.push(
                        timeStart,
                        timeEnd,
                    )
                    if (transcriptionPromise) {
                        await transcriptionPromise.catch((error) => {
                            console.error('Final transcription failed:', error)
                            throw error
                        })
                        console.log(
                            'Final transcription completed successfully',
                        )
                    }
                }
            }

            await this.writeToChildStdin(chunk)
            console.log('Chunk written to FFmpeg stdin')
        } catch (err) {
            console.error('Error processing chunk:', err)
            throw err
        }
    }

    public getOutputPath(): string {
        return this.videoOutputPath
    }

    // Upload Video To s3
    public async uploadVideoToS3() {
        try {
            await this.uploadToS3(
                this.videoOutputPath,
                this.bucketName,
                this.videoS3Path,
                false,
            )
        } catch (e) {
            console.error(e)
            throw e
        }
    }

    private uploadToS3(
        filePath: string,
        bucketName: string,
        s3Path: string,
        isAudio: boolean,
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const fileName = path.basename(filePath)
            // Change here: we should not include the file name in s3FullPath
            const s3FullPath = `s3://${bucketName}/${s3Path}`

            const s3Args = process.env.S3_ARGS
                ? process.env.S3_ARGS.split(' ')
                : []

            const args = isAudio ? [] : s3Args

            console.log('args', args)
            const awsCommand = spawn('aws', [
                ...args,
                's3',
                'cp',
                filePath,
                s3FullPath, // This will now point to the correct path
                '--acl',
                'public-read',
            ])

            let output = ''
            let errorOutput = ''

            awsCommand.stdout.on('data', (data) => {
                output += data.toString()
            })

            awsCommand.stderr.on('data', (data) => {
                errorOutput += data.toString()
            })

            awsCommand.on('close', async (code) => {
                if (code === 0) {
                    const publicUrl = `https://${bucketName}.s3.amazonaws.com/${s3Path}`
                    console.log(`File uploaded successfully: ${publicUrl}`)

                    if (!isAudio) {
                        await Logger.instance.remove_video()
                    }
                    resolve(publicUrl)
                } else {
                    console.error('Error uploading to S3:', errorOutput)
                    console.log(process.env)
                    reject(new Error(`Failed S3 upload with code ${code}`))
                }
            })
        })
    }

    // Extract Audio by uploading audio WAV into S3
    public async extractAudio(
        timeStart: number,
        timeEnd: number,
        _bucketName: string,
        s3Path: string,
    ): Promise<string> {
        console.log(
            `Starting audio extraction - timeStart: ${timeStart}ms, timeEnd: ${timeEnd}ms`,
        )

        if (!this.ffmpeg_process) {
            console.error('Transcoder not initialized for audio extraction')
            throw new Error('Transcoder not initialized')
        }

        // TODO : Given _bucketName is completly bullshit here !!! FUCK IT !
        let bucketName: string = process.env.AWS_S3_TEMPORARY_AUDIO_BUCKET
        console.log(`Using bucket for audio: ${bucketName}`)

        const outputAudioPath = path.join(
            os.tmpdir(),
            `output_${Date.now()}.wav`,
        )
        console.log(`Audio will be saved to: ${outputAudioPath}`)

        for (
            let attempt = 1;
            attempt <= Transcoder.EXTRACT_AUDIO_MAX_RETRIES;
            attempt++
        ) {
            console.log(
                `Starting audio extraction attempt ${attempt}/${Transcoder.EXTRACT_AUDIO_MAX_RETRIES}`,
            )
            try {
                console.log(
                    `Running audio extraction with params: outputPath=${outputAudioPath}, timeStart=${timeStart}, timeEnd=${timeEnd}`,
                )
                await this.runExtractAudio(outputAudioPath, timeStart, timeEnd)
                console.log(`Audio extraction successful on attempt ${attempt}`)

                // Check file exists and get size
                const stats = await fs.stat(outputAudioPath)
                console.log(`Generated audio file size: ${stats.size} bytes`)

                console.log(`Uploading audio to S3 path: ${s3Path}`)
                const s3Url = await this.uploadToS3(
                    outputAudioPath,
                    bucketName,
                    s3Path,
                    true,
                )
                console.log(`Audio file successfully uploaded to S3: ${s3Url}`)
                return s3Url
            } catch (error) {
                console.error(
                    `Audio extraction or upload failed on attempt ${attempt}:`,
                    error,
                )
                if (attempt === Transcoder.EXTRACT_AUDIO_MAX_RETRIES) {
                    console.error('Maximum retry attempts reached, giving up')
                    throw new Error(
                        `Audio extraction or upload failed after ${Transcoder.EXTRACT_AUDIO_MAX_RETRIES} attempts`,
                    )
                }
                console.log(
                    `Waiting ${Transcoder.EXTRACT_AUDIO_RETRY_DELAY}ms before next attempt...`,
                )
                await sleep(Transcoder.EXTRACT_AUDIO_RETRY_DELAY)
            } finally {
                try {
                    console.log(
                        `Cleaning up temporary audio file: ${outputAudioPath}`,
                    )
                    await fs.unlink(outputAudioPath)
                    console.log('Temporary audio file deleted successfully')
                } catch (err) {
                    console.error(
                        'Error deleting the temporary audio file:',
                        err,
                    )
                }
            }
        }

        throw new Error(
            `Audio extraction and upload failed after ${Transcoder.EXTRACT_AUDIO_MAX_RETRIES} attempts`,
        )
    }

    private runExtractAudio(
        outputAudioPath: string,
        timeStart: number,
        timeEnd: number,
    ): Promise<void> {
        console.log('Running audio extraction...', {
            timeStart,
            timeEnd,
            webmPath: this.webmPath,
            outputPath: outputAudioPath,
        })

        // Conversion des millisecondes en secondes avec précision
        const startSeconds = (timeStart / 1000).toFixed(3)
        const durationSeconds = ((timeEnd - timeStart) / 1000).toFixed(3)

        return new Promise(async (resolve, reject) => {
            try {
                // Vérifier d'abord que le fichier webm existe et n'est pas vide
                const webmStats = await fs.stat(this.webmPath)
                if (webmStats.size === 0) {
                    console.error('Source WebM file is empty')
                    reject(new Error('Source WebM file is empty'))
                    return
                }
                console.log(`Source WebM file size: ${webmStats.size} bytes`)

                const ffmpegArgs = [
                    '-y',
                    '-ss',
                    startSeconds,
                    '-i',
                    this.webmPath,
                    '-t',
                    durationSeconds,
                    '-map',
                    '0:a',
                    '-acodec',
                    'pcm_s16le',
                    '-ac',
                    '1',
                    '-ar',
                    '16000',
                    outputAudioPath,
                ]
                console.log('FFmpeg extraction command:', ffmpegArgs.join(' '))
                const child = spawn('ffmpeg', ffmpegArgs, {
                    stdio: ['ignore', 'pipe', 'pipe'],
                })

                let output = ''

                child.stdout.on('data', (data) => {
                    output += data.toString()
                    console.log('FFmpeg extraction stdout:', data.toString())
                })

                child.stderr.on('data', (data) => {
                    output += data.toString()
                    console.log('FFmpeg extraction stderr:', data.toString())
                })

                child.on('close', async (code) => {
                    if (code === 0) {
                        try {
                            const stats = await fs.stat(outputAudioPath)
                            console.log(
                                `Audio extraction completed. File size: ${stats.size} bytes`,
                            )

                            // Un fichier WAV vide fait environ 44 bytes (en-tête WAV)
                            if (stats.size <= 44) {
                                console.error(
                                    'Generated audio file is empty (only header)',
                                )
                                reject(
                                    new Error('Generated audio file is empty'),
                                )
                                return
                            }

                            resolve()
                        } catch (err) {
                            console.error('Error verifying output file:', err)
                            reject(err)
                        }
                    } else {
                        console.error('FFmpeg extraction output:', output)
                        reject(
                            new Error(
                                `Audio extraction failed with code ${code}: ${output}`,
                            ),
                        )
                    }
                })
            } catch (error) {
                console.error('Error in extraction setup:', error)
                reject(error)
            }
        })
    }

    private async appendChunkToWebm(chunk: Buffer): Promise<void> {
        try {
            await fs.appendFile(this.webmPath, new Uint8Array(chunk))
            console.log('Chunk successfully added to the WebM file')
        } catch (err) {
            console.error('Error adding chunk to the WebM file:', err)
            throw err
        }
    }
}

// Creating a global instance
export const TRANSCODER = new Transcoder()
