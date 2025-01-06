import * as asyncLib from 'async'

import { ApiService } from '../recordingServerApi'

import { RecognizerWord, api } from '../api'
import { START_RECORD_TIMESTAMP } from '../record'
import { parseGladia, recognizeGladia } from './providers/gladia'
import { parseRunPod, recognizeRunPod } from './providers/runpod'

import { sleep } from '../api'
import { parameters } from '../background'
import { newTranscribeQueue } from '../queue'

// milisseconds transcription chunk duration
const TRANSCRIPTION_CHUNK_DURATION = 60 * 1000 * 3 // // 3 minutes

/**
 * Transcribes an audio stream using the recognizer of the underlying Node server.
 * TODO : 'underlying Node server' ??? I think this comment is bullshit
 */
export class Transcriber {
    static TRANSCRIBER: Transcriber | undefined

    private stopped = false
    private rebootTimer: NodeJS.Timer
    private transcribeQueue: asyncLib.QueueObject<() => void>
    private wordPosterWorker: Promise<void>
    private transcriptionOffset: number = 0 // is seconds

    /** Returns a new `Transcriber`. */
    private constructor() {
        this.rebootTimer = setInterval(() => {}, 60 * 1000)
        this.transcribeQueue = newTranscribeQueue()
        // Simply not to have undefined properties
        this.wordPosterWorker = new Promise((resolve) => resolve())
    }

    /**
     * Initialize and start the transcriber.
     */
    public static async init(): Promise<void> {
        try {
            Transcriber.TRANSCRIBER = new Transcriber()
        } catch (e) {
            console.error('[Transcriber] error creating transcriber', e)
            throw e
        }
        await Transcriber.TRANSCRIBER.start()
    }

    /**
     * Request the latest transcription and stop the transcriber for good.
     */
    public async stop(): Promise<void> {
        clearInterval(this.rebootTimer)
        this.transcribeQueue.push(async () => {
            await Transcriber.TRANSCRIBER?.transcribe(true)
        })
    }

    /**
     * Ends the transcribing, and destroys resources.
     * Waits for the workers to finish, and destroys the transcbriber.
     */
    public async waitUntilComplete(): Promise<void> {
        console.log('[Transcriber] before transcribe queue drain')
        this.transcribeQueue.push(async () => {
            return
        })
        await this.transcribeQueue.drain()
        console.log('[Transcriber] after transcribe queue drain')

        this.stopped = true

        await this.wordPosterWorker
    }

    /**
     * Check if the transcriber is still active.
     */
    public is_running(): boolean {
        return !this.stopped
    }

    private async start(): Promise<void> {
        try {
            if (
                parameters.bot_uuid == null ||
                parameters.speech_to_text_provider != null
            ) {
                this.rebootTimer = setInterval(() => {
                    this.transcribeQueue.push(async () => {
                        await Transcriber.TRANSCRIBER?.transcribe(false) // ? => ID undefined, it is okay
                    })
                }, TRANSCRIPTION_CHUNK_DURATION)
            }
        } catch (e) {
            console.error('[Transcriber] error initializing reboot timer', e)
            throw e
        }
    }

    private async transcribe(final: boolean): Promise<void> {
        let currentOffset = this.transcriptionOffset
        let newOffset = (Date.now() - START_RECORD_TIMESTAMP) / 1000
        const timeStart = currentOffset
        const timeEnd = final ? -1 : newOffset
        const s3Path = `${parameters.user_id}/${parameters.bot_uuid}/${timeStart}-${timeEnd}-record.wav`
        this.transcriptionOffset = newOffset
        await sleep(15000)
        console.log(
            '[Transcriber] ready to do transcription between: ',
            currentOffset,
            newOffset,
        )
        try {
            const audioUrl = (
                (await ApiService.sendMessageToRecordingServer(
                    'EXTRACT_AUDIO',
                    {
                        timeStart,
                        timeEnd,
                        bucketName: parameters.s3_bucket,
                        s3Path,
                    },
                )) as any
            ).s3Url
            console.log(audioUrl)

            let words: RecognizerWord[]
            switch (parameters.speech_to_text_provider) {
                case 'Runpod':
                    let res_runpod = await recognizeRunPod(
                        audioUrl,
                        parameters.vocabulary, // TODO : Envisager utiliser sur meeting baas.
                    )
                    words = parseRunPod(res_runpod, currentOffset)
                    break
                case 'Default':
                case 'Gladia':
                    let res_gladia = await recognizeGladia(
                        audioUrl,
                        parameters.vocabulary, // TODO : Envisager utiliser sur meeting baas.
                    )
                    words = parseGladia(res_gladia, currentOffset)
                    break
                default:
                    console.error(
                        'Unknown Transcription Provider !',
                        parameters.speech_to_text_provider,
                    )
                    words = new Array()
            }
            console.log('[Transcriber] [onResult] ')
            const bot = await api.getBot(parameters.bot_uuid).catch((e) => {
                console.error('Failed to get bot :', e)
                throw e
            })
            await api.postWords(words, bot.bot.id).catch((e) => {
                console.error('Failed to post words :', e)
                throw e
            })
        } catch (e) {
            console.error(
                '[Transcriber] an error occured calling transcriber, ',
                e,
            )
        } finally {
            try {
                await ApiService.sendMessageToRecordingServer(
                    'DELETE_S3_FILE',
                    {
                        s3Path,
                        bucketName: parameters.s3_bucket,
                    },
                )
            } catch (e) {
                console.error(
                    '[Transcriber] an error occured deleting audio from S3, ',
                    e,
                )
            }
            //TODO : Delete audio from S3
        }
    }
}
