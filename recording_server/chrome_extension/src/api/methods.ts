//! IMPORTANT : That file contains a lot of server dependencies.
import axios from 'axios'
import { GetableBot, RecognizerWord, Word } from './types'

export type ExtractPreview = {
    s3_path: string
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

export async function getBot(bot_uuid: string): Promise<GetableBot> {
    return (
        await axios({
            method: 'GET',
            url: `/bots/${bot_uuid}`,
        })
    ).data
}
