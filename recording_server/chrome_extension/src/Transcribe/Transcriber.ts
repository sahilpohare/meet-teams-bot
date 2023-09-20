import { api, GladiaResult, gladiaToGoogleLang } from 'spoke_api_js'
import * as R from 'ramda'
import { parameters } from '../background'
import { newSerialQueue, newTranscribeQueue } from '../queue'
import * as asyncLib from 'async'
import { START_RECORD_OFFSET, SESSION, CONTEXT } from '../record'
import { wordPosterWorker } from './wordPosterWorker'
import { trySummarizeNext, summarizeWorker } from './summarizeWorker'
import { calcHighlights, highlightWorker } from './highlightWorker'
import RecordRTC, { StereoAudioRecorder } from 'recordrtc'

const tryOrLog = async <T>(message: string, fn: () => Promise<T>) => {
    try {
        await fn()
    } catch (e) {
        console.error(message, e)
    }
}

/**
 * Transcribes an audio stream using the recognizer of the underlying Node server.
 */
export class Transcriber {
    static STOPPED = false
    private static TRANSCRIBER: Transcriber | undefined
    private static TRANSCRIBER_SESSION: TranscriberSession | undefined
    private static rebootTimer: NodeJS.Timer
    private audioStream: MediaStream
    private wordPosterWorker: Promise<void>
    private summarizeWorker: Promise<void>
    private highlightWorker: Promise<void>
    private pollTimer: NodeJS.Timer | undefined
    private transcribeQueue: Promise<void>[]
    /** Inits the transcriber. */
    static async init(audioStream: MediaStream): Promise<void> {
        if (Transcriber.TRANSCRIBER != null) throw 'Transcriber already inited'

        Transcriber.TRANSCRIBER = new Transcriber(audioStream)
        Transcriber.TRANSCRIBER.launchWorkers()
        Transcriber.TRANSCRIBER_SESSION = new TranscriberSession(
            audioStream,
            this.onResult,
        )

        Transcriber.TRANSCRIBER_SESSION.startRecorder()
        Transcriber.rebootTimer = setInterval(
            () => Transcriber.reboot(),
            // restart transcription every 9 minutes as microsoft token expriration
            60_000 * 3,
        )
    }

    /** Stops and restarts the recorder (to free some memory) and the recognizer (to update its tokens and language). */
    static async reboot(): Promise<void> {
        if (Transcriber.TRANSCRIBER == null) throw 'Transcriber not inited'

        // We reboot the recorder as well to (hopefully) reduce memory usage
        // We restart instantly to (hopefully) resume where we just left off
        let newTranscriber
        try {
            newTranscriber = new TranscriberSession(
                Transcriber.TRANSCRIBER.audioStream.clone(),
                Transcriber.onResult,
            )
            newTranscriber.startRecorder()
            console.log('[reboot]', 'newTranscriber = new TranscriberSession')
        } catch (e) {
            console.error('[reboot]', 'error stopping recorder', e)
        }
        const transcriberSession = Transcriber.TRANSCRIBER_SESSION
        Transcriber.TRANSCRIBER.transcribeQueue.push(
            (async () => {
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
            })(),
        )
        // Reboot the recognizer (audio data is buffered in the meantime)
        this.TRANSCRIBER_SESSION = newTranscriber
    }

    /**  Ends the transcribing, and destroys resources. */
    static async stop(): Promise<void> {
        if (Transcriber.TRANSCRIBER == null) throw 'Transcriber not inited'

        clearInterval(Transcriber.rebootTimer)
        tryOrLog(
            'Stop transcription',
            async () => await Transcriber.TRANSCRIBER_SESSION?.stopRecorder(),
        )

        console.log(
            '[stop]',
            'before Transcriber.TRANSCRIBER.transcribeQueue drain',
        )
        await Promise.all(Transcriber.TRANSCRIBER.transcribeQueue)
        console.log(
            '[stop]',
            'after Transcriber.TRANSCRIBER.transcribeQueue drain',
        )

        // Retreive last results that weren't polled
    }

    /** Waits for the workers to finish, and destroys the transcbriber. */
    static async waitUntilComplete(): Promise<void> {
        if (Transcriber.TRANSCRIBER == null) throw 'Transcriber not inited'

        Transcriber.STOPPED = true

        await Transcriber.TRANSCRIBER.wordPosterWorker

        if (
            SESSION?.project.id &&
            R.all((v) => v.words.length === 0, SESSION.video_informations)
        ) {
            tryOrLog(
                'Patching project',
                async () =>
                    await api.patchProject({
                        id: SESSION?.project.id,
                        no_transcript: true,
                    }),
            )
        }

        tryOrLog('Set transcription as complete', async () => {
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
        })

        await Transcriber.TRANSCRIBER.summarizeWorker
        await Transcriber.TRANSCRIBER.highlightWorker

        while (await trySummarizeNext(true)) {}

        tryOrLog('Calculate highlights', async () => await calcHighlights(true))

        if (SESSION) {
            tryOrLog(
                'Patch asset',
                async () =>
                    await api.patchAsset({
                        id: SESSION?.asset.id,
                        uploading: false,
                    }),
            )
            tryOrLog(
                'Send worker message (new spoke)',
                async () =>
                    await api.workerSendMessage({
                        NewSpoke: {
                            project_id: SESSION?.project.id,
                            user: { id: parameters.user_id },
                        },
                    }),
            )
        }

        // Release memory (?)
        Transcriber.TRANSCRIBER = undefined
    }

    /** Returns a new `Transcriber`. */
    private constructor(audioStream: MediaStream) {
        this.audioStream = audioStream

        this.transcribeQueue = []
        // Simply not to have undefined properties
        this.wordPosterWorker = new Promise((resolve) => resolve())
        this.summarizeWorker = new Promise((resolve) => resolve())
        this.highlightWorker = new Promise((resolve) => resolve())
    }

    /** Launches the workers. */
    private async launchWorkers(): Promise<void> {
        this.wordPosterWorker = wordPosterWorker()
        this.summarizeWorker = summarizeWorker()
        this.highlightWorker = highlightWorker()
    }
    /** Gets and handles recognizer results every `interval` ms. */

    /** Gets and handles recognizer results. */
    private static onResult(json: GladiaResult, offset: number): void {
        for (const prediction of json.prediction) {
            const language = prediction.language
            const words = prediction.words

            if (language) {
                Transcriber.handleLanguage(language)
            }

            if (words) {
                Transcriber.handleResult(words, offset)
            }
        }
    }

    /** Handles detected language. */
    private static handleLanguage(language: string): void {
        if (language === '' || parameters.language === language) return
        const googleLang = gladiaToGoogleLang(language) ?? 'en-US'

        parameters.language = googleLang
        //await api.notifyApp(parameters.user_token, {
        //    message: 'LangDetected',
        //    user_id: parameters.user_id,
        //    payload: { language },
        //})
    }

    /** Handles detected language. */
    private static handleResult(
        words: {
            time_begin: number
            time_end: number
            word: string
        }[],
        offset: number,
    ): void {
        if (!(SESSION && offset !== 0 && START_RECORD_OFFSET !== 0)) return

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
            console.log('[handleResult]', word)
            if (word.word !== '') {
                SESSION.words.push({
                    type: 'text',
                    value: word.word,
                    ts,
                    end_ts,
                    confidence: 1.0,
                })
            }
        }
        console.log('[handleResult]', new Date(), words.length)
    }
}

export class TranscriberSession {
    private recorder: RecordRTC | undefined
    private offset: number
    private audioStream: MediaStream
    private sampleRate: number
    private onResult: any

    constructor(audioStream: MediaStream, onResult: any) {
        this.audioStream = audioStream
        this.sampleRate =
            audioStream.getAudioTracks()[0].getSettings().sampleRate ?? 0
        this.offset = 0
        this.onResult = onResult
    }
    /** Starts the recorder. */
    startRecorder(): void {
        // NOTE:
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
                        )
                        console.log('[stopRecorder]', res)
                        console.log('[stopRecorder]', this.onResult)
                        this.onResult(res, this.offset)
                    } catch (e) {
                        console.error('an error occured calling gladia, ', e)
                    }
                }
                resolve()
            })
        })
    }
}
