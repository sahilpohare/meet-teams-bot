//! IMPORTANT : That file contains a lot of server dependencies.

import axios from 'axios'
import { PostableTranscript, RecognizerWord, Word } from './types'

export type ExtractPreview = {
    s3_path: string
}

export async function endMeetingTrampoline(bot_id?: string) {
    const resp = await axios({
        params: {
            bot_id,
        },
        raxConfig: {
            retry: 0,
        },
        method: 'POST',
        url: '/bots/end_meeting_trampoline',
        timeout: 600000,
    })
    return resp.data
}

export async function getBot(bot_id: string) {
    return (
        await axios({
            method: 'GET',
            url: `/bots/${bot_id}`,
        })
    ).data
}

export async function postWords(
    words: RecognizerWord[],
    transcript_id: number,
): Promise<Word[]> {
    return (
        await axios({
            method: 'POST',
            url: `/bots/transcripts/${transcript_id}/words`,
            data: words,
        })
    ).data
}

export async function postTranscript(transcript: PostableTranscript) {
    return (
        await axios({
            method: 'POST',
            url: `/bots/transcripts`,
            data: transcript,
        })
    ).data
}
