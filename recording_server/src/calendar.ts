import { MeetingParams } from './meeting'
import { API_SERVER_BASEURL } from './instance'
import axios from 'axios'

export async function patchEvent(user_token: string, payload: any) {
    console.log('patching event payload: ', { payload })
    return (await axios({
        method: 'PATCH',
        url: `${API_SERVER_BASEURL}/calendar/event`,
        data: payload,
        headers: {
            'Authorization': user_token
        }
    })).data
}

async function notify(user_token: string, payload: any) {
    return (await axios({
        method: 'POST',
        url: `${API_SERVER_BASEURL}/notification/broadcast`,
        data: payload,
        headers: {
            'Authorization': user_token
        }
    })).data
}

export async function notifyApp(status: "PrepareRecording" | "Error" | "Recording" | "EndRecording", data: MeetingParams, event: any, payload: any) {
    if (event != null) {
        try {
            const eventStatus = status === 'EndRecording' ? 'None' : status
            await patchEvent(data.user_token, { status: eventStatus, id: data.event?.id, ...event })
        } catch (e) {
            console.error('error patching event: ', e)
        }
    }
    try {
        await notify(data.user_token, { message: status, user_id: data.user_id, payload })
    } catch (e) {
        console.error('error notifying: ', e)
    }
}
