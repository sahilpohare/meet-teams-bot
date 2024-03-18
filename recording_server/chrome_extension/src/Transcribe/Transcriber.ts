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
<<<<<<< HEAD
        this.wordPosterWorker = wordPosterWorker()

        if (parameters.bot_id == null) {
            this.summarizeWorker = summarizeWorker()
        }
=======
        this.summarizeWorker = summarizeWorker()
>>>>>>> gladia2
    }
    /** Gets and handles recognizer results every `interval` ms. */
}

<<<<<<< HEAD
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
=======
let NO_TRANSCRIPT_DURATION = 0
>>>>>>> gladia2

/** Gets and handles recognizer results. */
async function onResult(json: GladiaResult, offset: number) {
    console.log('[onResult] ')
    if (R.all((v) => v.words.length === 0, json.prediction)) {
        NO_TRANSCRIPT_DURATION += TRANSCRIPTION_CHUNK_DURATION

<<<<<<< HEAD
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
=======
        if (NO_TRANSCRIPT_DURATION > MAX_NO_TRANSCRIPT_DURATION) {
            let params = {
                session_id: parameters.session_id,
                user_token: parameters.user_token,
>>>>>>> gladia2
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
