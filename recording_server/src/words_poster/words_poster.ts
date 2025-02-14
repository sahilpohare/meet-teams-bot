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
        try {
            WordsPoster.TRANSCRIBER = new WordsPoster(params)
        } catch (e) {
            console.error('error creating transcriber', e)
            throw e
        }
    }

    // Request e new Transcribe
    public async push(timeStart: number, timeEnd: number): Promise<void> {
        this.transcribeQueue.push(async () => {
            await WordsPoster.TRANSCRIBER?.transcribe(timeStart, timeEnd)
        })
    }

    // Request the latest transcription and stop the transcriber for good.
    public async stop(): Promise<void> {
        console.log('stop called')
        if (this.stopped) {
            console.error('WordPoster already stoped!')
        }
        // Wait until complete sequence
        // Ends the transcribing, and destroys resources.
        // Waits for the workers to finish, and destroys the transcbriber.
        console.log('before transcribe queue drain')
        this.transcribeQueue.push(async () => {
            // It's necessary to do that, don't know why but don't remove it.
            return
        })
        await this.transcribeQueue.drain()
        console.log('after transcribe queue drain')

        this.stopped = true
        return new Promise((resolve) => resolve())
    }

    private async transcribe(
        timeStart: number,
        timeEnd: number,
    ): Promise<void> {
        let api = Api.instance
        const s3Path = `${this.user_id}/${this.bot_uuid}/${timeStart}-${timeEnd}-record.wav`
        console.log('ready to do transcription between: ', timeStart, timeEnd)
        try {
            const audioUrl = await TRANSCODER.extractAudio(
                timeStart,
                timeEnd,
                this.s3_bucket,
                s3Path,
            )
            console.log(audioUrl)

            let words: RecognizerWord[]
            switch (this.speech_to_text_provider) {
                case 'Gladia':
                    let res_gladia = await recognizeGladia(
                        audioUrl,
                        this.vocabulary, // TODO : What to do.
                        this.speech_to_text_api_key,
                    )
                    words = parseGladia(res_gladia, timeStart)
                    break
                case 'Default':
                case 'Runpod':
                    let res_runpod = await recognizeRunPod(
                        audioUrl,
                        this.vocabulary, // TODO : What to do.
                        this.speech_to_text_api_key,
                    )
                    words = parseRunPod(res_runpod, timeStart)
                    break

                default:
                    console.error(
                        'Unknown Transcription Provider !',
                        this.speech_to_text_provider,
                    )
                    words = new Array()
            }
            console.log('[onResult] ')
            const bot = await api.getBot().catch((e) => {
                console.error('Failed to get bot :', e)
                throw e
            })
            await api.postWords(words, bot.bot.id).catch((e) => {
                console.error('Failed to post words :', e)
                throw e
            })
        } catch (e) {
            console.error('an error occured calling transcriber, ', e)
        } finally {
            try {
                await delete_s3_file(s3Path, this.s3_bucket)
            } catch (e) {
                console.error('an error occured deleting audio from S3, ', e)
            }
        }
    }
}
