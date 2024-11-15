import { ApiTypes } from './api/types'
import { Api } from './api/methods'

import { SpeakerData } from './types'

import { START_RECORDING_TIMESTAMP } from './meeting'

var LAST_TRANSRIPT: ApiTypes.QueryableTranscript | null = null

// IMPORTANT : For reasons of current compatibility, this function is only called
// with a single speaker and not an array of multiple speakers. Handling multiple
// speakers should be implemented at some point.
export async function uploadTranscriptTask(speaker: SpeakerData, end: boolean) {
    const api = Api.instance
    if (LAST_TRANSRIPT) {
        await api
            .patchTranscript({
                id: LAST_TRANSRIPT.id,
                end_time:
                    (speaker.timestamp - START_RECORDING_TIMESTAMP.get()) /
                    1000,
            } as ApiTypes.ChangeableTranscript)
            .catch((e) => {
                console.error('Failed to patch transcript :', e)
                throw e
            })
    }
    if (end === true) {
        // Just patch the last transcript if in end
        return
    } else {
        const bot = await api.getBot().catch((e) => {
            console.error('Failed to get bot :', e)
            throw e
        })
        LAST_TRANSRIPT = await api
            .postTranscript({
                bot_id: bot.bot.id,
                speaker: speaker.name,
                start_time:
                    (speaker.timestamp - START_RECORDING_TIMESTAMP.get()) /
                    1000,
                end_time: null,
                lang: null,
            } as ApiTypes.PostableTranscript)
            .catch((e) => {
                console.error('Failed to post transcript :', e)
                throw e
            })
    }
}
