import { axiosRetry, doContinuousRecognition } from 'spoke_api_js'
import * as R from 'ramda'
import { parameters } from '../background'
import { START_RECORD_OFFSET, SESSION } from '../record'
import { api, RevWord } from 'spoke_api_js'
import axios from 'axios'
import { wordPosterWorker } from './wordPosterWorker'
import { trySummarizeNext, summarizeWorker } from './summarizeWorker'
import { calcHighlights, highlightWorker } from './highlightWorker'

export let START_TRANSCRIBE_OFFSET: number = 0
export let MAX_TS_PREVIOUS_WORKER: number = 0
const OFFSET_MICROSOFT_BUG = 0.00202882151

export let STOPED = false
type StreamingTranscribe = {
    // indicate if worker are up to date (when there is a change of the language)
    workerVersion: number
    // the max timestamp of word to accept from the previous worker
    stream: MediaStream
    audioContext: AudioContext
    wordPosterWorker: Promise<void>
    summarizeWorker: Promise<void>
    highlightWorker: Promise<void>
    stopTranscribing: () => Promise<void>
} | null

export let STREAMING_TRANSCRIBE: StreamingTranscribe = null

export async function streamingTranscribe(
    stream,
    audioContext,
    workerVersion: number = 0,
) {
    console.log('[streaming transcribe]')
    const token = await api.requestAuthorizationToken()
    console.log('[streaming transcribe]', token)
    const stopTranscribing = await doContinuousRecognition(
        parameters.language,
        (w) => addWords(w, workerVersion),
        () => {
            const date = new Date()
            const now = date.getTime()
            MAX_TS_PREVIOUS_WORKER = now - START_TRANSCRIBE_OFFSET
            START_TRANSCRIBE_OFFSET = now
        },
        token,
        (l) => languageDetected(audioContext, l),
        stream,
    )

    // token expires in 10 minutes
    setTimeout(() => restartTranscription(), 60 * 1000 * 9)
    STREAMING_TRANSCRIBE = {
        workerVersion,
        stream: stream,
        audioContext: audioContext,
        stopTranscribing,
    } as unknown as StreamingTranscribe

    STREAMING_TRANSCRIBE = {
        ...STREAMING_TRANSCRIBE!,
        wordPosterWorker: wordPosterWorker(workerVersion),
        summarizeWorker: summarizeWorker(workerVersion),
        highlightWorker: highlightWorker(workerVersion),
    }
    console.log('[streaming transcribe] end')
}

let LANG_DETECTED = false
export async function languageDetected(
    audioContext: AudioContext,
    lang: string,
) {
    const now = new Date().getTime()
    console.log('language detected: ', lang, now - START_TRANSCRIBE_OFFSET)
    if (
        now - START_TRANSCRIBE_OFFSET > 50 &&
        (lang === '' || lang === 'unknown')
    ) {
        console.log('no speech detected since 30 secs')
        restartTranscription()
    }
    if (!LANG_DETECTED) {
        if (parameters.language !== lang && lang !== '') {
            parameters.language = lang
            await api.notifyApp(parameters.user_token, {
                message: 'LangDetected',
                user_id: parameters.user_id,
                payload: { language: lang },
            })
        }
    }
}

async function safeStopTranscribe() {
    try {
        await STREAMING_TRANSCRIBE?.stopTranscribing()
    } catch (e) {
        console.error(
            `[safeStopTranscribe]`,
            'stop transcribing failed with ',
            e,
        )
    }
}

export async function restartTranscription() {
    if (STREAMING_TRANSCRIBE && !STOPED) {
        console.log('restart transcription')
        await safeStopTranscribe()
        try {
            await streamingTranscribe(
                STREAMING_TRANSCRIBE.stream,
                STREAMING_TRANSCRIBE.audioContext,
                STREAMING_TRANSCRIBE.workerVersion + 1,
            )
        } catch (e) {
            console.error('error reseting streaming transcribe', e)
        }
        console.log('after streaming transcribe')
    }
}

export async function changeLanguage() {
    await restartTranscription()
}

export async function stop() {
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
}

export async function waitUntilComplete() {
    STOPED = true
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
    while (await trySummarizeNext(true)) {}
    try {
        await calcHighlights(true)
    } catch (e) {
        console.log(e, 'calcHighlight failed')
    }

    //if let Some(project_id) = project_id {
    //    if let Err(e) = post_api_server_request(
    //        "worker/send_message",
    //        serde_json::to_string(&WorkerMessage::NewSpoke { project_id, user }).unwrap(),
    //    )
    //    .await
    //    {
    //        slog::error!(&logger, "error notifying project"; "message" => format!("{}", e));
    //    }
    //}
    if (SESSION) {
        await api.patchAsset({ id: SESSION.asset.id, uploading: false })
        let message = {
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
}

async function setTranscriptionAsComplete() {
    const spokeSession = SESSION
    if (spokeSession) {
        for (const v of spokeSession.video_informations) {
            const video = v.complete_editor?.video
            // console.log('set transcription as complete for video: ', video)
            if (video != null && video.transcription_completed === false) {
                await api.patchVideo({
                    id: video.id,
                    transcription_completed: true,
                })
                video.transcription_completed = true
            }
        }
    }
}

export function addWords(words: RevWord[], workerVersion: number) {
    // console.log('[addWords]', { words })
    if (SESSION && START_TRANSCRIBE_OFFSET !== 0 && START_RECORD_OFFSET !== 0) {
        const newWords = correctMicrosoftBug(words)

        if (
            !(
                STREAMING_TRANSCRIBE &&
                workerVersion < STREAMING_TRANSCRIBE?.workerVersion &&
                newWords[0]?.ts > MAX_TS_PREVIOUS_WORKER
            )
        ) {
            const transformed = transformWords(newWords)
            for (const w of transformed) {
                if (w.type === 'text') {
                    SESSION.words.push({
                        ...w,
                    })
                }
            }
        }
    }
}

function correctMicrosoftBug(words: RevWord[]): RevWord[] {
    const newWords: RevWord[] = []
    for (const w of words) {
        if (w.type === 'punct' && w.value !== ' ') {
            newWords.push(w)
        } else if (
            w.type === 'text' &&
            w.value != null &&
            !w.value.startsWith('<')
        ) {
            const newWord = {
                ...w,
                ts: w.ts - OFFSET_MICROSOFT_BUG * w.ts,
                end_ts: w.end_ts - OFFSET_MICROSOFT_BUG * w.end_ts,
            }
            newWords.push(newWord)
        }
    }
    return newWords
}

function transformWords(words: RevWord[]): RevWord[] {
    const offset = START_TRANSCRIBE_OFFSET - START_RECORD_OFFSET
    const newWords: RevWord[] = []
    for (const w of words) {
        if (w.type === 'punct' && w.value !== ' ') {
            if (newWords.length > 0) {
                newWords[newWords.length - 1].value += w.value
            }
        } else if (
            w.type === 'text' &&
            w.value != null &&
            !w.value.startsWith('<')
        ) {
            // console.log('[transformWords] ', w.ts, w.end_ts, OFFSET_MICROSOFT_BUG * w.end_ts, offset)
            // console.log('[transformWords] end_ts: ', w.end_ts - OFFSET_MICROSOFT_BUG * w.end_ts + offset)
            const newWord = {
                ...w,
                ts: w.ts + offset,
                end_ts: w.end_ts + offset,
            }
            // console.log('[transformWords] newWord: ', newWord)
            newWords.push(newWord)
        }
    }
    return newWords
}
