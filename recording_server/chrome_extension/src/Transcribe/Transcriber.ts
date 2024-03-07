import * as asyncLib from 'async'
import * as R from 'ramda'
import RecordRTC, { StereoAudioRecorder } from 'recordrtc'
import {
    GladiaResult,
    api,
    gladiaToGoogleLang,
    googleToGladia,
} from 'spoke_api_js'
import { parameters } from '../background'
import { newTranscribeQueue } from '../queue'
import { CONTEXT, SESSION, START_RECORD_OFFSET } from '../record'
import { summarizeWorker } from './summarizeWorker'
import { wordPosterWorker } from './wordPosterWorker'

/**
 * Transcribes an audio stream using the recognizer of the underlying Node server.
 */

export class Transcriber {
    static TRANSCRIBER: Transcriber | undefined
    public stopped = false
    private transcriber_session: TranscriberSession | undefined
    private rebootTimer: NodeJS.Timer
    private audioStream: MediaStream
    private wordPosterWorker: Promise<void>
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
            60_000 * 3,
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
        await this.wordPosterWorker

        if (
            SESSION?.project.id &&
            R.all((v) => v.words.length === 0, SESSION.video_informations)
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

        try {
            if (!SESSION) return

            for (const infos of SESSION.video_informations) {
                const video = infos.complete_editor?.video

                if (video != null && video.transcription_completed === false) {
                    await api.patchVideo({
                        id: video.id,
                        transcription_completed: true,
                    })
                    video.transcription_completed = true
                }
            }
        } catch (e) {
            console.error('[waitUntilComplete]', 'error patching video')
        }
        try {
            await this.summarizeWorker
        } catch (e) {
            console.error('error in summarize worker')
        }
        if (SESSION?.project.id) {
            console.log('call end meeting trampoline')
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

    /** Returns a new `Transcriber`. */
    private constructor(audioStream: MediaStream) {
        this.audioStream = audioStream
        this.rebootTimer = setTimeout(() => {}, 0)

        this.transcribeQueue = newTranscribeQueue()
        // Simply not to have undefined properties
        this.wordPosterWorker = new Promise((resolve) => resolve())
        this.summarizeWorker = new Promise((resolve) => resolve())
    }

    /** Launches the workers. */
    private async launchWorkers(): Promise<void> {
        this.wordPosterWorker = wordPosterWorker()
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
                    try {
                        let res = await api.transcribeWithGladia(
                            blob,
                            parameters.vocabulary,
                            parameters.force_lang === true
                                ? googleToGladia(parameters.language)
                                : undefined,
                            parameters.translation_lang != null
                                ? googleToGladia(parameters.translation_lang)
                                : undefined,
                        )
                        console.log('[stopRecorder]', res.prediction.length)
                        console.log('[stopRecorder]', onResult)
                        onResult(res, this.offset)
                    } catch (e) {
                        console.error('an error occured calling gladia, ', e)
                    }
                }
                resolve()
            })
        })
    }
}

/** Gets and handles recognizer results. */
function onResult(json: GladiaResult, offset: number): void {
    console.log('[onResult] ')
    for (const prediction of json.prediction) {
        const language = prediction.language
        const words = prediction.words

        if (language) {
            handleLanguage(language)
        }

        if (words != null && words.length > 0) {
            handleResult(words, offset)
        } else {
            console.log('[onResult] ', 'no words')
        }
    }
}

/** Handles detected language. */
function handleLanguage(language: string): void {
    if (language === '' || parameters.detected_lang === language) return
    parameters.detected_lang = gladiaToGoogleLang(language) ?? 'en-US'
}

/** Handles detected language. */
function handleResult(
    words: {
        time_begin: number
        time_end: number
        word: string
    }[],
    offset: number,
): void {
    console.log('[handleResult] offset from start of video: ', words)
    console.log(
        '[handleResult] offset from start of video: ',
        (offset - START_RECORD_OFFSET) / 1_000,
    )
    for (let [i, word] of words.entries()) {
        let ts = word.time_begin
        let end_ts = word.time_end
        ts += offset - START_RECORD_OFFSET
        end_ts += offset - START_RECORD_OFFSET
        //console.log('[handleResult]', word)
        if (word.word !== '') {
            if (SESSION != null) {
                SESSION.words.push({
                    type: 'text',
                    value: word.word,
                    ts,
                    end_ts,
                    confidence: 1.0,
                })
            } else {
                console.error('[handleResult]', 'SESSION is null')
            }
        }
    }
    console.log('[handleResult]', new Date(), words.length)
}
