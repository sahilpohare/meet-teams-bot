import * as asyncLib from 'async'
import * as R from 'ramda'
import { parameters } from '../background'
import { newTranscribeQueue } from '../queue'
import { SESSION, START_RECORD_TIMESTAMP } from '../record'
import { api } from '../spoke_api_js'
import { sleep } from '../utils'
import { RecognizerTranscript, parseRunPod } from './parseTranscript'
import { speakerWorker } from './speakerWorker'
import { summarizeWorker } from './summarizeWorker'
import { wordPosterWorker } from './wordPosterWorker'

// milisseconds transcription chunk duration
const TRANSCRIPTION_CHUNK_DURATION = 60_000 * 3

/**
 * Transcribes an audio stream using the recognizer of the underlying Node server.
 */
export class Transcriber {
    static TRANSCRIBER: Transcriber | undefined
    public stopped = false
    private rebootTimer: NodeJS.Timer
    private summarizeWorker: Promise<void>
    private speakerWorker: Promise<void>
    public transcribeQueue: asyncLib.QueueObject<() => void>
    private wordPosterWorker: Promise<void>
    // in seconds
    private transcriptionOffset: number = 0
    /** Inits the transcriber. */

    /** Returns a new `Transcriber`. */
    private constructor() {
        this.rebootTimer = setInterval(() => {}, 60000)
        this.transcribeQueue = newTranscribeQueue()
        // Simply not to have undefined properties
        this.summarizeWorker = new Promise((resolve) => resolve())
        this.speakerWorker = new Promise((resolve) => resolve())
        this.wordPosterWorker = new Promise((resolve) => resolve())
    }
    static async init(): Promise<void> {
        try {
            Transcriber.TRANSCRIBER = new Transcriber()
        } catch (e) {
            console.error('error creating transcriber', e)
            throw e
        }
        await Transcriber.TRANSCRIBER.start()
    }
    async start(): Promise<void> {
        try {
            this.launchWorkers()
        } catch (e) {
            console.error('error launching workers', e)
            throw e
        }
        try {
            if (
                parameters.bot_id == null ||
                parameters.speech_to_text != null
            ) {
                this.rebootTimer = setInterval(() => {
                    this.transcribeQueue.push(async () => {
                        await Transcriber.TRANSCRIBER?.transcribe(false)
                    })
                }, TRANSCRIPTION_CHUNK_DURATION)
            }
        } catch (e) {
            console.error('error initializing reboot timer', e)
            throw e
        }
    }

    async transcribe(final: boolean): Promise<void> {
        let currentOffset = this.transcriptionOffset
        let newOffset = (Date.now() - START_RECORD_TIMESTAMP) / 1000
        this.transcriptionOffset = newOffset
        await sleep(15000)
        console.log(
            'ready to do transcription between: ',
            currentOffset,
            newOffset,
        )
        let audioExtract: any = null
        try {
            audioExtract = await api.extractAudio(
                SESSION!.id,
                currentOffset,
                final ? -1 : newOffset,
            )
            let path = audioExtract.audio_s3_path
            let audio_url = `https://${parameters.s3_bucket}.s3.eu-west-3.amazonaws.com/${path}`
            let res = await api.recognizeRunPod(
                audio_url,
                parameters.vocabulary,
            )
            let transcripts = parseRunPod(res, currentOffset)
            await onResult(transcripts, currentOffset)
        } catch (e) {
            console.error('an error occured calling gladia, ', e)
        } finally {
            try {
                if (audioExtract != null) {
                    console.log({ audioExtract })
                    await api.deleteAudio(audioExtract)
                }
            } catch (e) {
                console.error('an error occured deleting audio, ', e)
            }
        }
    }

    async stop(): Promise<void> {
        this.rebootTimer = setInterval(() => {})
        this.transcribeQueue.push(async () => {
            await Transcriber.TRANSCRIBER?.transcribe(true)
        })
    }
    /**  Ends the transcribing, and destroys resources. */
    /** Waits for the workers to finish, and destroys the transcbriber. */
    async waitUntilComplete(): Promise<void> {
        console.log('before transcribe queue drain')
        this.transcribeQueue.push(async () => {
            return
        })
        await this.transcribeQueue.drain()
        console.log('after transcribe queue drain')

        this.stopped = true

        if (
            SESSION?.project.id &&
            R.all(
                (e) => e.video.transcripts[0]?.words.length === 0,
                SESSION.completeEditors,
            )
        ) {
            try {
                await api.patchProject({
                    id: SESSION?.project.id,
                    no_transcript: true,
                })
            } catch (e) {
                console.error('[waitUntilComplete]', 'error patching project')
            }
        }
        await this.speakerWorker
        await this.wordPosterWorker

        try {
            await this.summarizeWorker
        } catch (e) {
            console.error('error in summarizeWorker', e)
        }
        if (SESSION?.project.id) {
            console.log(
                'call end meeting trampoline',
                'project id',
                SESSION?.project.id,
                'bot_id',
                parameters.bot_id,
            )
            console.log('after call end meeting trampoline')
        } else {
            console.error('SESSION?.project.id is undefined')
        }
    }

    /** Launches the workers. */
    private async launchWorkers(): Promise<void> {
        this.wordPosterWorker = wordPosterWorker()
        this.speakerWorker = speakerWorker()

        if (parameters.bot_id == null) {
            this.summarizeWorker = summarizeWorker()
        }
    }
    /** Gets and handles recognizer results every `interval` ms. */
}

let NO_TRANSCRIPT_DURATION = 0
let MAX_NO_TRANSCRIPT_DURATION = 60_000 * 6

/** Gets and handles recognizer results. */
async function onResult(transcripts: RecognizerTranscript[], offset: number) {
    console.log('[onResult] ')
    //TODO REPORT
    if (R.all((x) => x.words.length === 0, transcripts)) {
        NO_TRANSCRIPT_DURATION += TRANSCRIPTION_CHUNK_DURATION

        if (NO_TRANSCRIPT_DURATION > MAX_NO_TRANSCRIPT_DURATION) {
            let params = {
                session_id: parameters.session_id,
                user_token: parameters.user_token,
            }
            console.error('no speaker since too long')
            api.stopBot(params)
        }
    }
    //console.log('transcripts after parsing gladia', transcripts)
    for (let t of transcripts) {
        for (let w of t.words) {
            SESSION?.words.push(w)
        }
    }
}
