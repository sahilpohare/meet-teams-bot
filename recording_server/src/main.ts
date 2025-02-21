import {
    API_SERVER_BASEURL,
    LOCK_INSTANCE_AT_STARTUP,
    delSessionInRedis,
    terminateInstance,
} from './instance'
import { MeetingHandle } from './meeting'

import { clientRedis } from './server'

import axios from 'axios'
import { join } from 'path'
import pino from 'pino'
import caller from 'pino-caller'
import { exit } from 'process'
// import { generateBranding } from './branding'
import { Api } from './api/methods'
import { Consumer } from './rabbitmq'
import { TRANSCODER } from './transcoder'
import { JoinError, JoinErrorCode, MeetingParams } from './types'

import { spawn } from 'child_process'
import { getCachedExtensionId, openBrowser } from './browser'
import { Events } from './events'

const ZOOM_SDK_DEBUG_EXECUTABLE_PATHNAME = './target/debug/client'
const ZOOM_SDK_RELEASE_EXECUTABLE_PATHNAME = './target/release/client'
const ZOOM_SDK_LIBRARY_PATH = './zoom-sdk-linux-rs/zoom-meeting-sdk-linux'
const ZOOM_SDK_RELATIVE_DIRECTORY = '../zoom'

// const originalError = console.error
// console.error = (...args: any[]) => {
//     originalError('\x1b[31m%s\x1b[0m', ...args)
// }
// Create the logger instance
const baseLogger = pino({
    level: 'debug',
    timestamp: true,
    formatters: {
        level: (label) => {
            return { level: label }
        },
    },
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
            colorizeObjects: true, //--colorizeObjects
            crlf: false, // --crlf
            levelKey: 'level', // --levelKey
            timestampKey: 'time', // --timestampKey
            // The file or file descriptor (1 is stdout) to write to
            destination: 1,
            // You can also configure some SonicBoom options directly
            append: true, // the file is opened with the 'a' flag
            mkdir: true, // create the target destination
            customPrettifiers: {},
        },
    },
})

function formatTable(data: any): string {
    if (!Array.isArray(data) && typeof data !== 'object') {
        return String(data)
    }

    const array = Array.isArray(data) ? data : [data]
    if (array.length === 0) return ''

    const headers = new Set<string>()
    array.forEach((item) =>
        Object.keys(item).forEach((key) => headers.add(key)),
    )
    const cols = Array.from(headers)

    const lines = [
        cols,
        cols.map(() => '-'.repeat(15)),
        ...array.map((item) =>
            cols.map((col) => String(item[col] ?? '').substring(0, 15)),
        ),
    ]

    const colWidths = cols.map((_, i) =>
        Math.max(...lines.map((line) => line[i].length)),
    )

    return (
        '\n' +
        lines
            .map(
                (line) =>
                    '│ ' +
                    line.map((val, i) => val.padEnd(colWidths[i])).join(' │ ') +
                    ' │',
            )
            .join('\n')
    )
}

// Add caller information to logs
export const logger = caller(baseLogger, {
    relativeTo: join(__dirname, '..', '..', 'src'),
    stackAdjustment: 1,
})

console.table = (data: any) => {
    logger.info(formatTable(data))
}

const formatArgs = (msg: string, args: any[]) =>
    msg +
    ' ' +
    args
        .map((arg) => {
            if (arg === null) return 'null'
            if (arg === undefined) return 'undefined'
            if (typeof arg === 'object') {
                try {
                    return JSON.stringify(arg, null, 2)
                } catch (e) {
                    return String(arg)
                }
            }
            return String(arg)
        })
        .join(' ')

export let rawConsoleLog = console.log
export let rawConsoleInfo = console.info
export let rawConsoleWarn = console.warn
export let rawConsoleError = console.error
export let rawConsoleDebug = console.debug

console.log = (msg: string, ...args: any[]) =>
    logger.info(formatArgs(msg, args))
console.info = (msg: string, ...args: any[]) =>
    logger.info(formatArgs(msg, args))
console.warn = (msg: string, ...args: any[]) =>
    logger.warn(formatArgs(msg, args))
console.error = (msg: string, ...args: any[]) =>
    logger.error(formatArgs(msg, args))
console.debug = (msg: string, ...args: any[]) =>
    logger.debug(formatArgs(msg, args))

// ENTRY POINT
// syntax convention
// minus => Library
// CONST => Const
// camelCase => Fn
// PascalCase => Classes
logger.info('version 0.0.1')
;(async () => {
    if (process.argv[2]?.includes('get_extension_id')) {
        getCachedExtensionId().then((x) => console.log(x))
    } else {
        // set default axios config
        axios.defaults.baseURL = API_SERVER_BASEURL
        axios.defaults.withCredentials = true

        // trigger system cache in order to decrease latency when first bot come
        let environ: string = process.env.ENVIRON
        if (environ !== 'local' && !LOCK_INSTANCE_AT_STARTUP) {
            await triggerCache().catch((e) => {
                console.error(`Failed to trigger cache: ${e}`)
                throw e
            })
        }

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

                // Si on arrive ici, c'est que tout s'est bien passé
                console.log(
                    `${Date.now()} Finalize project && Sending WebHook complete`,
                )
                await Api.instance.endMeetingTrampoline()
            } catch (error) {
                // La machine à états a déjà géré le nettoyage
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
            } finally {
                // S'assurer que le transcoder est arrêté et que la vidéo est uploadée
                if (TRANSCODER) {
                    await TRANSCODER.stop().catch((e) =>
                        console.error('Error stopping transcoder:', e),
                    )
                    console.log(`${Date.now()} Uploading video to S3`)
                    await TRANSCODER.uploadVideoToS3().catch((e) =>
                        console.error('Cannot upload video to S3:', e),
                    )
                }
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
    }
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
        Events.callEnded()

        if (!params.success) {
            await meetingBotStartRecordFailed(
                params.meetingUrl,
                params.botUuid,
                params.errorMessage || 'Unknown error',
            )
        }

        webhookSent = true
    } catch (e) {
        console.error('Failed to send webhook:', e)
        // Ne pas mettre webhookSent à true en cas d'erreur
        // pour permettre une nouvelle tentative
    }
}

async function handleErrorInStartRecording(error: Error, data: MeetingParams) {
    logger.error('Error during meeting start:', {
        error: error instanceof JoinError ? error.message : 'Internal error',
        details: error,
    })

    try {
        // Envoyer le webhook d'erreur
        await sendWebhookOnce({
            meetingUrl: data.meeting_url,
            botUuid: data.bot_uuid,
            success: false,
            errorMessage:
                error instanceof JoinError
                    ? error.message
                    : JoinErrorCode.Internal,
        })

        // Les événements sont maintenant gérés par la machine à états
        // Events.callEnded() n'est plus nécessaire ici
    } catch (e) {
        logger.error('Failed to handle start recording error:', e)
        throw e
    }
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
        .then(() => {}) // Convertit explicitement en Promise<void>
        .catch((error) => {
            console.error('Failed to notify recording failure:', error.message)
        })
}

/// open the browser a first time to speed up the next openings
async function triggerCache() {
    const extensionId = await getCachedExtensionId()
    const [chrome, _chromium] = await Promise.all([
        openBrowser(extensionId, false, false),
        null,
        null,
        // openBrowser(extensionId, true, false),
        // generateBranding('cache').wait,
    ])
    await chrome.browser.close()
    // await chromium.browser.close()
}
