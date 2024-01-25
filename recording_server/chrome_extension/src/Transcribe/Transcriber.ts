import { api, GladiaResult, googleToGladia } from 'spoke_api_js'
import * as R from 'ramda'
import { SPEAKERS, parameters } from '../background'
import { newTranscribeQueue } from '../queue'
import * as asyncLib from 'async'
import { SESSION, CONTEXT } from '../record'
import { summarizeWorker } from './summarizeWorker'
import RecordRTC, { StereoAudioRecorder } from 'recordrtc'
import { parseGladia } from './parseTranscript'
import { addSpeakerNames } from './addSpeakerNames'
import { uploadEditorsTask } from '../uploadEditors'

// milisseconds transcription chunk duration
const TRANSCRIPTION_CHUNK_DURATION = 60_000 * 3

const MAX_NO_TRANSCRIPT_DURATION = 60_000 * 8

/**
 * Transcribes an audio stream using the recognizer of the underlying Node server.
 */
export class Transcriber {
    static TRANSCRIBER: Transcriber | undefined
    public stopped = false
    private transcriber_session: TranscriberSession | undefined
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
        this.transcriber_session = new TranscriberSession(audioStream)

        this.transcriber_session.startRecorder()
        this.rebootTimer = setInterval(
            () => this.reboot(),
            // restart transcription every 9 minutes as microsoft token expriration
            TRANSCRIPTION_CHUNK_DURATION,
        )
    }

    /** Stops and restarts the recorder (to free some memory) and the recognizer (to update its tokens and language). */
    async reboot(): Promise<void> {
        // We reboot the recorder as well to (hopefully) reduce memory usage
        // We restart instantly to (hopefully) resume where we just left off
        let newTranscriber
        try {
            newTranscriber = new TranscriberSession(this.audioStream.clone())
            newTranscriber.startRecorder()
            console.log('[reboot]', 'newTranscriber = new TranscriberSession')
        } catch (e) {
            console.error('[reboot]', 'error stopping recorder', e)
        }
        const transcriberSession = this.transcriber_session
        this.transcribeQueue.push(async () => {
            try {
                console.log(
                    '[reboot]',
                    'before Transcriber.TRANSCRIBER.stopRecorder',
                )
                await transcriberSession?.stopRecorder()
                console.log(
                    '[reboot]',
                    'after Transcriber.TRANSCRIBER.stopRecorder',
                )
            } catch (e) {
                console.error('[reboot]', 'error stopping recorder', e)
            }
        })
        // Reboot the recognizer (audio data is buffered in the meantime)
        this.transcriber_session = newTranscriber
    }

    /**  Ends the transcribing, and destroys resources. */
    async stop(): Promise<void> {
        clearInterval(this.rebootTimer)
        try {
            await this.transcriber_session?.stopRecorder()
        } catch (e) {
            console.error('[stop]', 'error stopping recorder', e)
        }

        this.transcribeQueue.push(async () => {
            return
        })

        await this.transcribeQueue.drain()

        // Retreive last results that weren't polled
    }

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

export class TranscriberSession {
    private recorder: RecordRTC | undefined
    private offset: number
    private audioStream: MediaStream
    private sampleRate: number

    constructor(audioStream: MediaStream) {
        this.audioStream = audioStream
        this.sampleRate =
            audioStream.getAudioTracks()[0].getSettings().sampleRate ?? 0
        this.offset = 0
    }
    /** Starts the recorder. */
    startRecorder(): void {
        // NOTE:
        // We buffer audio data when not transcribing (i.e. when rebooting)
        // and flush that back to the next recognizer session
        // We also use a queue to make sure writes to the recognizer are sequential
        // (recorder.ondataavailable does not await...)

        this.recorder = new RecordRTC(this.audioStream, {
            type: 'audio',
            mimeType: 'audio/webm;codecs=pcm', // endpoint requires 16bit PCM audio
            recorderType: StereoAudioRecorder,
            timeSlice: 250, // set 250 ms intervals of data that sends to AAI
            desiredSampRate: this.sampleRate,
            numberOfAudioChannels: 1, // real-time requires only one channel
            bufferSize: 4096,
            audioBitsPerSecond: this.sampleRate * 16,
            ondataavailable: (data: any) => {
                //console.log('[ondataavailable]', data)
            },
        })

        this.recorder?.startRecording()
        this.offset = CONTEXT.currentTime
    }

    /** Stops the recorder. */
    async stopRecorder(): Promise<void> {
        // Make sure (?) we get all data from the recorder
        await new Promise((resolve: any) => {
            this.recorder?.stopRecording(async () => {
                const blob = this.recorder?.getBlob()
                const array = await blob?.arrayBuffer()
                console.log('[stopRecorder]', 'array', array)
                console.log('blob', blob)
                if (blob != null) {
                    console.log('blob ready requesting gladia')
                    let res
                    try {
                        res = await api.transcribeWithGladia(
                            blob,
                            parameters.vocabulary,
                            parameters.force_lang === true
                                ? googleToGladia(parameters.language)
                                : undefined,
                        )
                    } catch (e) {
                        console.error('an error occured calling gladia, ', e)
                        resolve()
                    }
                    try {
                        await onResult(res, this.offset)
                    } catch (e) {
                        console.error(
                            'an error occured parsing gladia result ',
                            e,
                        )
                    }
                }
                resolve()
            })
        })
    }
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
    for (let t of transcriptsWithSpeaker) {
        await uploadEditorsTask(t)
    }
}
