import axios from 'axios'
import { sleep } from '../../utils'
import { RecognizerWord } from '../words_poster'

const GLADIA_API_KEY = '8b82f7ea-c1c8-4e3d-abc3-18af0fce1f03'
const API_URL = 'https://api.gladia.io/v2/transcription'
const CREATED_HTML_CODE = 201
const DONE_HTML_CODE = 200
const TRANSCRIPTION_WAIT_TIME = 20_000

// {
//     "id": "4c50f1e8-1b3a-44c7-9b5b-96ab9104782b",
//     "result_url": "https://api.gladia.io/v2/transcription/4c50f1e8-1b3a-44c7-9b5b-96ab9104782b"
// }
type TranscribeRequestResponse = {
    id: string
    result_url: string
}

type GladiaResult = {
    // queued	    Audio waiting to be processed
    // processing	Audio file being processed
    // done	        Transcription successfully completed
    // error	    An error occurred on your transcription
    status: string
    file: any
    request_params: any
    result: any
}

// {
//     "word": "Des",
//     "start": 0.18019000000000002,
//     "end": 0.32042,
//     "confidence": 0.38
// },
type GladiaWordWithTimestamp = {
    word: string
    start: number
    end: number
    confidence: number
}

type GladiaWord = {
    word: string
    start: number
    end: number
    confidence: number
}

type GladiaUtterance = {
    text: string
    language: string
    start: number
    end: number
    confidence: number
    channel: number
    words: GladiaWord[]
}

type GladiaTranscription = {
    languages: string[]
    utterances: GladiaUtterance[]
    full_transcript: string
}

// Get Gladia raw Transcipt
export async function recognizeGladia(
    audioUrl: string,
    _vocabulary: string[],
    speech_to_text_api_key: string | null,
): Promise<GladiaResult> {
    const requestBody = {
        audio_url: audioUrl,
        diarization: false,
        sentences: false,
        subtitles: false,
        enable_code_switching: false,
        detect_language: true,
    }
    const api_key = speech_to_text_api_key
        ? speech_to_text_api_key
        : GLADIA_API_KEY
    console.log('Requesting Gladia transcription', api_key)
    let axios_response = await axios.post(`${API_URL}`, requestBody, {
        headers: {
            accept: 'application/json',
            'x-gladia-key': api_key,
            'content-type': 'application/json',
        },
    })
    if (axios_response.status !== CREATED_HTML_CODE) {
        console.error(
            'Cannot make transcribe request to Gladia :',
            axios_response,
        )
        throw axios_response
    }
    let response: TranscribeRequestResponse = axios_response.data
    console.log('Gladia response:', response)
    let result: GladiaResult
    while (true) {
        await sleep(TRANSCRIPTION_WAIT_TIME)
        result = await getResult(response.id, api_key)
        if (result.status === 'error') {
            console.error('Error from Gladia :', result)
            throw result
        }
        if (result.status === 'done') {
            break
        }
        console.log('Waiting for Gladia transcription completion')
    }
    return result
}

// Parse the result from Gladia to extract all the words with their corresponding timestamps.
export function parseGladia(
    apiResponse: GladiaResult,
    offset: number,
): RecognizerWord[] {
    console.log('Starting parseGladia with offset:', offset)
    // Passer apiResponse au lieu de apiResponse.result
    const words = findWords(apiResponse)
    console.log('Found raw words:', words)

    const recognizerWords = words.map((w: GladiaWordWithTimestamp) => {
        const word = {
            text: w.word.trim(),
            start_time: w.start + offset,
            end_time: w.end + offset,
        } as RecognizerWord
        console.log('Transformed word:', word)
        return word
    })

    console.log('Final recognizer words:', recognizerWords)
    return recognizerWords
}

async function getResult(
    id: string,
    speech_to_text_api_key: string,
): Promise<GladiaResult> {
    const api_key = speech_to_text_api_key
    const axios_response = await axios.get(`${API_URL}/${id}`, {
        headers: {
            accept: 'application/json',
            'x-gladia-key': api_key,
            'content-type': 'application/json',
        },
    })
    if (axios_response.status !== DONE_HTML_CODE) {
        console.error('Cannot make get request to Gladia :', axios_response)
        throw axios_response
    }
    let result = axios_response.data
    return result
}

// Find all occurrences of 'words' recursively and push the word sub-elements.
function findWords(obj: GladiaResult): GladiaWordWithTimestamp[] {
    console.log('Processing Gladia result:', JSON.stringify(obj, null, 2))

    if (!obj?.result?.transcription?.utterances) {
        console.warn('No utterances found in Gladia result')
        return []
    }

    const words: GladiaWordWithTimestamp[] = []
    const utterances = obj.result.transcription.utterances

    for (const utterance of utterances) {
        console.log(
            `Processing utterance: "${utterance.text}" with ${utterance.words.length} words`,
        )

        for (const word of utterance.words) {
            const cleanWord = word.word.trim()
            if (cleanWord) {
                words.push({
                    word: cleanWord,
                    start: word.start,
                    end: word.end,
                    confidence: word.confidence,
                })
            }
        }
    }

    console.log(`Found ${words.length} total words`)
    return words
}
