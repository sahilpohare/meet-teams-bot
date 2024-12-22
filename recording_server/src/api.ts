import axios from 'axios'
import { MeetingParams } from './types'

// Finalize bot structure into BDD and send webhook
export async function endMeetingTrampoline(bot_uuid: string) {
    const resp = await axios({
        method: 'POST',
        url: `${process.env.API_SERVER_BASEURL}/bots/end_meeting_trampoline`,
        timeout: 60_000, // ms (1 minute)
        params: {
            bot_uuid,
        },
        data: {
            diarization_v2: false,
        },
    })
    return resp.data
}
