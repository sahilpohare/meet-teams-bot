import { getExtensionId } from './puppeteer'
import { server, LOGGER } from './server'
import { generateBranding } from './branding'
import { recordMeetingToEnd } from './meeting'
import { summarize } from './test_summarize'
import { getCachedExtensionId, openBrowser } from './puppeteer'
import { Consumer } from './rabbitmq'
import { LOCK_INSTANCE_AT_STARTUP, terminateInstance } from './instance'
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

        const consumer: Consumer = await Consumer.init()
        while (true) {
            const meetingParams = await consumer.consume(
                Consumer.handleStartRecord,
            )
            console.log('params', meetingParams)
            await recordMeetingToEnd()

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
