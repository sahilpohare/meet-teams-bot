import axios from 'axios'
import { RecognizerTranscript, sleep } from '../../api'
import { parameters } from '../../background'

// const GLADIA_API_KEY = '8b82f7ea-c1c8-4e3d-abc3-18af0fce1f03'
const API_URL = 'https://api.gladia.io/v2/transcription'
const CREATED_HTML_CODE = 201
const DONE_HTML_CODE = 200
const TRANSCRIPTION_WAIT_TIME = 5_000

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

// Get Gladia raw Transcipt
export async function recognizeGladia(
    audioUrl: string,
    _phrases: string[],
): Promise<GladiaResult> {
    const requestBody = {
        audio_url: audioUrl,
        diarization: false,
        sentences: false,
        subtitles: false,
        enable_code_switching: false,
        detect_language: true,
    }
    const api_key = parameters.speech_to_text_api_key!
    console.log('Requesting Gladia transcription', api_key)
    let axios_response = await axios.post(`${API_URL}`, requestBody, {
        headers: {
            accept: 'application/json',
            'x-gladia-key': api_key,
            'content-type': 'application/json',
        },
    })
    if (axios_response.status !== CREATED_HTML_CODE) {
        console.error('Cannot make transcribe request to Gladia :', axios_response)
        throw axios_response
    }
    let response: TranscribeRequestResponse = axios_response.data
    console.log(response)
    let result: GladiaResult
    while (true) {
        await sleep(TRANSCRIPTION_WAIT_TIME)
        result = await getResult(response.id)
        if (result.status === 'error') {
            console.error('Error from Gladia :', result)
            throw result
        }
        if (result.status === 'done') {
            break
        }
        console.log('Waiting for Gladia transcription completion')
    }
    console.log(result)
    return result
}

// Parse the result from Gladia to extract all the words with their corresponding timestamps.
export function parseGladia(
    apiResponse: GladiaResult,
    offset: number,
): RecognizerTranscript[] {
    const words = findWords(apiResponse.result).map((w) => {
        let ts = w.start
        let end_ts = w.end
        ts += offset
        end_ts += offset

        return {
            type: 'text',
            value: w.word.trim(),
            ts,
            end_ts,
            // confidence: w.confidence,
            // IMPORTANT : The server doesn't seem to interpret things correctly if we return the actual confidence,
            // which is less than 1.
            confidence: 1,
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

async function getResult(id: string): Promise<GladiaResult> {
    const api_key = parameters.speech_to_text_api_key!
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
    let results: GladiaWordWithTimestamp[] = new Array()

    function recurse(currentObj: any) {
        if (Array.isArray(currentObj)) {
            currentObj.forEach((item) => recurse(item))
        } else if (typeof currentObj === 'object' && currentObj !== null) {
            for (const key in currentObj) {
                if (key === 'words') {
                    let v: GladiaWordWithTimestamp[] = currentObj[key]
                    v.forEach((elem) => {
                        results.push(elem)
                    })
                } else {
                    recurse(currentObj[key])
                }
            }
        }
    }
    recurse(obj)
    return results
}
