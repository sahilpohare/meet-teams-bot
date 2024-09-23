import axios from 'axios'
import { exit } from 'process'
import { generateBranding } from './branding'
import {
    API_SERVER_BASEURL,
    LOCK_INSTANCE_AT_STARTUP,
    delSessionInRedis,
    terminateInstance,
} from './instance'
import { JoinError, JoinErrorCode, MeetingHandle } from './meeting'
import { getCachedExtensionId, getExtensionId, openBrowser } from './puppeteer'
import { Consumer } from './rabbitmq'
import { clientRedis, server } from './server'
import { MeetingParams } from './types'
import { sleep } from './utils'

// ENTRY POINT
// syntax convention
// minus => Library
// CONST => Const
// camelCase => Fn
// CamelCase => Classes
console.log('version 0.0.1')
;(async () => {
    if (process.argv[2]?.includes('get_extension_id')) {
        getExtensionId().then((x) => console.log(x))
    } else {
        // set default axios config
        axios.defaults.baseURL = API_SERVER_BASEURL
        axios.defaults.withCredentials = true

        // trigger system cache in order to decrease latency when first bot come
        try {
            await triggerCache()
        } catch (e) {
            console.error(`Failed to trigger cache: ${e}`)
        }

        // TODO: what to do if we cant connect to redis. Dont know !
        try {
            await clientRedis.connect()
        } catch (e) {
            console.error('fail to connect to redis: ', e)
        }

        // TODO: what to do if we cant instanciate express server. Dont know !
        await server()
        console.log('after server started')

        const consumer: Consumer = await Consumer.init()
        console.log('start consuming rabbitmq messages')
        const { params, error } = await consumer.consume(
            Consumer.handleStartRecord,
        )

        if (error) {
            console.error('error in start meeting', error)
            try {
                await handleErrorInStartRecording(error, params)
            } catch (e) {
                console.error('error in handleErrorInStartRecording', e)
            }
        } else {
            try {
                await MeetingHandle.instance.recordMeetingToEnd()
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
            try {
                await consumer.deleteQueue()
            } catch (e) {
                console.error('fail to delete queue', e)
            }
            await terminateInstance(params.bot_id)
        }
        console.log('exiting instance')
        exit(0)
    }
})()

async function handleErrorInStartRecording(error: Error, data: MeetingParams) {
    if (error instanceof JoinError) {
        console.error('a join error occured while starting recording', error)
    } else {
        console.error(
            'an internal error occured while starting recording',
            error,
        )
    }
    try {
        await meetingBotStartRecordFailed(
            data.meeting_url,
            data.event?.id,
            data.bot_id,
            error instanceof JoinError ? error.message : JoinErrorCode.Internal,
        )
    } catch (e) {
        console.error(
            `error in handleErrorInStartRecording, terminating instance`,
            e,
        )
    }
}

export async function meetingBotStartRecordFailed(
    meetingLink: string,
    eventId?: number,
    bot_id?: string,
    message?: string,
): Promise<void> {
    let meetingParams = {
        meeting_url: meetingLink,
        event_id: eventId,
        message,
    }
    await axios({
        method: 'POST',
        url: `/meeting_bot/start_record_failed`,
        data: meetingParams,
        params: { bot_id },
    })
}

/// open the browser a first time to speed up the next openings
async function triggerCache() {
    const extensionId = await getCachedExtensionId()
    const [browser] = await Promise.all([
        openBrowser(extensionId),
        generateBranding('cache').wait,
    ])
    await browser.browser.close()
}
