import * as asyncLib from 'async'
import * as R from 'ramda'
import { api, GladiaResult, googleToGladia } from 'spoke_api_js'
import { parameters, SPEAKERS } from '../background'
import { newTranscribeQueue } from '../queue'
import { SESSION } from '../record'
import { uploadEditorsTask } from '../uploadEditors'
import { addSpeakerNames } from './addSpeakerNames'
import { parseGladia } from './parseTranscript'
import { summarizeWorker } from './summarizeWorker'

// milisseconds transcription chunk duration
const TRANSCRIPTION_CHUNK_DURATION = 60_000 * 3

const MAX_NO_TRANSCRIPT_DURATION = 60_000 * 8

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
    private transcribeQueue: asyncLib.QueueObject<() => void>
    /** Inits the transcriber. */
    static async init(audioStream: MediaStream): Promise<void> {
        Transcriber.TRANSCRIBER = new Transcriber(audioStream)
        await Transcriber.TRANSCRIBER.start(audioStream)
    }
    async start(audioStream: MediaStream): Promise<void> {
        this.launchWorkers()
    }

    /** Stops and restarts the recorder (to free some memory) and the recognizer (to update its tokens and language). */
    async transcribe(): Promise<void> {
        try {
            let path = (await api.extractAudio(SESSION!.id)).audio_s3_path
            let res = await api.transcribeWithGladia(
                path,
                parameters.vocabulary,
                parameters.force_lang === true
                    ? googleToGladia(parameters.language)
                    : undefined,
            )
            await onResult(res, 0)
        } catch (e) {
            console.error('an error occured calling gladia, ', e)
        }
    }

    /**  Ends the transcribing, and destroys resources. */
    /** Waits for the workers to finish, and destroys the transcbriber. */
    async waitUntilComplete(): Promise<void> {
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

        await this.summarizeWorker
        if (SESSION?.project.id) {
            api.endMeeting(SESSION?.project.id)
        }
    }

    /** Returns a new `Transcriber`. */
    private constructor(audioStream: MediaStream) {
        this.audioStream = audioStream
        this.rebootTimer = setTimeout(() => {}, 0)

        this.transcribeQueue = newTranscribeQueue()
        // Simply not to have undefined properties
        this.summarizeWorker = new Promise((resolve) => resolve())
    }

    /** Launches the workers. */
    private async launchWorkers(): Promise<void> {
        this.summarizeWorker = summarizeWorker()
    }
    /** Gets and handles recognizer results every `interval` ms. */
}

let NO_TRANSCRIPT_DURATION = 0

/** Gets and handles recognizer results. */
async function onResult(json: GladiaResult, offset: number) {
    console.log('[onResult] ')
    if (R.all((v) => v.words.length === 0, json.prediction)) {
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
    let transcriptsWithSpeaker = addSpeakerNames(transcripts, SPEAKERS)
    console.log('transcripts with speakers', transcriptsWithSpeaker)
    let prevAudioOffset = 0
    for (let t of transcriptsWithSpeaker) {
        if (t.startTime === prevAudioOffset) {
            console.error('transcript with same offset as previous one')
        }
        prevAudioOffset = t.startTime
        await uploadEditorsTask(R.clone(t))
    }
}
