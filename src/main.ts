import { MeetingHandle } from './meeting'

import axios from 'axios'
import { exit } from 'process'
import { Api } from './api/methods'
import { detectMeetingProvider } from './utils/detectMeetingProvider' //TODO: RENAME 
import {
    JoinError,
    JoinErrorCode,
    MeetingParams,
} from './types'

import { Events } from './events'
import { RecordingEndReason } from './state-machine/types'
import {

    uploadLogsToS3,
} from './utils/Logger'
import { GLOBAL } from './singleton'
import { PathManager } from './utils/PathManager'

// Configuration pour activer/désactiver l'enregistrement
export const RECORDING = process.env.RECORDING === 'true' // Par défaut false, true si RECORDING=true

// Configuration pour activer/désactiver les logs DEBUG
export const DEBUG_LOGS = process.argv.includes('--debug') || process.env.DEBUG_LOGS === 'true'
if (DEBUG_LOGS) {
    console.log('🐛 DEBUG mode activated - speakers debug logs will be shown')
}


// Helper function to read data from stdin (for serverless mode)
async function readFromStdin(): Promise<MeetingParams> {
    return new Promise((resolve) => {
        let data = ''
        process.stdin.on('data', (chunk) => {
            data += chunk
        })

        process.stdin.on('end', () => {
            console.log('Raw data received from stdin:', JSON.stringify(data));
            try {
                const params = JSON.parse(data) as MeetingParams
                // Detect the meeting provider
                params.meetingProvider = detectMeetingProvider(
                    params.meeting_url,
                )
                GLOBAL.set(params)
                PathManager.getInstance().initializePaths()
                resolve(params)
            } catch (error) {
                console.error('Failed to parse JSON from stdin:', error)
                console.error('Raw data was:', JSON.stringify(data))
                process.exit(1)
            }
        })
    })
}

// ENTRY POINT
// syntax convention
// minus => Library
// CONST => Const
// camelCase => Fn
// PascalCase => Classes

; (async () => {
    let isServerless: boolean = false
    const originalDirectory = process.cwd()
    const meetingParams = await readFromStdin()
    try {
        console.log(
            'Received meeting parameters:',
            JSON.stringify({
                meeting_url: meetingParams.meeting_url,
                bot_uuid: meetingParams.bot_uuid,
                bot_name: meetingParams.bot_name,
            }),
        )
        // Redirect logs to bot-specific file
        axios.defaults.baseURL = meetingParams.remote.api_server_baseurl
        axios.defaults.withCredentials = true

        isServerless = meetingParams.remote !== undefined
        console.log(
            'About to redirect logs to bot:',
            meetingParams.bot_uuid,
        )
        console.log('Logs redirected successfully')

        // In serverless mode, we need to initialize MeetingHandle ourselves
        if (isServerless) {
            // Create the API instance
            new Api()

            // Import necessary modules
            const { server } = await import('./server')
            const { Events } = await import('./events')

            // Start the server
            await server().catch((e) => {
                console.error(`Fail to start server: ${e}`)
                throw e
            })
            console.log('Server started successfully')

            // Initialize MeetingHandle with parameters
            MeetingHandle.init(meetingParams)

            // Initialize events
            Events.init(meetingParams)
            Events.joiningCall()
        }



        // Start the meeting with state machine
        await MeetingHandle.instance.startRecordMeeting()

        // Check if recording was successful and ended normally
        if (MeetingHandle.instance.wasRecordingSuccessful()) {
            console.log(
                `${Date.now()} Finalize project && Sending WebHook complete`,
            )

            // Log the end reason for debugging
            const endReason = MeetingHandle.instance.getEndReason()
            console.log(
                `Recording ended normally with reason: ${endReason}`,
            )

            // Start retry process and set a timeout
            let webhookSentForApiFailure = false
            const apiStartTime = Date.now()
            const maxApiWaitTime = 20 * 60 * 1000 // 20 minutes
            const retryDelay = 10000 // 10 seconds

            try {
                // Try to call the API
                if (isServerless) {
                    console.log(
                        'Skipping endMeetingTrampoline - serverless mode',
                    )
                } else {
                    await Api.instance.endMeetingTrampoline()
                }
                console.log(
                    'API call to endMeetingTrampoline succeeded',
                )
            } catch (apiError) {
                const elapsedSeconds =
                    (Date.now() - apiStartTime) / 1000
                const remainingSeconds =
                    Math.max(
                        0,
                        maxApiWaitTime - (Date.now() - apiStartTime),
                    ) / 1000

                console.log(
                    `API call failed after ${elapsedSeconds.toFixed(1)}s, ` +
                    `${remainingSeconds.toFixed(1)}s remaining before timeout. ` +
                    `Retrying in ${retryDelay / 1000}s...`,
                    apiError,
                )

                // Only send the webhook once if we're going to keep trying
                if (
                    !webhookSentForApiFailure &&
                    remainingSeconds < maxApiWaitTime / 1000 - 60
                ) {
                    // If we've been retrying for more than a minute, send webhook but keep trying
                    try {
                        await sendWebhookOnce({
                            meetingUrl:
                                meetingParams.meeting_url,
                            botUuid: meetingParams.bot_uuid,
                            success: true,
                            errorMessage:
                                'Recording completed successfully but having difficulty notifying API',
                        })
                        webhookSentForApiFailure = true
                        console.log(
                            'Sent webhook for successful recording while API retries continue',
                        )
                    } catch (webhookError) {
                        console.error(
                            'Failed to send interim webhook:',
                            webhookError,
                        )
                    }
                }

                // Wait before retrying
                await new Promise((resolve) =>
                    setTimeout(resolve, retryDelay),
                )
            }
        } else {
            // Recording did not reach Recording state or failed
            console.error('Recording did not complete successfully')

            // Get the specific reason for the failure
            const endReason = MeetingHandle.instance.getEndReason()
            let errorMessage

            // Check if we have a JoinError type error in the context
            const joinError =
                MeetingHandle.instance?.stateMachine?.context?.error
            if (joinError && joinError instanceof JoinError) {
                // Use the JoinError message directly
                errorMessage = joinError.message
                console.log(
                    `Found JoinError in context with code: ${errorMessage}`,
                )
            } else if (endReason) {
                // Use endReason as fallback
                errorMessage = String(endReason)
            }

            console.log(
                `Recording failed with reason: ${errorMessage || 'Unknown'}`,
            )

            // Don't call endMeetingTrampoline here
            await sendWebhookOnce({
                meetingUrl: meetingParams.meeting_url,
                botUuid: meetingParams.bot_uuid,
                success: false,
                errorMessage:
                    errorMessage ||
                    'Recording did not complete successfully',
            })
        }
    } catch (error) {
        // Explicit error propagated from state machine (error during recording)
        console.error('Meeting failed:', error)

        await sendWebhookOnce({
            meetingUrl: meetingParams.meeting_url,
            botUuid: meetingParams.bot_uuid,
            success: false,
            errorMessage:
                error instanceof JoinError
                    ? error.message
                    : 'Recording failed to complete',
        })
    }


    // Only do Redis cleanup in normal mode
    if (!isServerless) {

        // Upload logs to S3 before exiting
        try {
            // Return to the original directory before uploading logs
            if (originalDirectory) {
                console.log(
                    `Switching back to original directory: ${originalDirectory}`,
                )
                process.chdir(originalDirectory)
            }

            await uploadLogsToS3({})
        } catch (error) {
            console.error('Failed to upload logs to S3:', error)
        }
    }
    console.log('exiting instance')
    exit(0)
})()

let webhookSent = false

async function sendWebhookOnce(params: {
    meetingUrl: string
    botUuid: string
    success: boolean
    errorMessage?: string
}) {
    if (webhookSent) {
        console.log('Webhook already sent, skipping...')
        return
    }

    try {
        // Multiple attempts for webhook sending
        const maxRetries = 3
        let attempt = 0

        while (attempt < maxRetries) {
            try {
                const callEndedPromise = Events.callEnded()
                await Promise.race([
                    callEndedPromise,
                    new Promise((_, reject) =>
                        setTimeout(
                            () => reject(new Error('Call ended event timeout')),
                            30000,
                        ),
                    ),
                ])

                if (!params.success) {
                    await meetingBotStartRecordFailed(
                        params.meetingUrl,
                        params.botUuid,
                        params.errorMessage || 'Unknown error',
                        GLOBAL.isServerless()
                    )
                }

                console.log('All webhooks sent successfully')
                break
            } catch (e) {
                attempt++
                if (attempt === maxRetries) {
                    console.error('Final webhook attempt failed:', e)
                } else {
                    console.warn(
                        `Webhook attempt ${attempt} failed, retrying...`,
                    )
                    await new Promise((resolve) =>
                        setTimeout(resolve, 2000 * attempt),
                    )
                }
            }
        }
    } finally {
        webhookSent = true // Mark as sent even in case of failure
    }
}

async function handleErrorInStartRecording(error: Error, data: MeetingParams, isServerless: boolean) {
    console.log('Handling error in start recording:', {
        errorType: error.constructor.name,
        isJoinError: error instanceof JoinError,
        message: error.message,
        endReason: MeetingHandle.instance?.stateMachine?.context?.endReason,
    })

    // Utiliser le endReason du context si disponible
    const endReason = MeetingHandle.instance?.stateMachine?.context?.endReason

    let errorMessage
    if (endReason === RecordingEndReason.ApiRequest) {
        errorMessage = JoinErrorCode.ApiRequest
    } else if (error instanceof JoinError) {
        errorMessage = error.message
    } else {
        errorMessage = 'InternalError : ' + error.message
    }

    await meetingBotStartRecordFailed(
        data.meeting_url,
        data.bot_uuid,
        errorMessage,
        isServerless
    )
}

export function meetingBotStartRecordFailed(
    meetingLink: string,
    bot_uuid: string,
    message: string,
    isServerless: boolean
): Promise<void> {
    if (isServerless) {
        console.log('Notifying failed recording attempt:', {
            meetingLink,
            bot_uuid,
            message,
        })
        return Promise.resolve()
    }
    console.log('Notifying failed recording attempt:', {
        meetingLink,
        bot_uuid,
        message,
    })

    if (!Api.instance) {
        console.error('API instance not initialized')
        return Promise.reject(new Error('API instance not initialized'))
    }

    return Api.instance.notifyRecordingFailure(meetingLink, message, bot_uuid)
}