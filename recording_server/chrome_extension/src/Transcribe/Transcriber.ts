import { api, RecognizerResult } from 'spoke_api_js'
import * as R from 'ramda'
import axios from 'axios'
import { parameters } from '../background'
import { newSerialQueue, drainQueue } from '../queue'
import * as asyncLib from 'async'
import { START_RECORD_OFFSET, SESSION } from '../record'
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

    /** Inits the transcriber. */
    static async init(audioStream: MediaStream): Promise<void> {
        if (Transcriber.TRANSCRIBER != null) throw 'Transcriber already inited'

        Transcriber.TRANSCRIBER = new Transcriber(audioStream)
        Transcriber.TRANSCRIBER.launchWorkers()
        Transcriber.TRANSCRIBER_SESSION = new TranscriberSession(audioStream)
        Transcriber.TRANSCRIBER_SESSION.startRecorder()
        await Transcriber.TRANSCRIBER_SESSION.startRecognizer()
        Transcriber.TRANSCRIBER.pollResults(1_000)
        Transcriber.rebootTimer = setInterval(
            () => Transcriber.reboot(),
            // restart transcription every 9 minutes as microsoft token expriration
            10_000 * 2,
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
            )
            newTranscriber.startRecorder()
            console.log(
                '[reboot]',
                'newTranscriber = new TranscriberSession',
            )
        } catch (e) {
            console.error('[reboot]', 'error stopping recorder', e)
        }
        try {
            console.log(
                '[reboot]',
                'before Transcriber.TRANSCRIBER.stopRecorder',
            )
            await Transcriber.TRANSCRIBER_SESSION?.stopRecorder()
            console.log(
                '[reboot]',
                'after Transcriber.TRANSCRIBER.stopRecorder',
            )
        } catch (e) {
            console.error('[reboot]', 'error stopping recorder', e)
        }

        // Reboot the recognizer (audio data is buffered in the meantime)
        try {
            console.log(
                '[reboot]',
                'before Transcriber.TRANSCRIBER.stopRecognizer',
            )
            await Transcriber.TRANSCRIBER_SESSION?.stopRecognizer()
            console.log(
                '[reboot]',
                'after Transcriber.TRANSCRIBER.stopRecognizer',
            )
        } catch (e) {
            console.error('[reboot]', 'error stoping recognizer', e)
        }
        try {
            console.log(
                '[reboot] before newTranscriber.startRecognizer',
                'before ',
            )
            await newTranscriber.startRecognizer()
            console.log(
                '[reboot]',
                'after Transcriber.newTranscriber.startRecognizer',
            )
        } catch (e) {
            console.error('[reboot]', 'error starting recognizer', e)
        }
        this.TRANSCRIBER_SESSION = newTranscriber
    }

    /**  Ends the transcribing, and destroys resources. */
    static async stop(): Promise<void> {
        if (Transcriber.TRANSCRIBER == null) throw 'Transcriber not inited'

        clearInterval(Transcriber.rebootTimer)
        //Transcriber.TRANSCRIBER.destroy()
        //tryOrLog('Stop audio stream', async () =>
        //    Transcriber.TRANSCRIBER?.audioStream.getAudioTracks()[0].stop(),
        //)
        tryOrLog(
            'Stop transcription',
            async () => await Transcriber.TRANSCRIBER_SESSION?.stopRecorder(),
        )
        tryOrLog(
            'Stop transcription',
            async () => await Transcriber.TRANSCRIBER_SESSION?.stopRecognizer(),
        )

        // Retreive last results that weren't polled
        await Transcriber.getResults()
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
    private pollResults(interval: number): void {
        if (this.pollTimer != null) throw 'Already polling'

        this.pollTimer = setInterval(Transcriber.getResults, interval)
    }

    /** Gets and handles recognizer results. */
    private static async getResults(): Promise<void> {
        for (const { offset, json } of await RecognizerClient.getResults()) {
            // Sadly this is not typed
            const result: {
                PrimaryLanguage?: { Language?: string }
                NBest?: {
                    Words?: { Word: string; Offset: number; Duration: number }[]
                    Display?: string
                    Confidence?: number
                }[]
            } = JSON.parse(json)
            const language = result.PrimaryLanguage?.Language
            const best = result.NBest ? result.NBest[0] : undefined
            const text = best?.Display
            const words = best?.Words
            const confidence = best?.Confidence

            if (language) {
                Transcriber.handleLanguage(language)
            }

            if (text && words && confidence) {
                Transcriber.handleResult(offset, text, words, confidence)
            }
        }
    }

    /** Handles detected language. */
    private static async handleLanguage(language: string): Promise<void> {
        if (language === '' || parameters.language === language) return
        console.log('[handleLanguage]', new Date(), language)

        parameters.language = language
        await api.notifyApp(parameters.user_token, {
            message: 'LangDetected',
            user_id: parameters.user_id,
            payload: { language },
        })
    }

    /** Handles detected language. */
    private static async handleResult(
        offset: number,
        text: string,
        words: { Word: string; Offset: number; Duration: number }[],
        confidence: number,
    ): Promise<void> {
        if (!(SESSION && offset !== 0 && START_RECORD_OFFSET !== 0)) return

        // NOTE: MS trim punctuation from `Words`, but it's kept in `Display`
        const splitted = (() => {
            const res: string[] = []
            const splitted = text.split(' ')

            for (let i = 0; i < splitted.length; i++) {
                if (res.length > 0 && !!splitted[i].match(/^[.,:!?]/)) {
                    res[res.length - 1] = `${res[res.length - 1]} \xa0${
                        splitted[i]
                    } `
                } else {
                    res.push(splitted[i])
                }
            }

            return res
        })()

        console.log(
            '[handleResult] offset from start of video: ',
            (offset - START_RECORD_OFFSET) / 1_000,
        )
        for (let [i, word] of words.entries()) {
            const value = (() => {
                if (
                    splitted[i] == null ||
                    !splitted[i]
                        .toLowerCase()
                        .startsWith(word.Word.toLowerCase())
                ) {
                    return word.Word
                } else {
                    return splitted[i]
                }
            })()

            // NOTE: MS returns offsets in ticks:
            // "One tick represents one hundred nanoseconds or one ten-millionth of a second."
            const TEN_MILLION = 10_000_000

            let ts = word.Offset / TEN_MILLION
            let end_ts = word.Offset / TEN_MILLION + word.Duration / TEN_MILLION
            ts += (offset - START_RECORD_OFFSET) / 1_000
            end_ts += (offset - START_RECORD_OFFSET) / 1_000

            console.log('[handleResult]', word)
            SESSION.words.push({ type: 'text', value, ts, end_ts, confidence })
        }
        console.log('[handleResult]', new Date(), words.length)
    }
}

export class TranscriberSession {
    private recorder: RecordRTC | undefined
    private offset: number
    private bufferAudioData: boolean
    private bufferedAudioData: ArrayBuffer[]
    private queue: asyncLib.AsyncQueue<() => Promise<void>>
    private audioStream: MediaStream
    private sampleRate: number

    constructor(audioStream: MediaStream) {
        this.queue = newSerialQueue()
        this.audioStream = audioStream
        this.sampleRate =
            audioStream.getAudioTracks()[0].getSettings().sampleRate ?? 0
        this.offset = 0
        this.bufferAudioData = true
        this.bufferedAudioData = []
    }
    /** Starts the recorder. */
    startRecorder(): void {
        // NOTE:
        // We buffer audio data when not transcribing (i.e. when rebooting)
        // and flush that back to the next recognizer session
        // We also use a queue to make sure writes to the recognizer are sequential
        // (recorder.ondataavailable does not await...)

        this.bufferAudioData = true
        this.recorder = new RecordRTC(this.audioStream, {
            type: 'audio',
            mimeType: 'audio/webm;codecs=pcm', // endpoint requires 16bit PCM audio
            recorderType: StereoAudioRecorder,
            timeSlice: 250, // set 250 ms intervals of data that sends to AAI
            desiredSampRate: this.sampleRate,
            numberOfAudioChannels: 1, // real-time requires only one channel
            bufferSize: 4096,
            audioBitsPerSecond: this.sampleRate * 16,
            ondataavailable: async (blob: Blob) => {
	    console.log('ondataavailable')
               if (this.bufferAudioData) {
                   this.bufferedAudioData.push(await blob.arrayBuffer())
               } else {
                   // Flush buffered data
                   for (const buffer of this.bufferedAudioData.splice(0)) {
                       await RecognizerClient.write(
                           Array.from(new Uint8Array(buffer)),
                       )
                   }

                   await RecognizerClient.write(
                       Array.from(
                           new Uint8Array(await blob.arrayBuffer()),
                       ),
                   )
               }
            },
            disableLogs: true,
        })

        this.recorder?.startRecording()
        this.offset = new Date().getTime()
    }

    /** Stops the recorder. */
    async stopRecorder(): Promise<void> {
        // Make sure (?) we get all data from the recorder
        await new Promise((resolve: any) => {
            this.recorder?.stopRecording(resolve)
        })
        console.log('[reboot]', 'this.recorder.stopped')


        //this.recorder?.destroy()
        console.log('[reboot]', 'this.recorder.destroy')
    }

    /** Starts the recognizer. */
    async startRecognizer(): Promise<void> {
        await RecognizerClient.start({
            language: parameters.language,
            sampleRate: this.sampleRate,
            offset: this.offset,
        })

        this.bufferAudioData = false
    }

    /** Stops the recognizer. */
    async stopRecognizer(): Promise<void> {
        await RecognizerClient.stop()
    }

    /** Destroys resources and stops polling. */
    private destroy(): void {
        this.recorder?.destroy()

        //if (this.pollTimer != null) {
        //    clearInterval(this.pollTimer)
        //    this.pollTimer = undefined
        //}
    }
}
/**
 * A client to call the `/recognizer/*` routes on the underlying NodeJS server.
 */
class RecognizerClient {
    /** Calls POST `/recognizer/start`. */
    static async start({
        language,
        sampleRate,
        offset,
    }: {
        language: string
        sampleRate: number
        offset: number
    }): Promise<void> {
        await axios({
            method: 'post',
            url: 'http://127.0.0.1:8080/recognizer/start',
            data: {
                language,
                sampleRate,
                offset,
                vocabulary: parameters.vocabulary,
            },
        })
    }

    /** Calls POST `/recognizer/write`. */
    static async write(bytes: number[]): Promise<void> {
        await axios({
            method: 'post',
            url: 'http://127.0.0.1:8080/recognizer/write',
            data: { bytes },
        })
    }

    /** Calls POST `/recognizer/stop`. */
    static async stop(): Promise<void> {
        await axios({
            method: 'post',
            url: 'http://127.0.0.1:8080/recognizer/stop',
        })
    }

    /** Calls GET `/recognizer/results`. */
    static async getResults(): Promise<RecognizerResult[]> {
        return (
            await axios({
                method: 'get',
                url: 'http://127.0.0.1:8080/recognizer/results',
            })
        ).data
    }
}
