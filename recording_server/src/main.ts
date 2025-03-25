import {
    API_SERVER_BASEURL,
    LOCK_INSTANCE_AT_STARTUP,
    delSessionInRedis,
    terminateInstance,
} from './instance'
import { MeetingHandle } from './meeting'

import { clientRedis } from './server'

import axios from 'axios'
import { exit } from 'process'
// import { generateBranding } from './branding'
import { Api } from './api/methods'
import { Consumer } from './rabbitmq'
import { JoinError, JoinErrorCode, MeetingParams } from './types'

import { spawn } from 'child_process'
import { Events } from './events'
import { RecordingEndReason } from './state-machine/types'
import {
    logger,
    setupConsoleLogger,
    setupExitHandler,
} from './utils/pinoLogger'

const ZOOM_SDK_DEBUG_EXECUTABLE_PATHNAME = './target/debug/client'
const ZOOM_SDK_RELEASE_EXECUTABLE_PATHNAME = './target/release/client'
const ZOOM_SDK_LIBRARY_PATH = './zoom-sdk-linux-rs/zoom-meeting-sdk-linux'
const ZOOM_SDK_RELATIVE_DIRECTORY = '../zoom'

// Setup initial console logging
setupConsoleLogger()

// Setup exit handler for proper log file cleanup
setupExitHandler()

// Add a constant for the maximum meeting duration (5 hours in milliseconds)
const MAX_INSTANCE_DURATION_AFTER_RABBIT_MESSAGE_RECIEVED_MS =
    5 * 60 * 60 * 1000 // 5 hours
let forceTerminationTimeout: NodeJS.Timeout | null = null

// ENTRY POINT
// syntax convention
// minus => Library
// CONST => Const
// camelCase => Fn
// PascalCase => Classes

;(async () => {
    // set default axios config
    axios.defaults.baseURL = API_SERVER_BASEURL
    axios.defaults.withCredentials = true

    let environ: string = process.env.ENVIRON

    console.log('Before REDIS.connect()')
    await clientRedis.connect().catch((e) => {
        console.error(`Fail to connect to redis: ${e}`)
        throw e
    })

    console.log('Before RABBIT.connect()')
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
        console.error(
            'error in start meeting:',
            consumeResult.error instanceof JoinError
                ? consumeResult.error.message
                : consumeResult.error,
        )

        await handleErrorInStartRecording(
            consumeResult.error,
            consumeResult.params,
        ).catch((e) => {
            console.error(
                'error in handleErrorInStartRecording:',
                e instanceof JoinError ? e.message : e,
            )
        })
    } else if (consumeResult.params.meetingProvider !== 'Zoom') {
        // Assuming that recording is active at this point
        try {
            // Démarrer le meeting avec la machine à états
            await MeetingHandle.instance.startRecordMeeting()

            // Vérifier si l'enregistrement a réussi et s'est terminé normalement
            if (MeetingHandle.instance.wasRecordingSuccessful()) {
                console.log(
                    `${Date.now()} Finalize project && Sending WebHook complete`,
                )
                
                // Enregistrer la raison de fin pour le logging
                const endReason = MeetingHandle.instance.getEndReason();
                console.log(`Recording ended normally with reason: ${endReason}`);
                
                // Start retry process and set a timeout
                let webhookSentForApiFailure = false;
                const apiStartTime = Date.now();
                const maxApiWaitTime = 20 * 60 * 1000; // 20 minutes
                const retryDelay = 10000; // 10 seconds
                
                // Keep retrying until we succeed or time runs out
                while (Date.now() - apiStartTime < maxApiWaitTime) {
                    try {
                        // Try to call the API
                        await Api.instance.endMeetingTrampoline();
                        console.log('API call to endMeetingTrampoline succeeded');
                        break; // Success! Exit the loop
                    } catch (apiError) {
                        const elapsedSeconds = (Date.now() - apiStartTime) / 1000;
                        const remainingSeconds = Math.max(0, maxApiWaitTime - (Date.now() - apiStartTime)) / 1000;
                        
                        console.log(
                            `API call failed after ${elapsedSeconds.toFixed(1)}s, ` +
                            `${remainingSeconds.toFixed(1)}s remaining before timeout. ` +
                            `Retrying in ${retryDelay/1000}s...`, 
                            apiError
                        );
                        
                        // Only send the webhook once if we're going to keep trying
                        if (!webhookSentForApiFailure && remainingSeconds < maxApiWaitTime/1000 - 60) {
                            // If we've been retrying for more than a minute, send webhook but keep trying
                            try {
                                await sendWebhookOnce({
                                    meetingUrl: consumeResult.params.meeting_url,
                                    botUuid: consumeResult.params.bot_uuid,
                                    success: true,
                                    errorMessage: 'Recording completed successfully but having difficulty notifying API'
                                });
                                webhookSentForApiFailure = true;
                                console.log('Sent webhook for successful recording while API retries continue');
                            } catch (webhookError) {
                                console.error('Failed to send interim webhook:', webhookError);
                            }
                        }
                        
                        // Wait before retrying
                        await new Promise(resolve => setTimeout(resolve, retryDelay));
                    }
                }
                
                // If we exited the loop without breaking, it means we timed out
                if (Date.now() - apiStartTime >= maxApiWaitTime) {
                    console.error('API call failed after 20 minutes of retries');
                    
                    // Send final webhook if we haven't already
                    if (!webhookSentForApiFailure) {
                        await sendWebhookOnce({
                            meetingUrl: consumeResult.params.meeting_url,
                            botUuid: consumeResult.params.bot_uuid,
                            success: true,
                            errorMessage: 'Recording completed successfully but API notification failed after 20 minutes'
                        });
                    }
                }
            } else {
                // L'enregistrement n'a pas atteint l'état Recording ou a échoué
                console.error('Recording did not complete successfully');
                
                // Récupérer la raison spécifique de l'échec
                const endReason = MeetingHandle.instance.getEndReason();
                console.log(`Recording failed with reason: ${endReason}`);
                
                // On n'appelle pas endMeetingTrampoline ici
                await sendWebhookOnce({
                    meetingUrl: consumeResult.params.meeting_url,
                    botUuid: consumeResult.params.bot_uuid,
                    success: false,
                    errorMessage: endReason || 'Recording did not complete successfully'
                });
            }
        } catch (error) {
            // Erreur explicite propagée depuis la machine à états (erreur durant l'enregistrement)
            console.error('Meeting failed:', error)
            
            await sendWebhookOnce({
                meetingUrl: consumeResult.params.meeting_url,
                botUuid: consumeResult.params.bot_uuid,
                success: false,
                errorMessage:
                    error instanceof JoinError
                        ? error.message
                        : 'Recording failed to complete',
            })
        }
    } else {
        // Configuring and launching LINUX ZOOM SDK
        console.log('Current Directory :', process.cwd())
        process.chdir(ZOOM_SDK_RELATIVE_DIRECTORY)
        console.log('Switching to :', process.cwd())

        const libraryPath = ZOOM_SDK_LIBRARY_PATH
        process.env.LD_LIBRARY_PATH = `${libraryPath}:${process.env.LD_LIBRARY_PATH || ''}`
        console.log(
            'LD_LIBRARY_PATH :',
            process.env.LD_LIBRARY_PATH || 'Undefined',
        )

        async function runClient(params: MeetingParams) {
            try {
                console.log('Executing client...')

                const clientProcess = spawn(
                    environ === 'local'
                        ? ZOOM_SDK_DEBUG_EXECUTABLE_PATHNAME
                        : ZOOM_SDK_RELEASE_EXECUTABLE_PATHNAME,
                    process.argv[2]?.includes('--zoom-no-recursive-env')
                        ? ['--no-recursive-env', '--pulse']
                        : ['--pulse'],
                    {
                        env: process.env,
                        stdio: ['pipe', 'inherit', 'inherit'],
                    },
                )

                clientProcess.stdin?.write(JSON.stringify(params))
                clientProcess.stdin?.end()

                const exitCode = await new Promise<number>(
                    (resolve, reject) => {
                        clientProcess.on('close', resolve)
                        clientProcess.on('error', reject)
                    },
                )

                console.log(`Process terminated with code: ${exitCode}`)
            } catch (error) {
                console.error('Error while loading Zoom: ', error)
            }
        }
        try {
            await runClient(consumeResult.params)
        } catch (e) {
            // Add handling for Zoom client errors
            console.error(`Promise rejected : ${e}`)
            await sendWebhookOnce({
                meetingUrl: consumeResult.params.meeting_url,
                botUuid: consumeResult.params.bot_uuid,
                success: false,
                errorMessage: 'Zoom client error',
            })
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
        // Tentatives multiples pour l'envoi du webhook
        const maxRetries = 3
        let attempt = 0
        
        while (attempt < maxRetries) {
            try {
                const callEndedPromise = Events.callEnded()
                await Promise.race([
                    callEndedPromise,
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error('Call ended event timeout')), 30000)
                    )
                ])
                
                if (!params.success) {
                    await meetingBotStartRecordFailed(
                        params.meetingUrl,
                        params.botUuid,
                        params.errorMessage || 'Unknown error'
                    )
                }
                
                console.log('All webhooks sent successfully')
                break
            } catch (e) {
                attempt++
                if (attempt === maxRetries) {
                    console.error('Final webhook attempt failed:', e)
                } else {
                    console.warn(`Webhook attempt ${attempt} failed, retrying...`)
                    await new Promise(resolve => setTimeout(resolve, 2000 * attempt))
                }
            }
        }
    } finally {
        webhookSent = true // Marquer comme envoyé même en cas d'échec
    }
}

async function handleErrorInStartRecording(error: Error, data: MeetingParams) {
    console.log('Handling error in start recording:', {
        errorType: error.constructor.name,
        isJoinError: error instanceof JoinError,
        message: error.message,
        endReason: MeetingHandle.instance?.stateMachine?.context?.endReason
    });
    
    // Utiliser le endReason du context si disponible
    const endReason = MeetingHandle.instance?.stateMachine?.context?.endReason;
    
    let errorMessage;
    if (endReason === RecordingEndReason.ApiRequest) {
        errorMessage = JoinErrorCode.ApiRequest;
    } else if (error instanceof JoinError) {
        errorMessage = error.message;
    } else {
        errorMessage = JoinErrorCode.Internal;
    }
    
    await meetingBotStartRecordFailed(
        data.meeting_url,
        data.bot_uuid,
        errorMessage
    );
}

export function meetingBotStartRecordFailed(
    meetingLink: string,
    bot_uuid: string,
    message: string,
): Promise<void> {
    console.log('Notifying failed recording attempt:', {
        meetingLink,
        bot_uuid,
        message,
    })

    return axios({
        method: 'POST',
        url: `/bots/start_record_failed`,
        timeout: 10000,
        data: { meeting_url: meetingLink, message },
        params: { bot_uuid },
    })
        .then(() => {
            console.log('Successfully notified backend of recording failure')
        })
        .catch((error) => {
            console.error('Failed to notify recording failure:', error.message)
            // Rethrow the error to ensure the promise is rejected
            throw error
        })
}

// Add this function to set up the force termination timer
export function setupForceTermination() {
    // Clear any existing timeout
    if (forceTerminationTimeout) {
        clearTimeout(forceTerminationTimeout)
    }

    // Set up new timeout
    forceTerminationTimeout = setTimeout(() => {
        logger.warn(
            `Force terminating instance after ${MAX_INSTANCE_DURATION_AFTER_RABBIT_MESSAGE_RECIEVED_MS / 1000 / 60 / 60} hours for safety`,
        )

        try {
            // Log the forced termination
            logger.error(
                'CRITICAL: Forcing immediate process termination after timeout',
            )

            // Use process.kill with SIGKILL for immediate termination
            process.kill(process.pid, 'SIGKILL')
        } catch (e) {
            // This should never execute with SIGKILL, but just in case
            logger.error(
                'Failed to terminate with SIGKILL, using alternative method',
            )

            // As a last resort, use exit code 9 (same as SIGKILL)
            process.exit(9)
        }

        // This line should never be reached, but as an absolute fallback
        require('os').setPriority(process.pid, 19) // Set lowest priority
        process.abort() // Force core dump
    }, MAX_INSTANCE_DURATION_AFTER_RABBIT_MESSAGE_RECIEVED_MS)

    logger.info(
        `Hard kill timer set: instance will be forcefully terminated after ${MAX_INSTANCE_DURATION_AFTER_RABBIT_MESSAGE_RECIEVED_MS / 1000 / 60 / 60} hours`,
    )
}

async function retryApiCall<T>(
    fn: () => Promise<T>,
    maxRetries = 120, // Default 120 retries for 20 minutes with 10s delay
    maxRetryTime = 20 * 60 * 1000, // 20 minutes in milliseconds
    retryDelay = 10000 // Fixed 10 second delay between retries
): Promise<T> {
    const startTime = Date.now();
    let lastError: any;
    let retryCount = 0;

    while (retryCount < maxRetries && (Date.now() - startTime) < maxRetryTime) {
        try {
            const result = await fn();
            console.log(`API call succeeded after ${retryCount} attempts`);
            return result;
        } catch (error) {
            lastError = error;
            retryCount++;
            
            const elapsedTime = (Date.now() - startTime) / 1000;
            const remainingTime = Math.max(0, maxRetryTime - (Date.now() - startTime)) / 1000;
            
            // Log retry attempt with more detailed information
            console.log(`API call failed, attempt ${retryCount}/${maxRetries} (${elapsedTime.toFixed(1)}s elapsed, ${remainingTime.toFixed(1)}s remaining). Retrying in ${retryDelay/1000}s...`, error);
            
            // Wait before next retry - ensure this actually waits the full duration
            if (retryCount < maxRetries && (Date.now() - startTime) < maxRetryTime) {
                await new Promise(resolve => setTimeout(resolve, retryDelay));
            }
        }
    }
    
    // If we get here, all retries have failed
    const totalTime = (Date.now() - startTime)/1000;
    console.error(`API call failed after ${retryCount} attempts over ${totalTime.toFixed(1)}s - exhausted retry attempts`);
    throw lastError;
}
