import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { Writable } from 'stream'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

class Transcoder {
    private outputPath: string
    private bucketName: string
    private ffmpeg_process: ChildProcess | null = null
    private videoS3Path: string
    private webmPath: string

    constructor() {
        this.outputPath = path.join(os.tmpdir(), 'output.mp4')
        this.webmPath = path.join(os.tmpdir(), 'output.webm')

        // Set a new empty webm file for voice transcription
        const fs = require('fs')
        try {
            fs.writeFileSync(this.webmPath, Buffer.alloc(0))
        } catch (err) {
            this.error(`Cannot create new webm file: ${err}`)
        }
    }
    private log(...args: any[]): void {
        console.log(`[${this.constructor.name}]`, ...args)
    }
    private error(...args: any[]): void {
        console.error(`[${this.constructor.name}]`, ...args)
    }

    public async init(bucketName: string, videoS3Path: string): Promise<void> {
        if (this.ffmpeg_process) {
            this.log('Transcoder already initialized')
            return
        }

        this.bucketName = bucketName
        this.videoS3Path = videoS3Path

        const ffmpegArgs = [
            '-i',
            'pipe:0',
            '-c:v',
            'copy',
            '-preset',
            'fast',
            '-crf',
            '23',
            '-c:a',
            'aac',
            '-b:a',
            '128k',
            '-movflags',
            '+faststart',
            '-y',
            this.outputPath,
            '-loglevel',
            'verbose',
        ]

        // Run the ffmpeg command asynchronously
        this.ffmpeg_process = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['pipe', 'inherit', 'inherit'],
        })
        this.log('FFmpeg command launched successfully')
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

    // New method to close stdin
    private closeChildStdin(): void {
        if (!this.ffmpeg_process || !this.ffmpeg_process.stdin) {
            this.log(
                'The child process is not initialized or stdin is unavailable',
            )
            return
        }
        this.ffmpeg_process.stdin.end()
        this.log('Child process stdin closed')
    }

    public async stop(): Promise<void> {
        if (!this.ffmpeg_process) {
            this.log('Transcoder not initialized, nothing to stop')
            return
        }

        this.closeChildStdin()
        this.log('Transcoder stopped')

        // Wait for the child process to finish
        await new Promise<void>((resolve, reject) => {
            this.ffmpeg_process!.on('close', (code) => {
                this.log(
                    `Process transcode_video.sh finished with code ${code}`,
                )
                this.ffmpeg_process = null
                resolve()
            })

            setTimeout(() => {
                if (this.ffmpeg_process) {
                    this.ffmpeg_process.kill('SIGTERM')
                    reject(new Error('Timeout while stopping the transcoder'))
                }
            }, 60000) // 60 seconds before timeout
        })
        this.uploadToS3(
            this.outputPath,
            this.bucketName,
            this.videoS3Path,
            false,
        )
    }

    public async uploadChunk(chunk: Buffer): Promise<void> {
        if (!this.ffmpeg_process) {
            throw new Error('Transcoder not initialized')
        }

        try {
            await this.appendChunkToWebm(chunk)
            this.log('Incoming video data writed appened to webM')
            await this.writeToChildStdin(chunk).then((_) => {
                this.log('Incoming video data writed into ffmpeg stdin')
            })
        } catch (err) {
            this.error(
                'Error writing the chunk in ffmpeg or adding it to the WebM file:',
                err,
            )
            throw err
        }
    }

    public getOutputPath(): string {
        return this.outputPath
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

            this.log('args', args)
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

            awsCommand.on('close', (code) => {
                if (code === 0) {
                    const publicUrl = `https://${bucketName}.s3.amazonaws.com/${s3Path}`
                    this.log(`File uploaded successfully: ${publicUrl}`)
                    resolve(publicUrl)
                } else {
                    this.error('Error uploading to S3:', errorOutput)
                    this.log(process.env)
                    reject(new Error(`Failed S3 upload with code ${code}`))
                }
            })
        })
    }

    public async extractAudio(
        timeStart: number,
        timeEnd: number,
        bucketName: string,
        s3Path: string,
    ): Promise<string> {
        if (!this.ffmpeg_process) {
            throw new Error('Transcoder not initialized')
        }

        const outputAudioPath = path.join(
            os.tmpdir(),
            `output_${Date.now()}.wav`,
        )
        const maxRetries = 5
        const retryDelay = 10000 // 10 seconds

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.runExtractAudio(outputAudioPath, timeStart, timeEnd)
                this.log(`Audio extraction successful on attempt ${attempt}`)

                // Uploading audio file to S3
                const s3Url = await this.uploadToS3(
                    outputAudioPath,
                    bucketName,
                    s3Path,
                    true,
                )
                this.log(`Audio file uploaded to S3 on attempt ${attempt}`)
                return s3Url
            } catch (error) {
                this.error(
                    `Audio extraction or upload failed on attempt ${attempt}:`,
                    error,
                )
                if (attempt === maxRetries) {
                    throw new Error(
                        `Audio extraction or upload failed after ${maxRetries} attempts`,
                    )
                }
                await sleep(retryDelay)
            } finally {
                try {
                    await fs.unlink(outputAudioPath)
                } catch (err) {
                    this.error('Error deleting the audio file:', err)
                }
            }
        }

        throw new Error(
            `Audio extraction and upload failed after ${maxRetries} attempts`,
        )
    }

    private runExtractAudio(
        outputAudioPath: string,
        timeStart: number,
        timeEnd: number,
    ): Promise<void> {
        return new Promise((resolve, reject) => {
            let ffmpegArgs: string[]

            if (timeEnd === -1) {
                ffmpegArgs = [
                    '-i',
                    this.webmPath,
                    '-async',
                    '1',
                    '-ss',
                    timeStart.toString(),
                    '-vn',
                    '-c:a',
                    'pcm_s16le',
                    '-ac',
                    '1',
                    '-y',
                    outputAudioPath,
                ]
            } else {
                ffmpegArgs = [
                    '-i',
                    this.webmPath,
                    '-async',
                    '1',
                    '-ss',
                    timeStart.toString(),
                    '-to',
                    timeEnd.toString(),
                    '-vn',
                    '-c:a',
                    'pcm_s16le',
                    '-ac',
                    '1',
                    '-y',
                    outputAudioPath,
                ]
            }

            const child = spawn('ffmpeg', ffmpegArgs, {
                stdio: ['ignore', 'pipe', 'pipe'],
            })

            let output = ''

            child.stdout.on('data', (data) => {
                output += data.toString()
            })

            child.stderr.on('data', (data) => {
                output += data.toString()
            })

            child.on('close', async (code) => {
                if (code === 0) {
                    resolve()
                } else {
                    this.error('Sortie ffmpeg:', output)
                    if (output.includes('File ended prematurely at pos.')) {
                        try {
                            await fs.unlink(outputAudioPath)
                            this.log(
                                'Output file deleted due to premature termination',
                            )
                        } catch (err) {
                            this.error('Error deleting the output file:', err)
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
        })
    }

    private async appendChunkToWebm(chunk: Buffer): Promise<void> {
        try {
            await fs.appendFile(this.webmPath, new Uint8Array(chunk))
            this.log('Chunk successfully added to the WebM file')
        } catch (err) {
            this.error('Error adding chunk to the WebM file:', err)
            throw err
        }
    }
}

// Creating a global instance
export const TRANSCODER = new Transcoder()