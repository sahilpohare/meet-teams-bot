import { RecognizerWord } from 'spoke_api_js'
import { Speaker } from '../observeSpeakers'
import { RecognizerTranscript } from './parseTranscript'

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
    //    let speakerIntervals = timestampToInterval(speakers)
    return []

    //    let speakerScores: Map<number, Map<string, number>> = new Map()
    //    console.log('speaker intervals', speakerIntervals)
    //    for (let i = 0; i < transcripts.length; i++) {
    //        let transcript = transcripts[i]
    //        let scores = speakerScores.get(transcripts[i].speaker) || new Map()
    //        for (const [name, score] of scores) {
    //            console.log(
    //                'for speaker',
    //                transcripts[i].speaker,
    //                'of transcript: ',
    //                transcript.words.map((w) => w.value).join(' '),
    //                'score of ',
    //                name,
    //                'is',
    //                score,
    //            )
    //        }
    //        let start = transcripts[i].startTime * 1000
    //        let end = transcripts[i].endTime * 1000
    //
    //        // Find intersection between timestamps and speakerIntervals
    //        for (const interval of speakerIntervals) {
    //            const intersection = getIntervalIntersection(
    //                [start, end],
    //                [interval.start_time, interval.end_time],
    //            )
    //            if (intersection != null) {
    //                const duration = intersection[1] - intersection[0]
    //                console.log(
    //                    start,
    //                    end,
    //                    'found intersection between ',
    //                    interval.speaker,
    //                    transcript.speaker,
    //                    ' of duration',
    //                    duration,
    //                )
    //                scores?.set(
    //                    interval.speaker,
    //                    (scores?.get(interval.speaker) || 0) + duration,
    //                )
    //            }
    //        }
    //        speakerScores.set(transcripts[i].speaker, scores)
    //    }
    //    const speakerAssociations = new Map<number, string>()
    //    for (const [speaker, scores] of speakerScores) {
    //        let max = 0
    //        let maxSpeaker = ''
    //        for (const [name, score] of scores) {
    //            if (score > max) {
    //                max = score
    //                maxSpeaker = name
    //            }
    //        }
    //        speakerAssociations.set(speaker, maxSpeaker)
    //    }
    //    for (const [speaker, speakerName] of speakerAssociations) {
    //        console.log('speaker association: ', speaker, 'is', speakerName)
    //    }
    //    let newTranscripts = transcripts.map((t) => {
    //        return {
    //            ...t,
    //            speaker: speakerAssociations.get(t.speaker) || 'unknown',
    //        }
    //    })
    //    console.log('new transcripts', newTranscripts)
    //    return newTranscripts
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
