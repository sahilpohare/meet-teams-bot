import * as asyncLib from 'async'
import * as R from 'ramda'
import { api, GladiaResult, googleToGladia, Utterances } from 'spoke_api_js'
import { parameters } from '../background'
import { newTranscribeQueue } from '../queue'
import { SESSION, START_RECORD_TIMESTAMP } from '../record'
import { parseGladia } from './parseTranscript'
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
    private audioStream: MediaStream
    private summarizeWorker: Promise<void>
    private pollTimer: NodeJS.Timer | undefined
    public transcribeQueue: asyncLib.QueueObject<() => void>
    private wordPosterWorker: Promise<void>
    // in seconds
    private transcriptionOffset: number = 0
    /** Inits the transcriber. */

    /** Returns a new `Transcriber`. */
    private constructor(audioStream: MediaStream) {
        this.audioStream = audioStream

        this.rebootTimer = setInterval(() => {}, 60000)
        this.transcribeQueue = newTranscribeQueue()
        // Simply not to have undefined properties
        this.summarizeWorker = new Promise((resolve) => resolve())
        this.wordPosterWorker = new Promise((resolve) => resolve())
    }
    static async init(audioStream: MediaStream): Promise<void> {
        Transcriber.TRANSCRIBER = new Transcriber(audioStream)
        await Transcriber.TRANSCRIBER.start(audioStream)
    }
    async start(audioStream: MediaStream): Promise<void> {
        this.launchWorkers()
        this.rebootTimer = setInterval(() => {
            this.transcribeQueue.push(async () => {
                await Transcriber.TRANSCRIBER?.transcribe()
            })
        }, TRANSCRIPTION_CHUNK_DURATION)
    }

    async transcribe(): Promise<void> {
        let currentOffset = this.transcriptionOffset
        let newOffset = Date.now() - START_RECORD_TIMESTAMP / 1000
        this.transcriptionOffset = newOffset
        console.log(
            'ready to do transcription between: ',
            currentOffset,
            newOffset,
        )
        try {
            let path = (
                await api.extractAudio(SESSION!.id, currentOffset, newOffset)
            ).audio_s3_path
            //TODO: delete audio
            let audio_url = `https://${parameters.s3_bucket}.s3.eu-west-3.amazonaws.com/${path}`
            console.log('audio url', audio_url)
            let res = await api.transcribeWithGladia(
                audio_url,
                parameters.vocabulary,
                parameters.force_lang === true
                    ? googleToGladia(parameters.language)
                    : undefined,
            )
            await onResult(res, currentOffset)
        } catch (e) {
            console.error('an error occured calling gladia, ', e)
        }
    }

    async stop(): Promise<void> {
        this.rebootTimer = setInterval(() => {})
        this.transcribeQueue.push(async () => {
            await Transcriber.TRANSCRIBER?.transcribe()
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
            try {
                await api.endMeetingTrampoline(
                    SESSION?.project.id,
                    parameters.bot_id,
                )
            } catch (e) {
                console.error('error in endMeetingTranpoline', e)
            }
            console.log('after call end meeting trampoline')
        } else {
            console.error('SESSION?.project.id is undefined')
        }
    }

    /** Launches the workers. */
    private async launchWorkers(): Promise<void> {
        this.wordPosterWorker = wordPosterWorker()

        if (parameters.bot_id == null) {
            this.summarizeWorker = summarizeWorker()
        }
    }
    /** Gets and handles recognizer results every `interval` ms. */
}

let NO_TRANSCRIPT_DURATION = 0
let MAX_NO_TRANSCRIPT_DURATION = 60_000 * 3

/** Gets and handles recognizer results. */
async function onResult(json: GladiaResult, offset: number) {
    console.log('[onResult] ')
    //TODO REPORT
    let utterances: Utterances[] = json.transcription.utterances
    if (R.all((x) => x.words.length === 0, utterances)) {
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
    let transcripts = parseGladia(json, offset)
    console.log('transcripts after parsing gladia', transcripts)
    for (let t of transcripts) {
        for (let w of t.words) {
            SESSION?.words.push(w)
        }
    }
    //let transcriptsWithSpeaker = addSpeakerNames(transcripts, SPEAKERS)
    //console.log('transcripts with speakers', transcriptsWithSpeaker)
    //let prevAudioOffset = 0
    // for (let t of transcriptsWithSpeaker) {
    //     if (t.startTime === prevAudioOffset) {
    //         console.error('transcript with same offset as previous one')
    //     }
    //     prevAudioOffset = t.startTime
    //     await uploadEditorsTask(R.clone(t))
    // }
}
