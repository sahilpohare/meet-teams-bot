//! IMPORTANT : That file contains a lot of server dependencies.

import axios from 'axios'
import {
    ChangeableTranscript,
    GetableBot,
    PostableTranscript,
    QueryableTranscript,
    RecognizerWord,
    Word,
} from './types'

export type ExtractPreview = {
    s3_path: string
}

export async function endMeetingTrampoline(bot_uuid: string) {
    const resp = await axios({
        params: {
            bot_uuid,
        },
        raxConfig: {
            retry: 0,
        },
        method: 'POST',
        url: '/v1/speech/end_meeting_trampoline',
        timeout: 600000,
    })
    return resp.data
}

export async function getBot(bot_uuid: string): Promise<GetableBot> {
    return (
        await axios({
            method: 'GET',
            url: `/bots/${bot_uuid}`,
        })
    ).data
}

export async function postWords(
    words: RecognizerWord[],
    bot_id: number,
): Promise<Word[]> {
    return (
        await axios({
            method: 'POST',
            url: `/bots/transcripts/${bot_id}/words`,
            data: words,
        })
    ).data
}

export async function postTranscript(
    transcript: PostableTranscript,
): Promise<QueryableTranscript> {
    return (
        await axios({
            method: 'POST',
            url: `/bots/transcripts`,
            data: transcript,
        })
    ).data
}

export async function patchTranscript(
    transcript: ChangeableTranscript,
): Promise<QueryableTranscript> {
    return (
        await axios({
            method: 'PATCH',
            url: `/bots/transcripts`,
            data: transcript,
        })
    ).data
}
