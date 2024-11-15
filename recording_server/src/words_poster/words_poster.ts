import * as asyncLib from 'async'

import { Api } from '../api/methods'
import { START_RECORDING_TIMESTAMP } from '../meeting'
import { parseGladia, recognizeGladia } from './providers/gladia'
import { parseRunPod, recognizeRunPod } from './providers/runpod'

import { sleep, Console, delete_s3_file } from '../utils'
import { MeetingParams } from '../types'
import { TRANSCODER } from '../transcoder'

// Output word of the `Recognizer`.
export type RecognizerWord = {
    type: string
    value: string // Word
    ts: number // Start timestamp (in seconds)
    end_ts: number // End timestamp (in seconds)
    confidence: number // Confidence ([0.0, 1.0])
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

// milisseconds transcription chunk duration
const TRANSCRIPTION_CHUNK_DURATION = 60 * 1000 * 3 // // 3 minutes

// Transcribes an audio stream using the recognizer of the underlying Node server.
// TODO : 'underlying Node server' ??? I think this comment is bullshit
export class WordsPoster extends Console {
    static TRANSCRIBER: WordsPoster | undefined

    private bot_uuid: string
    private speech_to_text_provider: string | null
    private speech_to_text_api_key: string | null
    private s3_bucket: string
    private user_id: number
    private vocabulary: string[]

    private stopped = false
    private rebootTimer: NodeJS.Timer
    private transcribeQueue: asyncLib.QueueObject<() => void>
    private wordPosterWorker: Promise<void>
    private transcriptionOffset: number = 0 // is seconds

    // Returns a new `WordsPoster`.
    private constructor(params: MeetingParams) {
        super()
        this.bot_uuid = params.bot_uuid
        this.speech_to_text_provider = params.speech_to_text_provider
        this.speech_to_text_api_key = params.speech_to_text_api_key
        this.s3_bucket = process.env.AWS_S3_BUCKET
        this.user_id = params.user_id
        this.vocabulary = params.vocabulary

        this.rebootTimer = setInterval(() => {}, 60 * 1000)
        this.transcribeQueue = newTranscribeQueue()
        // Simply not to have undefined properties
        this.wordPosterWorker = new Promise((resolve) => resolve())
    }

    // Initialize and start the transcriber.
    public static async init(params: MeetingParams): Promise<void> {
        try {
            WordsPoster.TRANSCRIBER = new WordsPoster(params)
        } catch (e) {
            console.error('error creating transcriber', e)
            throw e
        }
        await WordsPoster.TRANSCRIBER.start()
    }

    // Request the latest transcription and stop the transcriber for good.
    public async stop(): Promise<void> {
        this.log('stop called')
        this.rebootTimer = setInterval(() => {})
        this.transcribeQueue.push(async () => {
            await WordsPoster.TRANSCRIBER?.transcribe(true)
        })
    }

    // Ends the transcribing, and destroys resources.
    // Waits for the workers to finish, and destroys the transcbriber.
    public async waitUntilComplete(): Promise<void> {
        this.log('before transcribe queue drain')
        this.transcribeQueue.push(async () => {
            return
        })
        await this.transcribeQueue.drain()
        this.log('after transcribe queue drain')

        this.stopped = true

        await this.wordPosterWorker
    }

    // Check if the transcriber is still active.
    public is_running(): boolean {
        return !this.stopped
    }

    private async start(): Promise<void> {
        try {
            if (this.speech_to_text_provider != null) {
                this.rebootTimer = setInterval(() => {
                    this.transcribeQueue.push(async () => {
                        await WordsPoster.TRANSCRIBER?.transcribe(false) // ? => ID undefined, it is okay
                    })
                }, TRANSCRIPTION_CHUNK_DURATION)
            }
        } catch (e) {
            this.error('error initializing reboot timer', e)
            throw e
        }
    }

    private async transcribe(final: boolean): Promise<void> {
        let api = Api.instance
        let currentOffset = this.transcriptionOffset
        let newOffset = (Date.now() - START_RECORDING_TIMESTAMP.get()) / 1000
        const timeStart = currentOffset
        const timeEnd = final ? -1 : newOffset
        const s3Path = `${this.user_id}/${this.bot_uuid}/${timeStart}-${timeEnd}-record.wav`
        this.transcriptionOffset = newOffset
        await sleep(15000)
        this.log(
            'ready to do transcription between: ',
            currentOffset,
            newOffset,
        )
        try {
            const audioUrl = await TRANSCODER.extractAudio(
                timeStart,
                timeEnd,
                this.s3_bucket,
                s3Path,
            )
            this.log(audioUrl)

            let words: RecognizerWord[]
            switch (this.speech_to_text_provider) {
                case 'Runpod':

                    let res_runpod = await recognizeRunPod(
                        audioUrl,
                        this.vocabulary, // TODO : What to do.
                        this.speech_to_text_api_key,
                    )
                    words = parseRunPod(res_runpod, currentOffset)
                    break
                case 'Default':
                case 'Gladia':
                    let res_gladia = await recognizeGladia(
                        audioUrl,
                        this.vocabulary, // TODO : What to do.
                        this.speech_to_text_api_key,
                    )
                    words = parseGladia(res_gladia, currentOffset)
                    break
                default:
                    this.error(
                        'Unknown Transcription Provider !',
                        this.speech_to_text_provider,
                    )
                    words = new Array()
            }
            this.log('[onResult] ')
            const bot = await api.getBot().catch((e) => {
                this.error('Failed to get bot :', e)
                throw e
            })
            await api.postWords(words, bot.bot.id).catch((e) => {
                this.error('Failed to post words :', e)
                throw e
            })
        } catch (e) {
            this.error('an error occured calling transcriber, ', e)
        } finally {
            try {
                await delete_s3_file(s3Path, this.s3_bucket)
            } catch (e) {
                this.error('an error occured deleting audio from S3, ', e)
            }
            //TODO : Delete audio from S3
        }
    }
}
