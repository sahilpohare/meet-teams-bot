import { MeetingHandle } from './meeting'
import { Api } from './api/methods'
import { Events } from './events'
import { GLOBAL } from './singleton'
import { PathManager } from './utils/PathManager'
import { detectMeetingProvider } from './utils/detectMeetingProvider' //TODO: RENAME
import {
    uploadLogsToS3,
    setupExitHandler,
    setupConsoleLogger,
} from './utils/Logger'
import { server } from './server'

import { JoinError, MeetingParams } from './types'

import { exit } from 'process'

// ========================================
// CONFIGURATION
// ========================================

// Setup console logger first to ensure proper formatting
setupConsoleLogger()

// Setup crash handlers to upload logs in case of unexpected exit
setupExitHandler()

// Configuration to enable/disable DEBUG logs
export const DEBUG_LOGS =
    process.argv.includes('--debug') || process.env.DEBUG_LOGS === 'true'
if (DEBUG_LOGS) {
    console.log('🐛 DEBUG mode activated - speakers debug logs will be shown')
}

// ========================================
// UTILITY FUNCTIONS
// ========================================

/**
 * Read and parse meeting parameters from stdin
 */
async function readFromStdin(): Promise<MeetingParams> {
    return new Promise((resolve) => {
        let data = ''
        process.stdin.on('data', (chunk) => {
            data += chunk
        })

        process.stdin.on('end', () => {
            console.log('Raw data received from stdin:', JSON.stringify(data))
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

/**
 * Handle successful recording completion
 */
async function handleSuccessfulRecording(): Promise<void> {
    console.log(`${Date.now()} Finalize project && Sending WebHook complete`)

    // Log the end reason for debugging
    console.log(
        `Recording ended normally with reason: ${MeetingHandle.instance.getEndReason()}`,
    )

    // Handle API endpoint call with built-in retry logic
    if (!GLOBAL.isServerless()) {
        await Api.instance.handleEndMeetingWithRetry()
    }

    // Send success webhook
    await Events.recordingSucceeded()
}

/**
 * Handle failed recording
 */
async function handleFailedRecording(): Promise<void> {
    console.error('Recording did not complete successfully')

    // Log the end reason for debugging
    const endReason = MeetingHandle.instance.getEndReason()
    console.log(`Recording failed with reason: ${endReason || 'Unknown'}`)

    // Send failure webhook
    await Events.recordingFailed(
        String(endReason) || 'Recording did not complete successfully',
    )
}

// ========================================
// MAIN ENTRY POINT
// ========================================

/**
 * Main application entry point
 *
 * Syntax conventions:
 * - minus => Library
 * - CONST => Const
 * - camelCase => Fn
 * - PascalCase => Classes
 */
;(async () => {
    const meetingParams = await readFromStdin()

    try {
        // Log all meeting parameters (masking sensitive data)
        const logParams = { ...meetingParams }

        // Mask sensitive data for security
        if (logParams.secret) logParams.secret = '***MASKED***'
        if (logParams.user_token) logParams.user_token = '***MASKED***'
        if (logParams.bots_api_key) logParams.bots_api_key = '***MASKED***'
        if (logParams.speech_to_text_api_key)
            logParams.speech_to_text_api_key = '***MASKED***'
        if (logParams.zoom_sdk_pwd) logParams.zoom_sdk_pwd = '***MASKED***'

        console.log(
            'Received meeting parameters:',
            JSON.stringify(logParams, null, 2),
        )

        console.log('About to redirect logs to bot:', meetingParams.bot_uuid)
        console.log('Logs redirected successfully')

        // Start the server
        await server().catch((e) => {
            console.error(`Failed to start server: ${e}`)
            throw e
        })
        console.log('Server started successfully')

        // Initialize components
        MeetingHandle.init()
        Events.init()
        Events.joiningCall()

        // Create API instance for non-serverless mode
        if (!GLOBAL.isServerless()) {
            new Api()
        }

        // Start the meeting recording
        await MeetingHandle.instance.startRecordMeeting()

        // Handle recording result
        if (MeetingHandle.instance.wasRecordingSuccessful()) {
            await handleSuccessfulRecording()
        } else {
            await handleFailedRecording()
        }
    } catch (error) {
        // Handle explicit errors from state machine
        console.error('Meeting failed:', error)

        const errorMessage =
            error instanceof JoinError
                ? error.message
                : 'Recording failed to complete'

        await Events.recordingFailed(errorMessage)
    } finally {
        if (!GLOBAL.isServerless()) {
            try {
                await uploadLogsToS3({})
            } catch (error) {
                console.error('Failed to upload logs to S3:', error)
            }
        }
        console.log('exiting instance')
        exit(0)
    }
})()
