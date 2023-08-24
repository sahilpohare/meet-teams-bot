import { axiosRetry, api, RecognizerWord, RecognizerData } from 'spoke_api_js'
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

/** A client to call the `/recognizer/*` routes on the underlying NodeJS server */
class RecognizerClient {
  /** Calls `/recognizer/start` */
  static async start({ lang, sampleRate }: { lang: string, sampleRate: number }): Promise<void> {
    await axios({
      method: 'post',
      url: 'http://127.0.0.1:8080/recognizer/start',
      data: { lang, sampleRate }
    })
  }

  /** Calls `/recognizer/write` */
  static async write(bytes: number[]): Promise<void> {
    await axios({
      method: 'post',
      url: 'http://127.0.0.1:8080/recognizer/write',
      data: { bytes }
    })
  }

  /** Calls `/recognizer/stop` */
  static async stop(): Promise<void> {
    await axios({
      method: 'post',
      url: 'http://127.0.0.1:8080/recognizer/stop',
    })
  }

  /** Calls `/recognizer/flush` */
  static async flush(): Promise<RecognizerData> {
    return (await axios({
      method: 'post',
      url: 'http://127.0.0.1:8080/recognizer/flush',
    })).data
  }
}

export class Transcriber {
  static TRANSCRIBER: Transcriber | undefined
  static STOPPED = false

  private audioStream: MediaStream
  private sampleRate: number
  private recorder: RecordRTC
  private wordPosterWorker: Promise<void>
  private summarizeWorker: Promise<void>
  private highlightWorker: Promise<void>
  private pollTimer: NodeJS.Timer

  static async init(audioStream: MediaStream): Promise<void> {
    Transcriber.TRANSCRIBER = new Transcriber(audioStream)

    // Start recording audio, transcribing, and polling results
    Transcriber.TRANSCRIBER.recorder.startRecording()
    await Transcriber.TRANSCRIBER.start()
    Transcriber.TRANSCRIBER.pollTimer = Transcriber.poll(1_000)

    // Launch workers
    Transcriber.TRANSCRIBER.wordPosterWorker = wordPosterWorker()
    Transcriber.TRANSCRIBER.summarizeWorker = summarizeWorker()
    Transcriber.TRANSCRIBER.highlightWorker = highlightWorker()
  }

  static async reboot(): Promise<void> {
    if (Transcriber.TRANSCRIBER == null) throw 'Transcriber not started'

    await Transcriber.TRANSCRIBER.stop()
    await Transcriber.TRANSCRIBER.start()
  }

  private constructor(audioStream: MediaStream) {
    this.audioStream = audioStream
    this.sampleRate = audioStream.getAudioTracks()[0].getSettings().sampleRate ?? 0
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
        await RecognizerClient.write(Array.from(new Uint8Array(await blob.arrayBuffer())))
      },
    })

    // Simply not to have undefined properties
    this.wordPosterWorker = new Promise(resolve => resolve())
    this.summarizeWorker = new Promise(resolve => resolve())
    this.highlightWorker = new Promise(resolve => resolve())
    this.pollTimer = setTimeout(() => false, 0)
  }

  private async start(): Promise<void> {
    await RecognizerClient.start({ lang: parameters.language, sampleRate: this.sampleRate })
  }

  private async stop(): Promise<void> {
    await RecognizerClient.stop()
  }

  private destroy(): void {
    this.recorder.destroy()
    clearInterval(this.pollTimer)
  }

  private static poll(interval: number): NodeJS.Timer {
    return setInterval(async () => {
      for (const { lang, words } of await RecognizerClient.flush()) {
        if (lang != null) await Transcriber.handleLanguage(lang)
        if (words != null) Transcriber.handleWords(words)
      }
    }, interval)
  }

  private static handleWords(words: RecognizerWord[]): void {
    if (!(SESSION && START_TRANSCRIBE_OFFSET !== 0 && START_RECORD_OFFSET !== 0)) return

    for (const word of words) {
      word.ts -= OFFSET_MICROSOFT_BUG * word.ts
      word.end_ts -= OFFSET_MICROSOFT_BUG * word.end_ts
      word.ts += START_TRANSCRIBE_OFFSET - START_RECORD_OFFSET
      word.end_ts += START_TRANSCRIBE_OFFSET - START_RECORD_OFFSET
      SESSION.words.push(word)
    }
  }

  private static async handleLanguage(language: string): Promise<void> {
    if (parameters.language !== language && language !== '') {
      parameters.language = language
      await api.notifyApp(parameters.user_token, {
        message: 'LangDetected',
        user_id: parameters.user_id,
        payload: { language },
      })
    }
  }
}

export async function changeLanguage() {
  await Transcriber.reboot()
}

export async function stop() {
  /*
  try {
    STREAMING_TRANSCRIBE?.stream.getAudioTracks()[0].stop()
  } catch (e) {
    console.error('error stoping streaming', e)
  }
  try {
    await STREAMING_TRANSCRIBE?.stopTranscribing()
    console.log('stop transcribing awaited')
  } catch (e) {
    console.error('error stoping transcribing', e)
  }
  */
}

export async function waitUntilComplete() {
  /*
  STOPPED = true
  await STREAMING_TRANSCRIBE?.wordPosterWorker
  console.log('set transcription as complete')
  try {
    if (
      parameters.email === 'lazare@spoke.app' &&
      SESSION?.project.id &&
      parameters.meeting_provider === 'Zoom'
    ) {
      await api.adjustEndSentences(SESSION.project.id)
    }
  } catch (e) {
    console.error('error adjusting end sentences', e)
  }
  try {
    if (SESSION?.project.id) {
      if (
        R.all((v) => v.words.length === 0, SESSION.video_informations)
      ) {
        api.patchProject({
          id: SESSION?.project.id,
          no_transcript: true,
        })
      }
    }
  } catch (e) {
    console.error('error patching project', e)
  }
  try {
    await setTranscriptionAsComplete()
  } catch (e) {
    console.error('error setting transcription as complete', e)
  }

  await STREAMING_TRANSCRIBE?.summarizeWorker
  console.log('summarize worker complete')
  await STREAMING_TRANSCRIBE?.highlightWorker
  console.log('highlight worker complete')
  while (await trySummarizeNext(true)) { }
  try {
    await calcHighlights(true)
  } catch (e) {
    console.log(e, 'calcHighlight failed')
  }

  if (SESSION) {
    await api.patchAsset({ id: SESSION.asset.id, uploading: false })
    const message = {
      NewSpoke: {
        project_id: SESSION?.project.id,
        user: {
          id: parameters.user_id,
        },
      },
    }
    try {
      await api.workerSendMessage(message)
    } catch (e) {
      console.error('failed to send worker message new spoke')
    }
  }
  */
}

async function setTranscriptionAsComplete() {
  if (!SESSION) return

  for (const v of SESSION.video_informations) {
    const video = v.complete_editor?.video

    if (video != null && video.transcription_completed === false) {
      await api.patchVideo({
        id: video.id,
        transcription_completed: true,
      })
      video.transcription_completed = true
    }
  }
}
