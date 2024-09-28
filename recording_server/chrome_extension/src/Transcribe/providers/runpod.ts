import axios from 'axios'
import { RecognizerTranscript, sleep } from '../../api'
import { parameters } from '../../background'

const RUNPOD_API_KEY = 'B1EC90VQNXMASRD9QJJAALGOS0YL73JEMKZQ92IJ'
const API_URL = 'https://api.runpod.ai/v2/oq0i26ut0lom1h'

type RunPodResult = {
    detected_language: string
    word_timestamps: RunPodWordTimestamp[]
}
type RunPodWordTimestamp = {
    start: number
    end: number
    word: string
}

type RunPodTranscriptionStatus = {
    id: string
    status: string
    output?: RunPodResult
}

export async function recognizeRunPod(
    audioUrl: string,
    phrases: string[],
): Promise<RunPodResult> {
    const requestBody = {
        input: {
            audio: audioUrl,
            model: 'large-v3',
            transcription: 'plain_text',
            translate: false,
            temperature: 0,
            best_of: 5,
            beam_size: 5,
            patience: 1,
            suppress_tokens: '-1',
            condition_on_previous_text: false,
            temperature_increment_on_fallback: 0.2,
            compression_ratio_threshold: 2.4,
            logprob_threshold: -1,
            no_speech_threshold: 0.6,
            word_timestamps: true,
        },
        enable_vad: false,
    }

    const api_key = parameters.speech_to_text_api_key
        ? parameters.speech_to_text_api_key
        : RUNPOD_API_KEY
    console.log('Requesting RunPod transcription', api_key)
    let response = await axios.post(`${API_URL}/run`, requestBody, {
        headers: {
            accept: 'application/json',
            Authorization: api_key,
            'content-type': 'application/json',
        },
    })
    console.log(response.data)
    let status: RunPodTranscriptionStatus = response.data
    while (status.status !== 'COMPLETED' && status.status !== 'FAILED') {
        await sleep(5000)
        status = await checkStatus(status.id)
    }
    console.log(status)
    // Transform or process the response as needed here
    return status.output!
}

/** Handles detected language. */
// TODO : handle language
export function parseRunPod(
    apiResponse: RunPodResult,
    offset: number,
): RecognizerTranscript[] {
    const words = apiResponse.word_timestamps.map((w) => {
        let ts = w.start
        let end_ts = w.end
        ts += offset
        end_ts += offset

        return {
            type: 'text',
            value: w.word.trim(),
            ts,
            end_ts,
            confidence: 1.0,
        }
    })

    return [
        {
            words,
            startTime: 0,
            endTime: 0,
            speaker: 0,
        },
    ]
}

async function checkStatus(id: string) {
    const token = RUNPOD_API_KEY
    const response = await axios.get(`${API_URL}/status/${id}`, {
        headers: {
            accept: 'application/json',
            Authorization: token,
            'content-type': 'application/json',
        },
    })

    console.log(response.data)
    return response.data
}
