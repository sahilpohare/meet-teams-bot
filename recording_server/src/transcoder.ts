import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const mkfifo = promisify(fs.mkfifo)
const unlink = promisify(fs.unlink)
const writeFile = promisify(fs.writeFile)

export class Transcoder {
    private fifoPath: string
    private outputPath: string
    private child: ChildProcess | null = null

    constructor() {
        this.fifoPath = path.join(os.tmpdir(), 'video.pipe')
        this.outputPath = path.join(os.tmpdir(), 'output.mp4')
    }

    private async createFifo(): Promise<void> {
        try {
            await unlink(this.fifoPath)
        } catch (err: any) {
            if (err.code !== 'ENOENT') throw err
        }
        await mkfifo(this.fifoPath, 0o644)
    }

    public async init(audioOnly: boolean = false, color: string = 'black'): Promise<{ fifoPath: string, outputPath: string }> {
        if (this.child) {
            console.log('Transcoder déjà initialisé')
            return { fifoPath: this.fifoPath, outputPath: this.outputPath }
        }

        await this.createFifo()
        console.log('FIFO créée avec succès:', this.fifoPath)
        
        // Lancer le script transcode_video.sh de manière asynchrone
        this.child = spawn('./transcode_video.sh', [this.fifoPath, this.outputPath, audioOnly.toString(), color], {
            detached: true,
            stdio: 'ignore'
        })
        this.child.unref()
        
        console.log('Script lancé avec succès.')
        return { fifoPath: this.fifoPath, outputPath: this.outputPath }
    }

    public stop(): void {
        if (this.child) {
            this.child.kill()
            this.child = null
            console.log('Transcoder arrêté')
        }
    }

    public async upload_chunk(chunk: Buffer): Promise<void> {
        if (!this.child) {
            throw new Error('Transcoder non initialisé')
        }

        try {
            await writeFile(this.fifoPath, chunk, { flag: 'a' })
            console.log('Chunk écrit avec succès dans le FIFO')
        } catch (err) {
            console.error('Erreur lors de l\'écriture du chunk dans le FIFO:', err)
            throw err
        }
    }

    public getOutputPath(): string {
        return this.outputPath
    }

    private uploadToS3(filePath: string, bucketName: string, s3Path: string): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawn('./upload_s3.sh', [filePath, bucketName, s3Path], {
                stdio: 'pipe'
            })

            let output = ''
            child.stdout.on('data', (data) => {
                output += data.toString()
            })

            child.on('close', (code) => {
                if (code === 0) {
                    resolve(output.trim())
                } else {
                    reject(new Error(`Échec de l'upload S3 avec le code ${code}`))
                }
            })
        })
    }

    public async extractAudio(timeStart: number, timeEnd: number, bucketName: string, s3Path: string): Promise<string> {
        if (!this.child) {
            throw new Error('Transcoder non initialisé')
        }

        const outputAudioPath = path.join(os.tmpdir(), `output_${Date.now()}.wav`)
        const maxRetries = 5
        const retryDelay = 10000 // 10 secondes

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                await this.runExtractAudio(outputAudioPath, timeStart, timeEnd)
                console.log(`Extraction audio réussie à la tentative ${attempt}`)
                
                // Upload du fichier audio vers S3
                const s3Url = await this.uploadToS3(outputAudioPath, bucketName, s3Path)
                console.log(`Fichier audio uploadé sur S3: ${s3Url}`)
                
                return s3Url
            } catch (error) {
                console.error(`Échec de l'extraction audio ou de l'upload à la tentative ${attempt}:`, error)
                if (attempt === maxRetries) {
                    throw new Error(`Échec de l'extraction audio ou de l'upload après ${maxRetries} tentatives`)
                }
                await sleep(retryDelay)
            }
        }

        throw new Error('Extraction audio et upload échoués après 5 tentatives')
    }

    private runExtractAudio(outputAudioPath: string, timeStart: number, timeEnd: number): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = spawn('./extract_audio.sh', [this.outputPath, outputAudioPath, timeStart.toString(), timeEnd.toString()], {
                stdio: 'inherit'
            })

            child.on('close', (code) => {
                if (code === 0) {
                    resolve()
                } else {
                    reject(new Error(`Échec de l'extraction audio avec le code ${code}`))
                }
            })
        })
    }
}

// Création d'une instance globale
export const TRANSCODER = new Transcoder()