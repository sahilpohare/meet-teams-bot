import { RecognizerWord, RunPodResult } from '../spoke_api_js'

export type RecognizerTranscript = {
    speaker: number
    startTime: number
    endTime: number
    words: RecognizerWord[]
}

/** Handles detected language. */
//TODO: handle language
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
