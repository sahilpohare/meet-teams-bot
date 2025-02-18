import { Api } from './api/methods'
import { ApiTypes } from './api/types'

import { SpeakerData } from './types'

import { START_RECORDING_TIMESTAMP } from './meeting'

import * as asyncLib from 'async'

var LAST_TRANSRIPT: ApiTypes.QueryableTranscript | null = null
var TRANSCIBER_STOPED: boolean = false
var TRANSCRIPT_QUEUE = newTranscriptQueue()

function newTranscriptQueue() {
    return asyncLib.queue(async function (
        task: () => Promise<void>,
        done: any,
    ) {
        await task()
        done()
    }, 1) // One operation at the same time
}

// IMPORTANT : For reasons of current compatibility, this function is only called
// with a single speaker and not an array of multiple speakers. Handling multiple
// speakers should be implemented at some point.
export async function uploadTranscriptTask(
    speaker: SpeakerData,
    end: boolean,
): Promise<void> {
    return new Promise((resolve, reject) => {
        TRANSCRIPT_QUEUE.push(async () => {
            try {
                await upload(speaker, end)
                resolve()
            } catch (error) {
                reject(error)
            }
        })
    })
}

async function upload(speaker: SpeakerData, end: boolean) {
    if (TRANSCIBER_STOPED) {
        console.info('Transcriber is stoped')
        return
    }
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
        TRANSCIBER_STOPED = true
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
