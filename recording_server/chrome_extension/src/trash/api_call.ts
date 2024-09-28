import axios from 'axios'

export async function stopBot(params: { session_id: string }) {
    try {
        const resp = await axios({
            method: 'POST',
            url: `/meeting_bot/stop_record`,
            data: params,
        })
        return resp.data
    } catch (e) {
        console.error('[stopZoom] failed to stop meeting bot session', e)
    }
}
