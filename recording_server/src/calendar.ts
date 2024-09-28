//! IMPORTANT : That file contains some server dependencies.

import axios from 'axios'

async function patchEvent(payload: any) {
    console.log('patching event payload: ', { payload })
    return (
        await axios({
            method: 'PATCH',
            url: `/calendar/event`,
            data: payload,
        })
    ).data
}
