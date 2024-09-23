import * as R from 'ramda'
import { PostableTranscript, Transcript, api } from './api'
import { SPEAKERS, parameters } from './background'
import { SpeakerData } from './observeSpeakers'
import { SESSION, START_RECORD_TIMESTAMP, SpokeSession } from './record'
// TODO : language_code - 99% sure it is trash code
// import { parameters } from './state'

type SpeakerInterval = {
    start_time: number
    end_time: number
    speaker: string
}

export async function uploadTranscriptTask() {
    let intervals = timestampToInterval(SPEAKERS)
    const spokeSession = SESSION as SpokeSession
    if (intervals.length > spokeSession.transcripts.length) {
        const bot = await api.getBot(parameters.bot_id)
        let interval = intervals[intervals.length - 1]
        const postableTranscript = createTranscript(bot.id, interval)
        try {
            const transcript = await api.postTranscript(postableTranscript)
            insertIntoSortedArrayInPlace(
                spokeSession.transcripts,
                R.clone(transcript),
            )
        } catch (e) {
            console.error('[uploadEditorTasks] error posting editor', e)
        }
    }
}
const insertIntoSortedArrayInPlace = (arr: Transcript[], value: Transcript) => {
    // Find the correct index using a binary search-like approach
    const index =
        R.findIndex((item) => value.start_time < item.start_time, arr) - 1

    // If index is -1, the value is greater than all elements in the array, so push it at the end
    // Otherwise, splice the array to insert the value at the found index, modifying the original array
    if (index < 0) {
        arr.push(value)
    } else {
        arr.splice(index, 0, value)
    }

    // No return needed since the operation is in-place
}

function createTranscript(
    bot_id: number,
    speaker: SpeakerInterval,
): PostableTranscript {
    const transcript = {
        bot_id,
        speaker: speaker.speaker ?? '',
        //TODO: get language from Gladia / runpod
        lang: 'en-US',
        start_time: speaker.start_time,
        end_time: speaker.end_time,
    }
    return transcript
}

function timestampToInterval(speakers: SpeakerData[]): SpeakerInterval[] {
    const intervals = speakers.map((speaker, index) => {
        // For the last speaker, we might want to set a specific end timestamp.
        // Here, we're simply using the next hour as an example.
        const endTimestamp =
            index < speakers.length - 1
                ? speakers[index + 1].timestamp
                : speaker.timestamp + 3600000

        return {
            start_time: speaker.timestamp - START_RECORD_TIMESTAMP,
            end_time: endTimestamp - START_RECORD_TIMESTAMP,
            speaker: speaker.name,
        }
    })
    intervals.pop()

    return intervals
}
