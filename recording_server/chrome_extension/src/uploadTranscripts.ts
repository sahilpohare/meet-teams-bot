import {
    ChangeableTranscript,
    QueryableTranscript,
    PostableTranscript,
    api,
} from './api'
import { parameters } from './background'
import { SpeakerData } from './observeSpeakers'
import { START_RECORD_TIMESTAMP } from './record'

var LAST_TRANSRIPT: QueryableTranscript | null = null

export async function uploadTranscriptTask(speaker: SpeakerData, end: boolean) {
    if (LAST_TRANSRIPT) {
        await api
            .patchTranscript({
                id: LAST_TRANSRIPT.id,
                end_time: (speaker.timestamp - START_RECORD_TIMESTAMP) / 1000,
            } as ChangeableTranscript)
            .catch((e) => {
                console.error('Failed to patch transcript :', e)
                throw e
            })
    }
    if (end === true) {
        // Just patch the last transcript if in end
        return
    } else {
        const bot = await api.getBot(parameters.bot_uuid).catch((e) => {
            console.error('Failed to get bot :', e)
            throw e
        })
        LAST_TRANSRIPT = await api
            .postTranscript({
                bot_id: bot.bot.id,
                speaker: speaker.name,
                start_time: (speaker.timestamp - START_RECORD_TIMESTAMP) / 1000,
                end_time: null,
                lang: null,
            } as PostableTranscript)
            .catch((e) => {
                console.error('Failed to post transcript :', e)
                throw e
            })
    }
}
