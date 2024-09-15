import axios from 'axios'

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
