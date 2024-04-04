import axios from 'axios'
import { MeetingParams } from './types'

export async function patchEvent(payload: any) {
    console.log('patching event payload: ', { payload })
    return (
        await axios({
            method: 'PATCH',
            url: `/calendar/event`,
            data: payload,
        })
    ).data
}

export async function notify(payload: any) {
    return (
        await axios({
            method: 'POST',
            url: `/notification/broadcast`,
            data: payload,
        })
    ).data
}

export async function notifyApp(
    status: 'PrepareRecording' | 'Error' | 'Recording' | 'EndRecording',
    data: MeetingParams,
    event: any,
    payload: any,
) {
    if (event != null) {
        try {
            const eventStatus = status === 'EndRecording' ? 'None' : status
            if (data.event?.id != null) {
                await patchEvent({
                    status: eventStatus,
                    id: data.event?.id,
                    ...event,
                })
            }
        } catch (e) {
            console.error('error patching event: ', e)
        }
    }
    try {
        await notify({
            message: status,
            user_id: data.user_id,
            payload,
        })
    } catch (e) {
        console.error('error notifying: ', e)
    }
}
