import * as express from 'express'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as redis from 'redis'

import {
    ChangeAgendaRequest,
    ChangeLanguage,
    MessageToBroadcast,
    SpeakerData,
    StatusParams,
    StopRecordParams,
} from './types'

import { Logger } from './logger'
import { MeetingHandle } from './meeting'
import { PORT } from './instance'

import { sleep } from './utils'
import bodyParser from 'body-parser'

export let PROJECT_ID: number | undefined = undefined
export const LOGGER = new Logger({})

console.log('redis url: ', process.env.REDIS_URL)
export const clientRedis = redis.createClient({
    url: process.env.REDIS_URL,
})
clientRedis.on('error', (err) => {
    console.error('Redis error:', err)
})
const HOST = '0.0.0.0'

const ALLOWED_ORIGINS = [process.env.ALLOWED_ORIGIN, 'http://localhost:3005']
const SPEAKER_LOG_PATHNAME = path.join(__dirname, 'SeparationSpeakerLog.txt')
console.log(`Speaker log pathname : ${SPEAKER_LOG_PATHNAME}`)

// TODO : CHECK is it is necessary
// const MEET_ORIGINS = [
//     'https://meet.google.com',
//     'https://meet.googleapis.com',
//     'https://meetings.googleapis.com',
//     'https://teams.microsoft.com',
// ]
// async function getAllowedOrigins(): Promise<string[]> {
//     // const extensionId = await getExtensionId()
//     return [
//         process.env.ALLOWED_ORIGIN,
//         'http://localhost:3005',
//         ...MEET_ORIGINS,
//         // `chrome-extension://${extensionId}`,
//     ]
// }

export async function server() {
    const app = express()
    // const allowedOrigins = await getAllowedOrigins()
    const allowedOrigins = ALLOWED_ORIGINS

    // TODO : CHECK is it is necessary
    const jsonParser = bodyParser.json({ limit: '50mb' })

    // TODO : CHECK is it is necessary
    // app.use(express.urlencoded({ extended: true }))
    // app.use(express.json({ limit: '50mb' })) // To parse the incoming requests with JSON payloads
    // app.options('*', (req, res) => {
    //     const origin = req.headers.origin
    //     if (allowedOrigins.includes(origin)) {
    //         res.header('Access-Control-Allow-Origin', origin)
    //     }
    //     res.header('Access-Control-Allow-Credentials', 'true')
    //     res.header(
    //         'Access-Control-Allow-Methods',
    //         'OPTIONS, GET, PUT, POST, DELETE',
    //     )
    //     res.header(
    //         'Access-Control-Allow-Headers',
    //         'Authorization2, Content-Type',
    //     )
    //     res.sendStatus(204)
    // })

    app.use((req, res, next) => {
        const origin = req.headers.origin
        if (allowedOrigins.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin)
        }
        res.header('Access-Control-Allow-Credentials', 'true')
        res.header(
            'Access-Control-Allow-Methods',
            'OPTIONS, GET, PUT, POST, DELETE',
        )
        res.header(
            'Access-Control-Allow-Headers',
            'Authorization2, Content-Type',
        )

        // trim meeting url
        if ((req.body as { meeting_url: string })?.meeting_url != null) {
            req.body.meeting_url = req.body.meeting_url.trim()
        }

        next()
    })

    app.options('*', (_req, res) => {
        const origin = _req.headers.origin
        if (ALLOWED_ORIGINS.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin)
        }
        res.header('Access-Control-Allow-Credentials', 'true')
        res.header(
            'Access-Control-Allow-Methods',
            'OPTIONS, GET, PUT, POST, DELETE',
        )
        res.header(
            'Access-Control-Allow-Headers',
            'Authorization2, Content-Type',
        )
        res.sendStatus(204)
    })

    // Only spoke for the moment
    app.post('/status', async (req, res) => {
        function statusReady() {
            return (
                MeetingHandle.getProject() != null ||
                MeetingHandle.getError() != null
            )
        }
        const data: StatusParams = req.body
        try {
            let logger = LOGGER.new({
                user_id: data.user_id,
                meeting_url: data.meeting_url,
            })
            logger.info('status request')
            for (let i = 0; i < 100; i++) {
                if (statusReady()) {
                    const error = MeetingHandle.getError()
                    const project = MeetingHandle.getProject()
                    const status = MeetingHandle.getStatus()
                    if (error != null) {
                        logger.info('status ready, returning error')
                        res.status(500).send(JSON.stringify(error))
                        return
                    } else if (project != null) {
                        logger.info('status ready, returning project')
                        let agenda = null
                        try {
                            if (status === 'Recording') {
                                agenda =
                                    await MeetingHandle.instance.getAgenda()
                            }
                        } catch (e) {
                            logger.error(
                                'failed to get agenda in status request',
                            )
                        }
                        res.json({
                            project: project,
                            agenda: agenda,
                            status: status,
                        })
                        return
                    }
                }
                await sleep(50)
            }
            logger.info('status not ready, returning null')
            res.json(null)
            return
        } catch (e) {
            res.status(500).send(JSON.stringify(e))
        }
    })

    // Used by Spoke / Maybe useless : Template Choose
    app.post('/change_agenda', async (req, res) => {
        const data: ChangeAgendaRequest = req.body
        console.log('change agenda request', data)
        try {
            await MeetingHandle.instance.changeAgenda(data)
            res.send('ok')
        } catch (e) {
            LOGGER.error(`changing agenda error ${e}`)
            res.status(500).send(JSON.stringify(e))
        }
    })

    // TODO : language_code - 99% sure it is trash code
    // app.post('/change_language', async (req, res) => {
    //     const data: ChangeLanguage = req.body
    //     try {
    //         await MeetingHandle.instance.changeLanguage(data)
    //         res.send('ok')
    //     } catch (e) {
    //         res.status(500).send(JSON.stringify(e))
    //     }
    // })

    // Leave bot request from server
    app.post('/stop_record', async (req, res) => {
        const data: StopRecordParams = req.body
        console.log('stop record request: ', data)
        MeetingHandle.instance.stopRecording('api request').catch((e) => {
            LOGGER.error(`stop recording error ${e}`)
        })
        res.send('ok')
    })

    // Unused
    app.get('/shutdown', async (_req, res) => {
        LOGGER.warn('Shutdown requested')
        res.send('ok')
        process.exit(0)
    })

    // Testing axios channel from extension

    app.post('/broadcast_message', jsonParser, async (req, res) => {
        const message: MessageToBroadcast = req.body
        console.log('Message received from extension: ', message)
        if (message.message_type === 'LOG') {
            console.log(message.data)
            res.status(200).send('ok')
            return
        } else if (message.message_type === 'STOP_MEETING') {
            MeetingHandle.instance
                .stopRecording('extension request')
                .catch((e) => {
                    LOGGER.error(`Stop recording error ${e}`)
                })
            res.status(200).send('ok')
            return
        }
        // if (message.length == 0) {
        //     LOGGER.warn(`Unexpected len : Must be greater than 0.`)
        //     res.status(400).json({
        //         error: 'Unusuable data',
        //     })
        //     return
        // }
        let input = JSON.stringify(message)
        LOGGER.info(`Writing to speaker log file : ${input}`)
        await fs.appendFile(SPEAKER_LOG_PATHNAME, `${input}\n`).catch((e) => {
            LOGGER.error(`Cannot append speaker log file ! : ${e}`)
        })
        res.status(200).json({})
    })

    // app.post('/broadcast_message', async (req, res) => {
    //     const message: MessageToBroadcast = req.body
    //     console.log('Message received from extension :', message)
    //     res.status(200).json({})
    // })

    // Stop meeting request from extension
    app.post('/stop_meeting', async (_req, res) => {
        MeetingHandle.instance
            .stopRecording('extension request')
            .then(() => {
                res.status(200).json({})
            })
            .catch((e) => {
                LOGGER.error(`Stop recording error ${e}`)
                res.status(400).json({
                    error: e,
                })
            })
    })

    // Ideally called when a speaker mutation is detected
    app.post('/observe_speaker', async (req, res) => {
        LOGGER.info(`POST : observe_speaker. received : ${req.body}`)
        console.log(req.body)
        const message: SpeakerData[] = req.body

        function is_speaker_data(obj: any): obj is SpeakerData {
            return (
                typeof obj === 'object' &&
                typeof obj.name === 'string' &&
                typeof obj.id === 'number' &&
                typeof obj.timestamp === 'number' &&
                typeof obj.isSpeaking === 'boolean'
            )
        }
        if (
            !(
                Array.isArray(message) &&
                message.every((item) => is_speaker_data(item))
            )
        ) {
            LOGGER.warn(`Unexpected object type : Must be SpeakerData[].`)
            res.status(400).json({
                error: 'Unusuable data',
            })
            return
        }
        if (message.length == 0) {
            LOGGER.warn(`Unexpected len : Must be greater than 0.`)
            res.status(400).json({
                error: 'Unusuable data',
            })
            return
        }
        let input = JSON.stringify(message)
        LOGGER.info(`Writing to speaker log file : ${input}`)
        await fs.appendFile(SPEAKER_LOG_PATHNAME, `${input}\n`).catch((e) => {
            LOGGER.error(`Cannot append speaker log file ! : ${e}`)
        })
        res.status(200).json({})
    })

    app.post('/add_speaker', jsonParser, async (req, res) => {
        const speakers: SpeakerData[] = req.body
        console.log('Speaker update received:', speakers)
        speakers.forEach((speaker) => {
            if (speaker.isSpeaking) {
                MeetingHandle.addSpeaker(speaker)
            }
        });
        res.status(200).send('ok')
    })

    app.post('/end_zoom_meeting', jsonParser, async (_req, res) => {
        console.log('end meeting for zoom notification recieved:')
        MeetingHandle.instance
            .stopRecording('zoom meeting ENDED')
            .catch((e) => {
                LOGGER.error(`stop recording error ${e}`)
            })

        res.status(200).send('ok')
    })

    // Get Recording Server Build Version Info
    app.get('/version', async (_req, res) => {
        LOGGER.info(`version requested`)
        await import('./buildInfo.json')
            .then((buildInfo) => {
                res.status(200).json(buildInfo)
            })
            .catch((_error) => {
                res.status(404).json({
                    error: 'None build has been done',
                })
            })
    })

    try {
        app.listen(PORT, HOST)
        LOGGER.info(`Running on http://${HOST}:${PORT}`)
    } catch (e) {
        LOGGER.error(`Failed to register instance: ${e}`)
    }
}
