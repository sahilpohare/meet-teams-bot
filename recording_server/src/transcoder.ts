import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { Writable } from 'stream'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export class Transcoder {
    private outputPath: string
    private bucketName: string
    private child: ChildProcess | null = null
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
            console.error(`Cannot create new webm file: ${err}`)
        }
    }

    public async init(bucketName: string, videoS3Path: string): Promise<void> {
        if (this.child) {
            console.log('Transcoder déjà initialisé')
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

        // Lancer la commande ffmpeg de manière asynchrone
        this.child = spawn('ffmpeg', ffmpegArgs, {
            stdio: ['pipe', 'inherit', 'inherit'],
        })

        console.log('Commande ffmpeg lancée avec succès.')
        return
    }

    // Méthode asynchrone pour écrire dans stdin
    private async writeToChildStdin(data: Buffer): Promise<void> {
        if (!this.child || !this.child.stdin) {
            throw new Error(
                "Le processus enfant n'est pas initialisé ou stdin n'est pas disponible",
            )
        }

        return new Promise<void>((resolve, reject) => {
            const stdin = this.child!.stdin as Writable
            const canContinue = stdin.write(data)

            if (canContinue) {
                resolve()
            } else {
                stdin.once('drain', resolve)
            }
        })
    }

    // Nouvelle méthode pour fermer stdin
    private closeChildStdin(): void {
        if (!this.child || !this.child.stdin) {
            console.log(
                "Le processus enfant n'est pas initialisé ou stdin n'est pas disponible",
            )
            return
        }
        this.child.stdin.end()
        console.log('stdin du processus enfant fermé')
    }

    public async stop(): Promise<void> {
        if (!this.child) {
            console.log('Transcoder non initialisé, rien à arrêter.')
            return
        }

        this.closeChildStdin()
        console.log('Arrêt du transcoder...')

        // Attendre que le processus enfant se termine
        await new Promise<void>((resolve, reject) => {
            this.child!.on('close', (code) => {
                console.log(
                    `Processus transcode_video.sh terminé avec le code ${code}`,
                )
                this.child = null
                resolve()
            })

            setTimeout(() => {
                if (this.child) {
                    this.child.kill('SIGTERM')
                    reject(new Error("Timeout lors de l'arrêt du transcoder"))
                }
            }, 60000) // 30 secondes de timeout
        })
        this.uploadToS3(this.outputPath, this.bucketName, this.videoS3Path)
    }

    public async uploadChunk(chunk: Buffer): Promise<void> {
        if (!this.child) {
            throw new Error('Transcoder non initialisé')
        }

        try {
            await this.appendChunkToWebm(chunk)
            await this.writeToChildStdin(chunk)
            console.log(
                'Chunk écrit avec succès dans ffmpeg et ajouté au fichier WebM',
            )
        } catch (err) {
            console.error(
                "Erreur lors de l'écriture du chunk dans ffmpeg ou de l'ajout au fichier WebM:",
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
    ): Promise<string> {
        return new Promise((resolve, reject) => {
            const fileName = path.basename(filePath)
            const s3FullPath = `s3://${bucketName}/${s3Path}/${fileName}`

            const awsCommand = spawn('aws', [
                's3',
                'cp',
                filePath,
                s3FullPath,
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
                    const publicUrl = `https://${bucketName}.s3.amazonaws.com/${s3Path}/${fileName}`
                    console.log(`Fichier uploadé avec succès: ${publicUrl}`)
                    resolve(publicUrl)
                } else {
                    console.error(
                        "Erreur lors de l'upload vers S3:",
                        errorOutput,
                    )
                    reject(
                        new Error(`Échec de l'upload S3 avec le code ${code}`),
                    )
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
        if (!this.child) {
            throw new Error('Transcoder non initialisé')
        }

        const outputAudioPath = path.join(
            os.tmpdir(),
            `output_${Date.now()}.wav`,
        )
        const maxRetries = 5
        const retryDelay = 10000 // 10 secondes

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.runExtractAudio(outputAudioPath, timeStart, timeEnd)
                console.log(
                    `Extraction audio réussie à la tentative ${attempt}`,
                )

                // Upload du fichier audio vers S3
                const s3Url = await this.uploadToS3(
                    outputAudioPath,
                    bucketName,
                    s3Path,
                )
                console.log(
                    `Fichier audio uploadé sur S3 à la tentative ${attempt}`,
                )
                return s3Url
            } catch (error) {
                console.error(
                    `Échec de l'extraction audio ou de l'upload à la tentative ${attempt}:`,
                    error,
                )
                if (attempt === maxRetries) {
                    throw new Error(
                        `Échec de l'extraction audio ou de l'upload après ${maxRetries} tentatives`,
                    )
                }
                await sleep(retryDelay)
            }
        }

        throw new Error('Extraction audio et upload échoués après 5 tentatives')
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
                    console.error('Sortie ffmpeg:', output)
                    if (output.includes('File ended prematurely at pos.')) {
                        try {
                            await fs.unlink(outputAudioPath)
                            console.log(
                                "Fichier de sortie supprimé en raison d'une fin prématurée",
                            )
                        } catch (err) {
                            console.error(
                                'Erreur lors de la suppression du fichier de sortie:',
                                err,
                            )
                        }
                        reject(
                            new Error("Le fichier s'est terminé prématurément"),
                        )
                    } else {
                        reject(
                            new Error(
                                `Échec de l'extraction audio avec le code ${code}`,
                            ),
                        )
                    }
                }
            })
        })
    }

    private async appendChunkToWebm(chunk: Buffer): Promise<void> {
        try {
            await fs.appendFile(this.webmPath, chunk)
            console.log('Chunk ajouté avec succès au fichier WebM')
        } catch (err) {
            console.error(
                "Erreur lors de l'ajout du chunk au fichier WebM:",
                err,
            )
            throw err
        }
    }
}

// Création d'une instance globale
export const TRANSCODER = new Transcoder()
