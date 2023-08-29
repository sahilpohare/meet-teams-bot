import { axiosRetry, api, RecognizerWord, RecognizerResults } from 'spoke_api_js'
import * as R from 'ramda'
import axios from 'axios'
import { parameters } from '../background'
import { START_RECORD_OFFSET, SESSION } from '../record'
import { wordPosterWorker } from './wordPosterWorker'
import { trySummarizeNext, summarizeWorker } from './summarizeWorker'
import { calcHighlights, highlightWorker } from './highlightWorker'
import RecordRTC, { StereoAudioRecorder } from 'recordrtc'

// const date = new Date()
// const now = date.getTime()
// MAX_TS_PREVIOUS_WORKER = now - START_TRANSCRIBE_OFFSET
// START_TRANSCRIBE_OFFSET = now
let START_TRANSCRIBE_OFFSET = 0
let MAX_TS_PREVIOUS_WORKER = 0
const OFFSET_MICROSOFT_BUG = 0.00202882151

const tryOrLog = async <T>(message: string, fn: () => Promise<T>) => {
  try {
    await fn()
  } catch (e) {
    console.error(message, e)
  }
}

/**
 * A client to call the `/recognizer/*` routes on the underlying NodeJS server.
 */
class RecognizerClient {
  /** Calls POST `/recognizer/start`. */
  static async start({ language, sampleRate }: { language: string, sampleRate: number }): Promise<void> {
    await axios({
      method: 'post',
      url: 'http://127.0.0.1:8080/recognizer/start',
      data: { language, sampleRate }
    })
  }

  /** Calls POST `/recognizer/write`. */
  static async write(bytes: number[]): Promise<void> {
    await axios({
      method: 'post',
      url: 'http://127.0.0.1:8080/recognizer/write',
      data: { bytes }
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
  static async getResults(): Promise<RecognizerResults> {
    return (await axios({
      method: 'get',
      url: 'http://127.0.0.1:8080/recognizer/results',
    })).data
  }
}

/**
 * Transcribes an audio stream using the recognizer of the underlying Node server.
 */
export class Transcriber {
  static TRANSCRIBER: Transcriber | undefined
  static STOPPED = false

  private audioStream: MediaStream
  private sampleRate: number
  private recorder: RecordRTC | undefined
  private wordPosterWorker: Promise<void>
  private summarizeWorker: Promise<void>
  private highlightWorker: Promise<void>
  private pollTimer: NodeJS.Timer | undefined
  // TODO buffer the audio data inbetween stops and starts here

  /** Inits the transcriber. */
  static async init(audioStream: MediaStream): Promise<void> {
    if (Transcriber.TRANSCRIBER != null) throw 'Transcriber already inited'

    Transcriber.TRANSCRIBER = new Transcriber(audioStream)
    Transcriber.TRANSCRIBER.launchWorkers()
    Transcriber.TRANSCRIBER.startRecorder()
    await Transcriber.TRANSCRIBER.startRecognizer()
    Transcriber.TRANSCRIBER.pollResults(1_000)
  }

  /** Stops and restarts the recognizer (to update its tokens and language). */
  static async reboot(): Promise<void> {
    if (Transcriber.TRANSCRIBER == null) throw 'Transcriber not inited'

    // TODO Transcriber.TRANSCRIBER.startBuffering()

    // We reboot the  recorder as well to (hopefully) reduce memory usage
    // We restart instantly to (hopefully) resume where we just left off
    Transcriber.TRANSCRIBER.stopRecorder()
    Transcriber.TRANSCRIBER.startRecorder()

    // Reboot the recognizer
    await Transcriber.TRANSCRIBER.stopRecognizer()
    await Transcriber.TRANSCRIBER.startRecognizer()

    // TODO Transcriber.TRANSCRIBER.stopBuffering()
  }

  /**  Ends the transcribing, and destroys resources. */
  static async stop(): Promise<void> {
    if (Transcriber.TRANSCRIBER == null) throw 'Transcriber not inited'

    Transcriber.TRANSCRIBER.destroy()
    tryOrLog("Stop audio stream", async () => Transcriber.TRANSCRIBER?.audioStream.getAudioTracks()[0].stop())
    tryOrLog("Stop transcription", async () => await Transcriber.TRANSCRIBER?.stopRecognizer())

    // One last time, to make sure (TODO redo workers, do this last getResults in waitUntilComplete?)
    await Transcriber.getResults()
  }

  /** Waits for the workers to finish, and destroys the transcbriber. */
  static async waitUntilComplete(): Promise<void> {
    if (Transcriber.TRANSCRIBER == null) throw 'Transcriber not inited'

    Transcriber.STOPPED = true

    await Transcriber.TRANSCRIBER.wordPosterWorker

    if (SESSION?.project.id && R.all((v) => v.words.length === 0, SESSION.video_informations)) {
      tryOrLog('Patching project', async () => await api.patchProject({
        id: SESSION?.project.id,
        no_transcript: true,
      }))
    }

    tryOrLog("Set transcription as complete", async () => {
      if (!SESSION) return

      for (const infos of SESSION.video_informations) {
        const video = infos.complete_editor?.video

        if (video != null && video.transcription_completed === false) {
          await api.patchVideo({ id: video.id, transcription_completed: true })
          video.transcription_completed = true
        }
      }
    })

    await Transcriber.TRANSCRIBER.summarizeWorker
    await Transcriber.TRANSCRIBER.highlightWorker

    while (await trySummarizeNext(true)) { }

    tryOrLog("Calculate highlights", async () => await calcHighlights(true))

    if (SESSION) {
      tryOrLog("Patch asset", async () => await api.patchAsset({ id: SESSION?.asset.id, uploading: false }))
      tryOrLog("Send worker message (new spoke)", async () => await api.workerSendMessage({
        NewSpoke: {
          project_id: SESSION?.project.id,
          user: { id: parameters.user_id },
        },
      }))
    }

    // Releases memory?
    Transcriber.TRANSCRIBER = undefined
  }

  /** Returns a new `Transcriber`. */
  private constructor(audioStream: MediaStream) {
    this.audioStream = audioStream
    this.sampleRate = audioStream.getAudioTracks()[0].getSettings().sampleRate ?? 0

    // Simply not to have undefined properties
    this.wordPosterWorker = new Promise(resolve => resolve())
    this.summarizeWorker = new Promise(resolve => resolve())
    this.highlightWorker = new Promise(resolve => resolve())
  }

  /** Launches the workers. */
  private async launchWorkers(): Promise<void> {
    this.wordPosterWorker = wordPosterWorker()
    this.summarizeWorker = summarizeWorker()
    this.highlightWorker = highlightWorker()
  }

  /** Starts the recorder. */
  private startRecorder(): void {
    this.recorder = new RecordRTC(this.audioStream, {
      type: 'audio',
      mimeType: 'audio/webm;codecs=pcm', // endpoint requires 16bit PCM audio
      recorderType: StereoAudioRecorder,
      timeSlice: 250, // set 250 ms intervals of data that sends to AAI
      desiredSampRate: this.sampleRate,
      numberOfAudioChannels: 1, // real-time requires only one channel
      bufferSize: 4096,
      audioBitsPerSecond: this.sampleRate * 16,
      ondataavailable: async (blob: Blob) => await RecognizerClient.write(Array.from(new Uint8Array(await blob.arrayBuffer()))),
      disableLogs: true,
    })
    this.recorder.startRecording()
  }

  /** Stops the recorder. */
  private stopRecorder(): void {
    if (this.recorder != null) {
      this.recorder.stopRecording()
      this.recorder.destroy()
    }
  }

  /** Starts the recognizer. */
  private async startRecognizer(): Promise<void> {
    await RecognizerClient.start({ language: parameters.language, sampleRate: this.sampleRate })
  }

  /** Stops the recognizer. */
  private async stopRecognizer(): Promise<void> {
    await RecognizerClient.stop()
  }

  /** Gets and handles recognizer results every `interval` ms. */
  private pollResults(interval: number): void {
    if (this.pollTimer != null) throw 'Already polling'

    this.pollTimer = setInterval(Transcriber.getResults, interval)
  }

  /** Destroys resources and stops polling. */
  private destroy(): void {
    if (this.recorder != null) {
      this.recorder.destroy()
    }

    if (this.pollTimer != null) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }

  /** Gets and handles recognizer results. */
  private static async getResults(): Promise<void> {
    for (const { language, words } of await RecognizerClient.getResults()) {
      if (language != null) await Transcriber.handleLanguage(language)
      if (words != null) Transcriber.handleWords(words)
    }
  }

  /** Handles recognized words. */
  private static handleWords(words: RecognizerWord[]): void {
    // if (!(SESSION && START_TRANSCRIBE_OFFSET !== 0 && START_RECORD_OFFSET !== 0)) return
    if (!SESSION) return

    for (const word of words) {
      word.ts -= OFFSET_MICROSOFT_BUG * word.ts
      word.end_ts -= OFFSET_MICROSOFT_BUG * word.end_ts
      word.ts += START_TRANSCRIBE_OFFSET - START_RECORD_OFFSET
      word.end_ts += START_TRANSCRIBE_OFFSET - START_RECORD_OFFSET
      SESSION.words.push(word)
    }
  }

  /** Handles detected language. */
  private static async handleLanguage(language: string): Promise<void> {
    if (language === '' || parameters.language === language) return

    parameters.language = language
    await api.notifyApp(parameters.user_token, {
      message: 'LangDetected',
      user_id: parameters.user_id,
      payload: { language },
    })
  }
}
