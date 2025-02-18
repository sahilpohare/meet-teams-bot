import * as asyncLib from 'async'

import { Api } from '../api/methods'
import { parseGladia, recognizeGladia } from './providers/gladia'
import { parseRunPod, recognizeRunPod } from './providers/runpod'

import { TRANSCODER } from '../transcoder'
import { MeetingParams } from '../types'
import { delete_s3_file } from '../utils'

// Output word of the `Recognizer`.
export type RecognizerWord = {
    text: string
    start_time: number
    end_time: number
}

function newTranscribeQueue() {
    return asyncLib.queue(async function (
        task: () => Promise<void>,
        done: any,
    ) {
        await task()
        done()
    }, 10)
}

// Transcribes an audio stream using the recognizer of the underlying Node server.
export class WordsPoster {
    static TRANSCRIBER: WordsPoster | undefined

    private bot_uuid: string
    private speech_to_text_provider: string | null
    private speech_to_text_api_key: string | null
    private s3_bucket: string
    private user_id: number
    private vocabulary: string[]

    private stopped = false
    private transcribeQueue: asyncLib.QueueObject<() => void>

    // Returns a new `WordsPoster`.
    private constructor(params: MeetingParams) {
        this.bot_uuid = params.bot_uuid
        this.speech_to_text_provider = params.speech_to_text_provider
        this.speech_to_text_api_key = params.speech_to_text_api_key
        this.s3_bucket = process.env.AWS_S3_TEMPORARY_AUDIO_BUCKET
        this.user_id = params.user_id
        this.vocabulary = params.vocabulary

        this.transcribeQueue = newTranscribeQueue()
    }

    // Initialize and start the transcriber.
    public static async init(params: MeetingParams): Promise<void> {
        console.log('[WordsPoster] Initializing with params:', {
            bot_uuid: params.bot_uuid,
            provider: params.speech_to_text_provider,
        })
        if (WordsPoster.TRANSCRIBER) {
            console.warn('[WordsPoster] Transcriber already initialized!')
            return
        }
        try {
            WordsPoster.TRANSCRIBER = new WordsPoster(params)
            console.log(
                '[WordsPoster] Successfully initialized new transcriber',
            )
        } catch (e) {
            console.error('[WordsPoster] Error creating transcriber:', e)
            throw e
        }
    }

    // Request e new Transcribe
    public async push(timeStart: number, timeEnd: number): Promise<void> {
        console.log(
            `[WordsPoster] Queuing transcription task ${timeStart}-${timeEnd}`,
        )
        return new Promise((resolve, reject) => {
            this.transcribeQueue.push(async () => {
                console.log(
                    `[WordsPoster] Starting transcription ${timeStart}-${timeEnd}`,
                )
                try {
                    await WordsPoster.TRANSCRIBER?.transcribe(
                        timeStart,
                        timeEnd,
                    )
                    console.log(
                        `[WordsPoster] Transcription completed ${timeStart}-${timeEnd}`,
                    )
                    resolve()
                } catch (error) {
                    console.error(
                        `[WordsPoster] Transcription failed ${timeStart}-${timeEnd}:`,
                        error,
                    )
                    reject(error)
                }
            })
        })
    }

    // Request the latest transcription and stop the transcriber for good.
    public async stop(): Promise<void> {
        console.log('stop called')
        if (this.stopped) {
            console.error('WordPoster already stoped!')
        }

        console.log('[WordsPoster] Waiting for queue to drain...')
        console.log(
            `[WordsPoster] Queue length: ${this.transcribeQueue.length()}`,
        )
        console.log('before transcribe queue drain')
        this.transcribeQueue.push(async () => {
            // It's necessary to do that, don't know why but don't remove it.
            return
        })

        // Wait until complete sequence
        // Ends the transcribing, and destroys resources.
        // Waits for the workers to finish, and destroys the transcbriber.
        await this.transcribeQueue.drain()
        console.log('[WordsPoster] Queue drained')

        this.stopped = true
        return new Promise((resolve) => resolve())
    }
    private async transcribe(
        timeStart: number,
        timeEnd: number,
    ): Promise<void> {
        console.log(
            `[WordsPoster] Starting transcribe for ${timeStart}-${timeEnd}`,
        )
        let api = Api.instance
        console.log(
            `[WordsPoster] Begin transcription process ${timeStart}-${timeEnd}`,
        )
        const s3Path = `${this.user_id}/${this.bot_uuid}/${timeStart}-${timeEnd}-record.wav`

        try {
            // Extraction audio
            const audioUrl = await TRANSCODER.extractAudio(
                timeStart,
                timeEnd,
                this.s3_bucket,
                s3Path,
            )

            // Transcription
            let words: RecognizerWord[]
            switch (this.speech_to_text_provider) {
                case 'Runpod':
                    const res_runpod = await recognizeRunPod(
                        audioUrl,
                        this.vocabulary,
                        this.speech_to_text_api_key,
                    )
                    words = parseRunPod(res_runpod, timeStart / 1000)
                    break
                case 'Default':
                case 'Gladia':
                    const res_gladia = await recognizeGladia(
                        audioUrl,
                        this.vocabulary,
                        this.speech_to_text_api_key,
                    )
                    words = parseGladia(res_gladia, timeStart / 1000)
                    break
                default:
                    throw new Error(
                        `Unknown provider: ${this.speech_to_text_provider}`,
                    )
            }

            // Post to DB
            const bot = await api.getBot()
            console.log(
                `[WordsPoster] Got transcription with ${words.length} words for ${timeStart}-${timeEnd}`,
            )
            console.log(
                `[WordsPoster] About to post words to DB for ${timeStart}-${timeEnd}`,
            )
            await api.postWords(words, bot.bot.id)
            console.log(
                `[WordsPoster] Successfully posted words to DB for ${timeStart}-${timeEnd}`,
            )
        } catch (error) {
            console.error(
                `[WordsPoster] Error in transcription process ${timeStart}-${timeEnd}:`,
                error,
            )
            throw error // Propagate l'erreur pour que la queue la voie
        } finally {
            try {
                await delete_s3_file(s3Path, this.s3_bucket)
                console.log(
                    `[WordsPoster] Cleaned up S3 file for ${timeStart}-${timeEnd}`,
                )
            } catch (error) {
                console.error(
                    `[WordsPoster] Failed to cleanup S3 for ${timeStart}-${timeEnd}:`,
                    error,
                )
            }
        }
    }
}
