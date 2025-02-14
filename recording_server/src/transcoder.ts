import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { Writable } from 'stream'
import { Logger } from './logger'

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
    private originalWebmPath: string;  // Chemin du fichier en cours d'écriture
    private finalizedWebmPath: string | null = null;  // Chemin du fichier finali
    private currentTranscriptionPromises: Array<Promise<void> | undefined> = [];

    static EXTRACT_AUDIO_MAX_RETRIES: number = 5
    static EXTRACT_AUDIO_RETRY_DELAY: number = 10_000 // 10 seconds

    constructor() {
        this.originalWebmPath = path.join(os.tmpdir(), 'output.webm');
        this.webmPath = this.originalWebmPath;

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
            '+frag_keyframe+empty_moov',
            '-y',
            this.videoOutputPath,
            '-loglevel',
            'verbose',
        ]

        // Run the ffmpeg command asynchronously
        this.ffmpeg_process = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['pipe', 'inherit', 'inherit'],
        })
        console.log('FFmpeg command launched successfully')
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

    public async finalize(): Promise<void> {
        console.log('Transcoder finalization started');
        console.log(`Number of pending transcriptions: ${this.currentTranscriptionPromises.length}`);
        // D'abord attendre toutes les transcriptions en cours
        await Promise.all(this.currentTranscriptionPromises);
        console.log('All transcriptions completed, sending final chunk...');
        // Puis envoyer le dernier chunk
        await this.uploadChunk(Buffer.alloc(0), true);
        // Enfin arrêter
        await this.stop();
        console.log('Transcoder finalization completed');
    }

    public async stop(): Promise<void> {
        console.log('Stop called - Starting stop sequence')
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
    private async finalizeWebm(): Promise<string> {
        console.log('Finalizing WebM - Starting...');
        // Créer une nouvelle copie à chaque fois
        this.finalizedWebmPath = `${this.originalWebmPath}_final_${Date.now()}`;
        console.log(`Copying WebM from ${this.originalWebmPath} to ${this.finalizedWebmPath}`);
        await fs.stat(this.originalWebmPath).then(stats => {
            console.log(`Original WebM size: ${stats.size} bytes`);
        });
        await fs.copyFile(this.originalWebmPath, this.finalizedWebmPath);
        await fs.stat(this.finalizedWebmPath).then(stats => {
            console.log(`Finalized WebM size: ${stats.size} bytes`);
        });
        console.log('Finalizing WebM - Complete');
        return this.finalizedWebmPath;
    }
    
    public async uploadChunk(chunk: Buffer, isFinal: boolean): Promise<void> {
        console.log(`=== uploadChunk start (isFinal: ${isFinal}, size: ${chunk.length}) ===`);
        if (this.transcoder_successfully_stopped) {
            console.log('Transcoder is in stop state!');
            return;
        }
    
        try {
            if (isFinal && chunk.length === 0) {
                console.log('Processing final empty chunk');
                console.log('Waiting for file stability...');
                await Promise.all(this.currentTranscriptionPromises);
                console.log('All pending transcriptions completed');

                await new Promise(resolve => setTimeout(resolve, 1000));
                
                const webmPath = await this.finalizeWebm();
                console.log(`Using finalized WebM at: ${webmPath}`);
                
                const chunksPerTranscribe = this.transcribeDuration / this.chunkDuration;
                const lastCompleteSegment = Math.floor((this.chunkReceavedCounter - 1) / chunksPerTranscribe) * chunksPerTranscribe;
                const timeStart = lastCompleteSegment * this.chunkDuration;
                const timeEnd = this.chunkReceavedCounter * this.chunkDuration;
                
                console.log('Final transcription info:', {
                    chunksPerTranscribe,
                    chunkReceavedCounter: this.chunkReceavedCounter,
                    lastCompleteSegment,
                    timeStart,
                    timeEnd,
                    duration: timeEnd - timeStart
                });
                
                console.log(`Pushing final transcription: ${timeStart}ms to ${timeEnd}ms`);
                await WordsPoster.TRANSCRIBER?.push(timeStart, timeEnd);
                console.log('Final transcription pushed');
                return;
            }
    
            this.chunkReceavedCounter++;
            console.log(`Processing regular chunk #${this.chunkReceavedCounter}`);
            await this.appendChunkToWebm(chunk);
            await this.writeToChildStdin(chunk);
    
            const chunksPerTranscribe = this.transcribeDuration / this.chunkDuration;
            console.log('Regular chunk info:', {
                chunkReceavedCounter: this.chunkReceavedCounter,
                chunksPerTranscribe,
                modulo: this.chunkReceavedCounter % chunksPerTranscribe
            });
    
            if (this.chunkReceavedCounter % chunksPerTranscribe === 0) {
                const timeStart = (this.chunkReceavedCounter - chunksPerTranscribe) * this.chunkDuration;
                const timeEnd = timeStart + this.transcribeDuration;
                console.log(`Pushing regular transcription: ${timeStart}ms to ${timeEnd}ms`);
                const transcriptionPromise = WordsPoster.TRANSCRIBER?.push(timeStart, timeEnd);
                this.currentTranscriptionPromises.push(transcriptionPromise);
                console.log('Regular transcription pushed');
            }
        } catch (err) {
            console.error('Error in uploadChunk:', err);
            throw err;
        } finally {
            console.log('=== uploadChunk end ===');
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
        if (!this.ffmpeg_process) {
            throw new Error('Transcoder not initialized')
        }
        // TODO : Given _bucketName is completly bullshit here !!! FUCK IT !
        let bucketName: string = process.env.AWS_S3_TEMPORARY_AUDIO_BUCKET

        const outputAudioPath = path.join(
            os.tmpdir(),
            `output_${Date.now()}.wav`,
        )

        for (
            let attempt = 1;
            attempt <= Transcoder.EXTRACT_AUDIO_MAX_RETRIES;
            attempt++
        ) {
            try {
                await this.runExtractAudio(outputAudioPath, timeStart, timeEnd)
                console.log(`Audio extraction successful on attempt ${attempt}`)

                // Uploading audio file to S3
                const s3Url = await this.uploadToS3(
                    outputAudioPath,
                    bucketName,
                    s3Path,
                    true,
                )
                console.log(`Audio file uploaded to S3 on attempt ${attempt}`)
                return s3Url
            } catch (error) {
                console.error(
                    `Audio extraction or upload failed on attempt ${attempt}:`,
                    error,
                )
                if (attempt === Transcoder.EXTRACT_AUDIO_MAX_RETRIES) {
                    throw new Error(
                        `Audio extraction or upload failed after ${Transcoder.EXTRACT_AUDIO_MAX_RETRIES} attempts`,
                    )
                }
                await sleep(Transcoder.EXTRACT_AUDIO_RETRY_DELAY)
            } finally {
                try {
                    await fs.unlink(outputAudioPath)
                } catch (err) {
                    console.error('Error deleting the audio file:', err)
                }
            }
        }

        throw new Error(
            `Audio extraction and upload failed after ${Transcoder.EXTRACT_AUDIO_MAX_RETRIES} attempts`,
        )
    }

    private async runExtractAudio(
        outputAudioPath: string,
        timeStart: number,
        timeEnd: number,
    ): Promise<void> {
        console.log('=== Starting Audio Extraction Process ===');
        console.log(`Parameters: timeStart=${timeStart}ms, timeEnd=${timeEnd}ms`);
        console.log(`Target output: ${outputAudioPath}`);
    
        const webmToExtract = await this.finalizeWebm();
        console.log(`Using WebM file: ${webmToExtract}`);
        
        const tempFullWav = `${outputAudioPath}_full.wav`;
        console.log(`Temporary full WAV will be: ${tempFullWav}`);
        
        return new Promise(async (resolve, reject) => {
            try {
                // 1. Extraction complète en WAV
                console.log('Step 1: Extracting full audio to WAV');
                const fullExtractionArgs = [
                    '-y',
                    '-i', webmToExtract,
                    '-vn',
                    '-c:a', 'pcm_s16le',
                    '-ac', '1',
                    tempFullWav
                ] as string[];
                
                console.log('Running full extraction command:', fullExtractionArgs.join(' '));
                
                await new Promise<void>((resolveExtract, rejectExtract) => {
                    const child = spawn('ffmpeg', fullExtractionArgs);
                    
                    let extractOutput = '';
                    
                    if (child.stderr) {
                        child.stderr.on('data', (data) => {
                            const output = data.toString();
                            extractOutput += output;
                            console.log('Full Extraction FFmpeg:', output);
                        });
                    }
    
                    child.on('close', async (code) => {
                        if (code === 0) {
                            try {
                                const stats = await fs.stat(tempFullWav);
                                console.log(`Full WAV extraction complete. File size: ${stats.size} bytes`);
                                resolveExtract();
                            } catch (err) {
                                console.error('Error checking full WAV:', err);
                                rejectExtract(new Error('Full WAV verification failed'));
                            }
                        } else {
                            console.error(`Full extraction failed with code ${code}`);
                            console.error('Full extraction output:', extractOutput);
                            rejectExtract(new Error(`Full extraction failed with code ${code}`));
                        }
                    });
                });
    
                // 2. Découpage du segment
                console.log('Step 2: Trimming WAV to requested segment');
                const trimArgs = [
                    '-y',
                    '-i', tempFullWav,
                    '-ss', (timeStart / 1000).toString(),
                    '-t', ((timeEnd - timeStart) / 1000).toString(),
                    '-c', 'copy',
                    outputAudioPath
                ] as string[];
    
                console.log('Running trim command:', trimArgs.join(' '));
    
                await new Promise<void>((resolveTrim, rejectTrim) => {
                    const child = spawn('ffmpeg', trimArgs);
                    
                    let trimOutput = '';
                    
                    if (child.stderr) {
                        child.stderr.on('data', (data) => {
                            const output = data.toString();
                            trimOutput += output;
                            console.log('Trim FFmpeg:', output);
                        });
                    }
    
                    child.on('close', async (code) => {
                        if (code === 0) {
                            try {
                                const stats = await fs.stat(outputAudioPath);
                                console.log(`Trim complete. Final file size: ${stats.size} bytes`);
                                resolveTrim();
                            } catch (err) {
                                console.error('Error checking trimmed WAV:', err);
                                rejectTrim(new Error('Trimmed WAV verification failed'));
                            }
                        } else {
                            console.error(`Trim failed with code ${code}`);
                            console.error('Trim output:', trimOutput);
                            rejectTrim(new Error(`Trim failed with code ${code}`));
                        }
                    });
                });
    
                console.log('Both steps completed successfully');
                resolve();
    
            } catch (err) {
                console.error('Error in audio extraction process:', err);
                reject(err);
            } finally {
                // Nettoyage
                console.log('Cleaning up temporary files...');
                try {
                    await fs.unlink(tempFullWav);
                    console.log(`Temporary file ${tempFullWav} deleted`);
                } catch (err) {
                    console.error('Error cleaning up temp WAV:', err);
                }
            }
        });
    }

    private async appendChunkToWebm(chunk: Buffer): Promise<void> {
        try {
            await fs.appendFile(this.originalWebmPath, new Uint8Array(chunk));
            console.log('Chunk successfully added to the WebM file')
        } catch (err) {
            console.error('Error adding chunk to the WebM file:', err)
            throw err
        }
    }
}

// Creating a global instance
export const TRANSCODER = new Transcoder()
