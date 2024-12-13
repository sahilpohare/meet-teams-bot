import {
    API_SERVER_BASEURL,
    LOCK_INSTANCE_AT_STARTUP,
    delSessionInRedis,
    terminateInstance,
} from './instance'
import { JoinError, JoinErrorCode, MeetingHandle } from './meeting'
import { getCachedExtensionId, getExtensionId, openBrowser } from './puppeteer'
import { clientRedis, server } from './server'

import axios from 'axios'
import { exit } from 'process'
import { generateBranding } from './branding'
import { Consumer } from './rabbitmq'
import { TRANSCODER } from './transcoder'
import { MeetingParams } from './types'
import { endMeetingTrampoline } from './api'

const originalError = console.error
console.error = (...args: any[]) => {
    originalError('\x1b[31m%s\x1b[0m', ...args)
}

// ENTRY POINT
// syntax convention
// minus => Library
// CONST => Const
// camelCase => Fn
// PascalCase => Classes
console.log('version 0.0.1')
;(async () => {
    if (process.argv[2]?.includes('get_extension_id')) {
        getExtensionId().then((x) => console.log(x))
    } else {
        // set default axios config
        axios.defaults.baseURL = API_SERVER_BASEURL
        axios.defaults.withCredentials = true

        // trigger system cache in order to decrease latency when first bot come
        await triggerCache().catch((e) => {
            console.error(`Failed to trigger cache: ${e}`)
            throw e
        })

        await clientRedis.connect().catch((e) => {
            console.error(`Fail to connect to redis: ${e}`)
            throw e
        })

        await server().catch((e) => {
            console.error(`Fail to start server: ${e}`)
            throw e
        })
        console.log('Server started succesfully')

        const consumer = await Consumer.init().catch((e) => {
            console.error(`Fail to init consumer: ${e}`)
            throw e
        })

        console.log('start consuming rabbitmq messages')
        let consumeResult: {
            params: MeetingParams
            error: Error
        }
        try {
            consumeResult = await consumer.consume(Consumer.handleStartRecord)
        } catch (e) {
            if (LOCK_INSTANCE_AT_STARTUP) {
                await consumer.deleteQueue().catch((e) => {
                    console.error('fail to delete queue', e)
                })
                throw e
            }
        }

        if (consumeResult.error) {
            // Assuming Recording does not start at this point
            // So there are not video to upload. Just send webhook failure
            console.error('error in start meeting', consumeResult.error)
            await handleErrorInStartRecording(
                consumeResult.error,
                consumeResult.params,
            ).catch((e) => {
                console.error('error in handleErrorInStartRecording', e)
            })
        } else {
            // Assuming that recording is active at this point
            let meeting_succesful = await MeetingHandle.instance
                .recordMeetingToEnd()
                .catch((e) => {
                    console.error('record meeting to end failed: ', e)
                    return false
                })
                .then((_) => {
                    return true
                })
            // Stop transcoder even if the meeting ended with an error
            // to have a video uploaded to s3 even in case there is a crash
            await TRANSCODER.stop().catch((e) => {
                console.error('error when stopping transcoder: ', e)
            })
            console.log(`${Date.now()} Uploading video to S3`)
            await TRANSCODER.uploadVideoToS3().catch((e) => {
                console.error('Cannot upload video to S3: ', e)
            })
            if (meeting_succesful) {
                console.log(
                    `${Date.now()} Finalize project && Sending WebHook complete`,
                )
                await endMeetingTrampoline(consumeResult.params.bot_uuid).catch(
                    (e) => {
                        console.error('error in endMeetingTranpoline', e)
                    },
                )
            }
        }

        await delSessionInRedis(consumeResult.params.session_id).catch((e) => {
            console.error('fail delete session in redis: ', e)
        })

        if (LOCK_INSTANCE_AT_STARTUP) {
            await consumer.deleteQueue().catch((e) => {
                console.error('fail to delete queue', e)
            })
            await terminateInstance().catch((e) => {
                console.error('fail to terminate instance', e)
            })
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
            data.bot_uuid,
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
    bot_uuid: string,
    message: string,
): Promise<void> {
    let meetingParams = {
        meeting_url: meetingLink,
        message,
    }
    await axios({
        method: 'POST',
        url: `/bots/start_record_failed`,
        data: meetingParams,
        params: { bot_uuid },
    })
}

/// open the browser a first time to speed up the next openings
async function triggerCache() {
    const extensionId = await getCachedExtensionId()
    const [chrome, chromium] = await Promise.all([
        openBrowser(extensionId, false, false),
        openBrowser(extensionId, true, false),
        generateBranding('cache').wait,
    ])
    await chrome.browser.close()
    await chromium.browser.close()
}
