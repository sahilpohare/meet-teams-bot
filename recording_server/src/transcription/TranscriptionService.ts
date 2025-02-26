import { queue, QueueObject } from 'async'
import { EventEmitter } from 'events'

import { GladiaProvider } from './providers/GladiaProvider'
import { RunPodProvider } from './providers/RunPodProvider'
import {
    TranscriptionProvider,
    TranscriptionResult,
} from './providers/TranscriptionProvider'
import { WordsPoster } from './WordPoster'


export type SpeechToTextProvider = 'Gladia' | 'Runpod' | 'Default'

export interface TranscriptionSegment {
    id: string
    startTime: number
    endTime: number
    audioUrl?: string
    status: 'pending' | 'processing' | 'completed' | 'failed' | 'skipped'
    results?: TranscriptionResult[]
    error?: Error
    retryCount: number
}

interface TranscriptionOptions {
    maxRetries?: number
    maxConcurrent?: number
    retryDelay?: number
    vocabulary?: string[]
}

interface TranscriptionServiceOptions extends TranscriptionOptions {
    onTranscriptionComplete?: (
        results: TranscriptionResult[],
        segment: TranscriptionSegment,
    ) => Promise<void>
}

type TranscriptionTask = () => Promise<void>

export class TranscriptionService extends EventEmitter {
    private segments: Map<string, TranscriptionSegment> = new Map()
    private transcriptionQueue: QueueObject<TranscriptionTask>
    private provider: TranscriptionProvider
    private isPaused: boolean = false

    constructor(
        providerType: SpeechToTextProvider,
        private apiKey: string,
        private options: TranscriptionServiceOptions = {},
        private wordsPoster?: WordsPoster,
    ) {
        super()
        this.provider = this.createProvider(providerType)
        this.setupQueue()
        this.setupEventListeners()
    }

    private setupEventListeners() {
        if (this.options.onTranscriptionComplete) {
            this.on('transcriptionComplete', async ({ results, segment }) => {
                try {
                    await this.options.onTranscriptionComplete(results, segment)
                } catch (error) {
                    console.error('Error saving transcription results:', error)
                    this.emit('error', error)
                }

            })
        }
        if (this.wordsPoster) {
            this.on('transcriptionComplete', async ({ results, segment }) => {
                try {
                    await this.wordsPoster.saveToDatabase(results, segment)
                } catch (error) {
                    console.error('Error posting words to database:', error)
                    this.emit('error', error)
                }
            })
        }
    }

    private createProvider(type: SpeechToTextProvider): TranscriptionProvider {
        switch (type) {
            case 'Default':
            case 'Runpod':
                return new RunPodProvider(this.apiKey)
            case 'Gladia':
                return new GladiaProvider(this.apiKey)

            default:
                throw new Error(`Unknown provider type or unsuported provider: ${type}`)
        }
    }

    private setupQueue() {
        this.transcriptionQueue = queue<TranscriptionTask>(
            async (task, callback) => {
                if (this.isPaused) {
                    callback()
                    return
                }

                try {
                    await task()
                    callback()
                } catch (error) {
                    callback(error as Error)
                }
            },
            this.options.maxConcurrent || 2,
        )

        this.transcriptionQueue.drain(() => {
            this.emit('queueDrained')
        })
    }

    public async transcribeSegment(
        startTime: number,
        endTime: number,
        audioUrl: string,
    ): Promise<void> {
        const segmentId = `${startTime}-${endTime}`

        if (this.segments.has(segmentId)) {
            const segment = this.segments.get(segmentId)!
            if (segment.status === 'completed') {
                return
            }
        }

        this.segments.set(segmentId, {
            id: segmentId,
            startTime,
            endTime,
            audioUrl,
            status: 'pending',
            retryCount: 0,
        })

        return new Promise((resolve) => {
            this.transcriptionQueue.push(async () => {
                try {
                    await this.processSegment(segmentId)
                } catch (error) {
                    console.error(`Error processing segment ${segmentId}:`, error)
                } finally {
                    resolve()
                }
            })
        })
    }

    private async processSegment(segmentId: string): Promise<void> {
        const segment = this.segments.get(segmentId)
        if (!segment) return

        try {
            segment.status = 'processing'
            this.emit('processingSegment', { segmentId, segment })

            // Ajouter un timeout pour éviter les blocages
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('Transcription timeout')), 60000); // 60 secondes
            });

            // Tentative de transcription avec timeout
            const results = await Promise.race([
                this.provider.recognize(
                    segment.audioUrl!,
                    this.options.vocabulary || [],
                ),
                timeoutPromise
            ]).catch(error => {
                console.warn(`Transcription failed or timed out: ${error.message}`);
                return []; // Retourner un tableau vide en cas d'erreur
            });

            // Mise à jour du segment avec les résultats
            segment.status = 'completed'
            segment.results = results
            this.segments.set(segmentId, segment)

            this.emit('transcriptionComplete', {
                segmentId,
                results,
                segment,
            })
        } catch (error) {
            console.error(
                `Transcription error for segment ${segmentId}:`,
                error,
            )

            segment.status = 'failed'
            segment.error = error as Error
            segment.retryCount++

            if (segment.retryCount < (this.options.maxRetries || 3)) {
                // Réessayer plus tard
                await this.retrySegment(segment)
            } else {
                // Au lieu de simplement émettre un événement d'échec,
                // on peut marquer le segment comme "skipped" et continuer
                segment.status = 'skipped'
                this.emit('transcriptionSkipped', {
                    segmentId,
                    error,
                    segment,
                })
                
                // Fournir un résultat vide mais valide pour éviter les erreurs en aval
                segment.results = []
                this.segments.set(segmentId, segment)
            }
        }
    }

    private async retrySegment(segment: TranscriptionSegment): Promise<void> {
        await new Promise((resolve) =>
            setTimeout(resolve, this.options.retryDelay || 2000),
        )

        this.emit('retrying', {
            segmentId: segment.id,
            attempt: segment.retryCount,
        })

        return this.transcribeSegment(
            segment.startTime,
            segment.endTime,
            segment.audioUrl!,
        )
    }

    public async pause(): Promise<void> {
        this.isPaused = true
        this.emit('paused')
    }

    public async resume(): Promise<void> {
        this.isPaused = false
        this.emit('resumed')

        // Reprendre le traitement des segments en échec
        const failedSegments = Array.from(this.segments.values()).filter(
            (s) =>
                s.status === 'failed' &&
                s.retryCount < (this.options.maxRetries || 3),
        )

        for (const segment of failedSegments) {
            await this.retrySegment(segment)
        }
    }

    public async stop(): Promise<void> {
        this.isPaused = true
        try {
            await new Promise<void>((resolve) =>
                this.transcriptionQueue.drain(resolve),
            )
            this.emit('stopped')
        } catch (error) {
            console.error('Error stopping transcription service:', error)
            this.emit('error', error)
            // Don't rethrow the error
        }
    }

    public getSegmentStatus(
        segmentId: string,
    ): TranscriptionSegment | undefined {
        return this.segments.get(segmentId)
    }

    public getFailedSegments(): TranscriptionSegment[] {
        return Array.from(this.segments.values()).filter(
            (s) => s.status === 'failed',
        )
    }
}
