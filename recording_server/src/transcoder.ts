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

            // Processus séparé pour les frames (en arrière-plan)
            try {
                const frameAnalyzer = FrameAnalyzer.getInstance()
                const framesDir = frameAnalyzer.getFramesDirectory()

                const frameProcess = spawn(
                    'ffmpeg',
                    [
                        '-i',
                        this.webmPath, // Lire depuis le fichier WebM
                        '-vf',
                        'fps=1/2',
                        '-update',
                        '1',
                        '-y',
                        path.join(await framesDir, 'temp_frame.jpg'),
                    ],
                    {
                        stdio: 'ignore', // Ignorer toutes les sorties
                        detached: true, // Processus détaché
                    },
                )

                // Ne pas attendre ce processus
                frameProcess.unref()

                // Gérer les erreurs silencieusement
                frameProcess.on('error', (err) => {
                    console.log(
                        'Frame extraction process error (non-critical):',
                        err,
                    )
                })
            } catch (frameErr) {
                console.log(
                    'Frame extraction setup failed (non-critical):',
                    frameErr,
                )
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

            if (!isFinal) {
                // Recording is in process...
                if (this.chunkReceavedCounter % chunksPerTranscribe === 0) {
                    const timeStart =
                        (this.chunkReceavedCounter - chunksPerTranscribe) *
                        this.chunkDuration
                    const timeEnd = timeStart + this.transcribeDuration
                    console.log(
                        `Requesting transcription for segment ${timeStart}ms to ${timeEnd}ms`,
                    )

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
                                // Retirer la promesse du tableau
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
                                // Retirer la promesse du tableau après succès
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
                // Recording has stopped - handle final segment
                console.log(
                    `Processing final chunk. Waiting for ${this.currentTranscriptionPromises.length} pending transcriptions...`,
                )

                // Attendre toutes les transcriptions en cours
                if (this.currentTranscriptionPromises.length > 0) {
                    const results = await Promise.allSettled(
                        this.currentTranscriptionPromises,
                    )
                    results.forEach((result, index) => {
                        if (result.status === 'rejected') {
                            console.error(
                                `Transcription ${index} failed:`,
                                result.reason,
                            )
                        } else {
                            console.log(
                                `Transcription ${index} completed successfully`,
                            )
                        }
                    })
                }

                const remainingChunks =
                    this.chunkReceavedCounter % chunksPerTranscribe
                console.log(
                    `Final segment calculation: remainingChunks=${remainingChunks}, total chunks=${this.chunkReceavedCounter}`,
                )

                if (remainingChunks > 0) {
                    const timeStart =
                        (this.chunkReceavedCounter - remainingChunks) *
                        this.chunkDuration
                    const timeEnd =
                        this.chunkReceavedCounter * this.chunkDuration
                    console.log(
                        `Requesting final transcription from ${timeStart}ms to ${timeEnd}ms`,
                    )

                    const finalTranscriptionPromise =
                        WordsPoster.TRANSCRIBER?.push(timeStart, timeEnd)
                    if (finalTranscriptionPromise) {
                        await finalTranscriptionPromise.catch((error) => {
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
        console.log('Running audio extraction...')

        // Conversion des millisecondes en secondes avec précision
        const startSeconds = (timeStart / 1000).toFixed(3)
        const durationSeconds = ((timeEnd - timeStart) / 1000).toFixed(3)

        return new Promise(async (resolve, reject) => {
            try {
                const ffmpegArgs = [
                    '-y', // Écraser les fichiers de sortie si existants
                    '-ss', // Position de départ
                    startSeconds, // En secondes
                    '-i', // Fichier d'entrée
                    this.webmPath,
                    '-t', // Durée de l'extrait
                    durationSeconds, // En secondes

                    // Output 1: Audio
                    '-map',
                    '0:a', // Sélectionner la piste audio
                    '-acodec', // Codec audio
                    'pcm_s16le', // Format WAV standard
                    '-ac', // Nombre de canaux
                    '1', // Mono
                    '-ar', // Taux d'échantillonnage
                    '16000', // 16kHz
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
                            // Vérification de la taille du fichier
                            const stats = await fs.stat(outputAudioPath)
                            console.log(
                                `Audio extraction completed successfully. File size: ${stats.size} bytes`,
                            )

                            if (stats.size === 0) {
                                console.error('Generated audio file is empty')
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
                        if (output.includes('File ended prematurely at pos.')) {
                            try {
                                await fs.unlink(outputAudioPath)
                                console.log(
                                    'Output file deleted due to premature termination',
                                )
                            } catch (err) {
                                console.error(
                                    'Error deleting the output file:',
                                    err,
                                )
                            }
                            reject(new Error('The file terminated prematurely'))
                        } else {
                            reject(
                                new Error(
                                    `Audio extraction failed with code ${code}`,
                                ),
                            )
                        }
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
