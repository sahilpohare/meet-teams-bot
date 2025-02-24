import * as fs from 'fs/promises'
import * as os from 'os'
import * as path from 'path'
import { createWorker } from 'tesseract.js'
import { sleep } from './utils'
import { PathManager } from './utils/PathManager'

interface FrameResult {
    timestamp: number
    text: string
}

export class FrameAnalyzer {
    private static instance: FrameAnalyzer | null = null
    private worker: Tesseract.Worker | null = null
    private isInitialized: boolean = false
    private framesOcrResults: FrameResult[] = []
    private isProcessing: boolean = false
    private workerError: boolean = false

    private constructor() {}

    public static getInstance(): FrameAnalyzer {
        if (!FrameAnalyzer.instance) {
            FrameAnalyzer.instance = new FrameAnalyzer()
        }
        return FrameAnalyzer.instance
    }

    public async initialize(): Promise<void> {
        if (this.isInitialized) return

        console.log('Initializing Frame Analyzer...')
        try {
            this.worker = await createWorker('eng').catch((err) => {
                console.error('Failed to create Tesseract worker:', err)
                return null
            })

            if (this.worker) {
                this.isInitialized = true
                this.workerError = false
                console.log('Frame Analyzer initialized successfully')
            } else {
                console.log('Frame Analyzer will run in degraded mode (no OCR)')
                this.workerError = true
            }
        } catch (error) {
            console.error('Failed to initialize Frame Analyzer:', error)
            this.workerError = true
            // Ne pas propager l'erreur
        }
    }

    private async waitForFile(
        filePath: string,
        maxAttempts: number = 5,
    ): Promise<boolean> {
        for (let i = 0; i < maxAttempts; i++) {
            try {
                const stats = await fs.stat(filePath)
                if (stats.size > 0) {
                    return true
                }
                console.log(
                    `File exists but empty, attempt ${i + 1}/${maxAttempts}`,
                )
            } catch (err) {
                console.log(`Waiting for file, attempt ${i + 1}/${maxAttempts}`)
            }
            await sleep(100)
        }
        return false
    }

    public async processNewFrame(
        filePath: string,
        timestamp: number,
    ): Promise<void> {
        // Si on a eu une erreur avec le worker, on skip silencieusement
        if (this.workerError) {
            try {
                await fs.unlink(filePath).catch(() => {})
            } catch (err) {}
            return
        }

        if (!this.worker || !this.isInitialized) {
            console.log('OCR not available, skipping frame')
            try {
                await fs.unlink(filePath).catch(() => {})
            } catch (err) {}
            return
        }

        if (this.isProcessing) {
            console.log('Already processing a frame, skipping...')
            try {
                await fs.unlink(filePath).catch(() => {})
            } catch (err) {}
            return
        }

        this.isProcessing = true

        try {
            const fileReady = await this.waitForFile(filePath)
            if (!fileReady) {
                console.log('File not ready, skipping frame')
                return
            }

            const imageBuffer = await fs.readFile(filePath)
            if (imageBuffer.length === 0) {
                console.log('Empty image, skipping')
                return
            }

            try {
                const {
                    data: { text },
                } = await this.worker.recognize(imageBuffer)

                this.framesOcrResults.push({
                    timestamp,
                    text: text || '',
                })

                if (this.framesOcrResults.length > 10) {
                    this.framesOcrResults.shift()
                }

                console.log(
                    `Frame processed successfully, text length: ${(text || '').length}`,
                )
            } catch (ocrError) {
                console.error('OCR failed for frame:', ocrError)
                // Ne pas propager l'erreur OCR
            }
        } catch (error) {
            console.error('Error in frame processing:', error)
            // Ne pas propager l'erreur
        } finally {
            // Toujours essayer de nettoyer le fichier
            try {
                await fs.unlink(filePath).catch(() => {})
            } catch (err) {}

            this.isProcessing = false
        }
    }

    public getLastFrameText(): string | null {
        if (this.framesOcrResults.length === 0) {
            return null
        }
        return this.framesOcrResults[this.framesOcrResults.length - 1].text
    }

    public getAllResults(): FrameResult[] {
        return [...this.framesOcrResults]
    }

    public async getFramesDirectory(): Promise<string> {
        try {
            // Récupérer le chemin de base de la vidéo
            const videoDir = PathManager.getInstance().getBasePath()
            console.log('Video directory:', videoDir)

            // Construire le chemin pour les frames
            const framesDir = videoDir
                ? path.join(path.dirname(videoDir), 'frames')
                : path.join(os.tmpdir(), 'frames')

            console.log('Frames will be written to:', framesDir)

            // Créer le répertoire si nécessaire
            await fs.mkdir(framesDir, { recursive: true })

            // Vérifier que le répertoire existe et est accessible
            const stats = await fs.stat(framesDir)
            console.log('Frames directory stats:', {
                path: framesDir,
                mode: stats.mode.toString(8),
                uid: stats.uid,
                gid: stats.gid,
            })

            return framesDir
        } catch (err) {
            console.error('Error in getFramesDirectory:', err)
            throw err
        }
    }

    public async cleanup(): Promise<void> {
        try {
            if (this.worker && !this.workerError) {
                await this.worker.terminate().catch(() => {})
            }
        } catch (err) {
            console.error('Error during worker cleanup:', err)
        }

        this.worker = null
        this.isInitialized = false
        this.framesOcrResults = []
        this.workerError = false
        console.log('Frame Analyzer cleaned up')
    }
}
