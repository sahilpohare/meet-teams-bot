import { getExtensionId } from './puppeteer'
import { server, LOGGER, clientRedis } from './server'
import { generateBranding } from './branding'
import { CURRENT_MEETING, MeetingParams, recordMeetingToEnd } from './meeting'
import { getCachedExtensionId, openBrowser } from './puppeteer'
import { Consumer } from './rabbitmq'
import { api, setConfig, setDefaultAxios } from 'spoke_api_js'
import axios from 'axios'
import {
    API_SERVER_BASEURL,
    LOCK_INSTANCE_AT_STARTUP,
    POD_IP,
    delSessionInRedis,
    setSessionInRedis,
    terminateInstance,
} from './instance'
import { sleep } from './utils'
import { notifyApp } from './calendar'
import { exit } from 'process'
;(async () => {
    if (process.argv[2]?.includes('get_extension_id')) {
        getExtensionId().then((x) => console.log(x))
    } else {
        // set default axios config
        axios.defaults.baseURL = API_SERVER_BASEURL
        setConfig({
            defaultUrl: API_SERVER_BASEURL,
            logError: () => {},
        })
        try {
            await triggerCache()
        } catch (e) {
            LOGGER.error(`Failed to trigger cache: ${e}`)
        }

        try {
            await clientRedis.connect()
        } catch (e) {
            console.error('fail to connect to redis: ', e)
        }

        await server()
        console.log('after server started')

        const consumer: Consumer = await Consumer.init()
        console.log('start consuming rabbitmq messages')
        const { params, error } = await consumer.consume(
            Consumer.handleStartRecord,
        )

        let meetingSession = {
            bot_ip: POD_IP,
            user_id: params.user_id,
            meeting_url: params.meeting_url,
        }
        try {
            await setSessionInRedis(params.session_id, meetingSession)
        } catch (e) {
            console.error('fail to set session in redis: ', e)
        }
        if (error) {
            console.error('error in start meeting', error)
            await handleErrorInStartRecording(error, params)
        } else {
            try {
                await recordMeetingToEnd()
            } catch (e) {
                console.error('record meeting to end failed: ', e)
            }
        }
        console.log('sleeping to let api server make status requests')
        // sleep 30 secs to let api server make status requests
        await sleep(30000)
        try {
            await delSessionInRedis(params.session_id)
        } catch (e) {
            console.error('fail delete session in redis: ', e)
        }
        if (LOCK_INSTANCE_AT_STARTUP) {
            await terminateInstance()
        }
        exit(0)
    }
})()

async function handleErrorInStartRecording(e: any, data: MeetingParams) {
    CURRENT_MEETING.error = e
    try {
        await notifyApp(
            'Error',
            data,
            { error: JSON.stringify(e) },
            { error: JSON.stringify(e) },
        )
        await api.meetingBotStartRecordFailed(data.meeting_url, data.event?.id)
    } catch (e) {
        console.error(
            `error in handleErrorInStartRecording, terminating instance`,
            e,
        )
    }
}
/// open the browser a first time to speed up the next openings
async function triggerCache() {
    const extensionId = await getCachedExtensionId()
    const [browser] = await Promise.all([
        openBrowser(extensionId),
        generateBranding('cache').wait,
    ])
    await browser.close()
}
