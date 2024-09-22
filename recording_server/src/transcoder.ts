import { ChildProcess, spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { promisify } from 'util'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const writeFile = promisify(fs.writeFile)

export class Transcoder {
    private outputPath: string
    private child: ChildProcess | null = null
    private videoS3Path: string

    constructor() {
        this.outputPath = path.join(os.tmpdir(), 'output.mp4')
    }

    public async init(bucketName: string, videoS3Path: string, audioOnly: boolean = false, color: string = 'black'): Promise<void> {
        if (this.child) {
            console.log('Transcoder déjà initialisé')
            return
        }
        this.videoS3Path = videoS3Path

        // Lancer le script transcode_video.sh de manière asynchrone
        this.child = spawn('./transcode_video.sh', [this.outputPath, audioOnly.toString(), color], {
            detached: true,
            stdio: ['pipe', 'inherit', 'inherit']
        })
        
        console.log('Script lancé avec succès.')
        return
    }
    // Méthode pour écrire dans stdin
    private writeToChildStdin(data: string | Buffer): void {
        if (!this.child || !this.child.stdin) {
            throw new Error('Le processus enfant n\'est pas initialisé ou stdin n\'est pas disponible')
        }
        this.child.stdin.write(data)
    }

    // Nouvelle méthode pour fermer stdin
    private closeChildStdin(): void {
        if (!this.child || !this.child.stdin) {
            console.log('Le processus enfant n\'est pas initialisé ou stdin n\'est pas disponible')
            return
        }
        this.child.stdin.end()
        console.log('stdin du processus enfant fermé')
    }


    public async stop(): Promise<void> {
        if (!this.child) {
            console.log('Transcoder non initialisé, rien à arrêter.');
            return;
        }

        console.log('Arrêt du transcoder...');

        this.closeChildStdin()

        // Attendre que le processus enfant se termine
        await (new Promise<void>((resolve, reject) => {
            this.child!.on('close', (code) => {
                console.log(`Processus transcode_video.sh terminé avec le code ${code}`);
                this.child = null;
                resolve();
            });

            setTimeout(() => {
                if (this.child) {
                    this.child.kill('SIGTERM');
                    reject(new Error('Timeout lors de l\'arrêt du transcoder'));
                }
            }, 60000); // 30 secondes de timeout
        }))
        this.uploadToS3(this.outputPath, this.bucketName, this.videoS3Path)
    }

    public async upload_chunk(chunk: Buffer): Promise<void> {
        if (!this.child) {
            throw new Error('Transcoder non initialisé')
        }

        try {
            this.writeToChildStdin(chunk)
            console.log('Chunk écrit avec succès dans ffmpeg')
        } catch (err) {
            console.error('Erreur lors de l\'écriture du chunk dans ffmpeg:', err)
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