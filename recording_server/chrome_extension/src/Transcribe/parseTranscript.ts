import {
    GladiaResult,
    RecognizerWord,
    RunPodResult,
    gladiaToGoogleLang,
} from 'spoke_api_js'
import { parameters } from '../state'

export type RecognizerTranscript = {
    speaker: number
    startTime: number
    endTime: number
    words: RecognizerWord[]
}

export function parseGladia(
    apiResponse: GladiaResult,
    offset: number,
): RecognizerTranscript[] {
    return mergeAdjacentTranscripts(
        apiResponse.transcription.utterances.map((p) => {
            if (p.language) {
                handleLanguage(p.language)
            }
            let speaker = p.speaker
            if (typeof speaker === 'string') {
                speaker = 0
            }

            let words = p.words.flatMap((word) => {
                let ts = word.start
                let end_ts = word.end
                ts += offset
                end_ts += offset

                return {
                    type: 'text',
                    value: word.word.trim(),
                    ts,
                    end_ts,
                    confidence: 1.0,
                }
            })

            return {
                startTime: p.start + offset,
                endTime: p.end + offset,
                speaker: speaker,
                words: words,
                language: gladiaToGoogleLang(p.language)
                    ? gladiaToGoogleLang(p.language)
                    : null,
            }
        }),
    )
}

function mergeAdjacentTranscripts(transcripts: RecognizerTranscript[]) {
    let result: RecognizerTranscript[] = []

    if (transcripts.length === 0) {
        return result
    }

    let currentTranscript = transcripts[0]

    for (let i = 1; i < transcripts.length; i++) {
        if (transcripts[i].speaker === currentTranscript.speaker) {
            currentTranscript.words = currentTranscript.words.concat(
                transcripts[i].words,
            )
            currentTranscript.endTime = transcripts[i].endTime
        } else {
            result.push(transcripts[i])
            currentTranscript = transcripts[i]
        }
    }

    result.push(currentTranscript)
    return result
}

/** Handles detected language. */
function handleLanguage(language: string): void {
    if (language === '' || parameters.language === language) return
    const googleLang = gladiaToGoogleLang(language) ?? 'en-US'

    parameters.language = googleLang
}

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
