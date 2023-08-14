import { getExtensionId } from './puppeteer'
import { server, LOGGER } from './server'
import { generateBranding } from './branding'
import { recordMeetingToEnd } from './meeting'
import { summarize } from './test_summarize'
import { getCachedExtensionId, openBrowser } from './puppeteer'
import { Consumer } from './rabbitmq'
import {
    LOCK_INSTANCE_AT_STARTUP,
    POD_IP,
    delSessionInRedis,
    setSessionInRedis,
    terminateInstance,
} from './instance'
import { sleep } from './utils'
;(async () => {
    if (process.argv[2]?.includes('get_extension_id')) {
        getExtensionId().then((x) => console.log(x))
    } else {
        try {
            await triggerCache()
        } catch (e) {
            LOGGER.error(`Failed to trigger cache: ${e}`)
        }

        await server()
        console.log('after server started')

        const consumer: Consumer = await Consumer.init()
        while (true) {
            console.log('start consuming rabbitmq messages')
            const data = await consumer.consume(Consumer.handleStartRecord)
            let meetingSession = {
                bot_ip: POD_IP,
                user_id: data.user_id,
                meeting_url: data.meeting_url,
            }
            console.log('recording started with params', data, meetingSession)
            try {
                await setSessionInRedis(data.session_id, meetingSession)
            } catch (e) {
                console.error('fail to set session in redis: ', e)
            }
            await recordMeetingToEnd()
            console.log(
                'meeting record done deleting session in redis',
                meetingSession,
            )

            try {
                await delSessionInRedis(data.session_id)
            } catch (e) {
                console.error('fail delete session in redis: ', e)
            }
            if (LOCK_INSTANCE_AT_STARTUP) {
                await sleep(30000)
                await terminateInstance()
            }
        }
    }
})()

/// open the browser a first time to speed up the next openings
async function triggerCache() {
    const extensionId = await getCachedExtensionId()
    const [browser] = await Promise.all([
        openBrowser(extensionId),
        generateBranding('cache').wait,
    ])
    await browser.close()
}
