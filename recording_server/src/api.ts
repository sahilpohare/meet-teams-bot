import axios from 'axios'
import { MeetingParams } from './types'

// Finalize bot structure into BDD and send webhook
export async function endMeetingTrampoline(meeting_params: MeetingParams) {
    const resp = await axios({
        method: 'POST',
        url: `${process.env.API_SERVER_BASEURL}/bots/end_meeting_trampoline`,
        timeout: 60_000, // ms (1 minute)
        headers: {
            'Authorization': meeting_params.user_token,
            'x-meeting-baas-api-key': meeting_params.bots_api_key,
        },
        data: {
            bot_uuid: meeting_params.bot_uuid,
        },
    })
    return resp.data
}
