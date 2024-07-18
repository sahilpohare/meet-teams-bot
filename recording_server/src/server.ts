import * as bodyParser from 'body-parser'
import * as express from 'express'
import * as redis from 'redis'
import { PORT } from './instance'
import { Logger } from './logger'
import { MeetingHandle } from './meeting'
import {
    ChangeAgendaRequest,
    ChangeLanguage,
    StatusParams,
    StopRecordParams,
    MessageToBroadcast,
} from './types'
import { sleep } from './utils'

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
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN

export async function server() {
    const app = express()

    const jsonParser = bodyParser.json({ limit: '50mb' })
    const allowed_origin = ALLOWED_ORIGIN

    app.options('*', (_req, res) => {
        res.header('Access-Control-Allow-Origin', allowed_origin)
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

    app.use((req, res, next) => {
        res.header('Access-Control-Allow-Origin', allowed_origin)
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

    // Only spoke for the moment
    app.post('/status', jsonParser, async (req, res) => {
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
    app.post('/change_agenda', jsonParser, async (req, res) => {
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

    // Maybe unused now
    app.post('/change_language', jsonParser, async (req, res) => {
        const data: ChangeLanguage = req.body
        try {
            await MeetingHandle.instance.changeLanguage(data)
            res.send('ok')
        } catch (e) {
            res.status(500).send(JSON.stringify(e))
        }
    })

    // Leave bot request from server
    app.post('/stop_record', jsonParser, async (req, res) => {
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
        const message: MessageToBroadcast = req.body;
        console.log('Message received from extension: ', message);
        if (message.message_type === 'LOG') {
            console.log(message.data)
            res.status(200).send('ok')
            return
        } else  if (message.message_type === 'STOP_MEETING') {
            MeetingHandle.instance.stopRecording('extension request').catch((e) => {
                LOGGER.error(`Stop recording error ${e}`)
            })
            res.status(200).send('ok')
            return
        }
        res.status(400).send('Unknown messahe type')
    })

    try {
        app.listen(PORT, HOST)
        LOGGER.info(`Running on http://${HOST}:${PORT}`)
    } catch (e) {
        LOGGER.error(`Failed to register instance: ${e}`)
    }
}
