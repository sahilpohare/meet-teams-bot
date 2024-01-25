import { Speaker } from '../observeSpeakers'
import { START_RECORD_TIMESTAMP } from '../record'
import { RecognizerTranscript } from './parseTranscript'
import { RecognizerWord } from 'spoke_api_js'

export type TranscriptWithSpeaker = {
    speaker: string
    startTime: number
    endTime: number
    words: RecognizerWord[]
}

export function addSpeakerNames(
    transcripts: RecognizerTranscript[],
    speakers: Speaker[],
): TranscriptWithSpeaker[] {
    let speakerScores: Map<number, Map<string, number>> = new Map()
    let speakerIntervals = timestampToInterval(speakers)
    console.log('speaker intervals', speakerIntervals)
    for (let i = 0; i < transcripts.length; i++) {
        let transcript = transcripts[i]
        let scores = speakerScores.get(transcripts[i].speaker) || new Map()
        console.log('scores is', scores)
        let timestampStart = START_RECORD_TIMESTAMP + transcripts[i].startTime
        let timestampEnd = START_RECORD_TIMESTAMP + transcripts[i].endTime

        // Find intersection between timestamps and speakerIntervals
        for (const interval of speakerIntervals) {
            const intersection = getIntervalIntersection(
                [timestampStart, timestampEnd],
                [interval.start_timestamp, interval.end_timestamp],
            )
            if (intersection != null) {
                const duration = intersection[1] - intersection[0]
                console.log(
                    'found intersection between ',
                    interval.speaker,
                    transcript.speaker,
                    ' of duration',
                    duration,
                )
                scores?.set(
                    interval.speaker,
                    scores?.get(interval.speaker) || 0 + duration,
                )
            }
        }
        speakerScores.set(transcripts[i].speaker, scores)
    }
    const speakerAssociations = new Map<number, string>()
    for (const [speaker, scores] of speakerScores) {
        let max = 0
        let maxSpeaker = ''
        for (const [name, score] of scores) {
            if (score > max) {
                max = score
                maxSpeaker = name
            }
        }
        speakerAssociations.set(speaker, maxSpeaker)
    }
    console.log('speaker associations', speakerAssociations)
    let newTranscripts = transcripts.map((t) => {
        return {
            ...t,
            speaker: speakerAssociations.get(t.speaker) || 'unknown',
        }
    })
    console.log('new transcripts', newTranscripts)
    return newTranscripts
}

type SpeakerInterval = {
    start_timestamp: number
    end_timestamp: number
    speaker: string
}

function getIntervalIntersection(interval1, interval2) {
    const startMax = Math.max(interval1[0], interval2[0])
    const endMin = Math.min(interval1[1], interval2[1])

    if (startMax <= endMin) {
        // There is an intersection
        return [startMax, endMin]
    } else {
        // No intersection
        return null
    }
}

function timestampToInterval(speakers: Speaker[]): SpeakerInterval[] {
    const intervals = speakers.map((speaker, index) => {
        // For the last speaker, we might want to set a specific end timestamp.
        // Here, we're simply using the next hour as an example.
        const endTimestamp =
            index < speakers.length - 1
                ? speakers[index + 1].timestamp
                : speaker.timestamp + 3600000

        return {
            start_timestamp: speaker.timestamp,
            end_timestamp: endTimestamp,
            speaker: speaker.name,
        }
    })

    return intervals
}
