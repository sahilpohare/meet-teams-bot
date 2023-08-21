import * as meeting from './meeting'
import * as express from 'express'
import * as bodyParser from 'body-parser'
import { ChangeLanguage, MarkMomentParams, StopRecordParams } from './meeting'
import { Logger } from './logger'
import { PORT } from './instance'
import * as redis from 'redis'
import { sleep } from './utils'

export const LOGGER = new Logger({})

console.log('redis url: ', process.env.REDIS_URL)
export const clientRedis = redis.createClient({
    url: process.env.REDIS_URL,
})

// Constants
const HOST = '0.0.0.0'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN

export async function server() {
    const app = express()

    const jsonParser = bodyParser.json({ limit: '50mb' })

    app.options('*', (_req, res) => {
        res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
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
        res.header('Access-Control-Allow-Origin', ALLOWED_ORIGIN)
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

    app.post('/status', jsonParser, async (req, res) => {
        function statusReady() {
            return (
                meeting.CURRENT_MEETING.error != null ||
                meeting.CURRENT_MEETING.project != null
            )
        }
        const data: meeting.StatusParams = req.body
        try {
            let logger = LOGGER.new({
                user_id: data.user_id,
                meeting_url: data.meeting_url,
            })
            logger.info(`status request`, {
                user_id: data.user_id,
                meeting_url: data.meeting_url,
                current_meeting: meeting.CURRENT_MEETING,
            })
            for (let i = 0; i < 100; i++) {
                if (statusReady()) {
                    if (meeting.CURRENT_MEETING.error != null) {
                        logger.info('status ready, returning error')
                        const error = meeting.CURRENT_MEETING.error
                        res.status(500).send(JSON.stringify(error))
                        return
                    } else if (meeting.CURRENT_MEETING.project != null) {
                        logger.info('status ready, returning project')
                        res.json(meeting.CURRENT_MEETING.project)
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

    app.post('/change_language', jsonParser, async (req, res) => {
        const data: ChangeLanguage = req.body
        try {
            await meeting.changeLanguage(data)
            res.send('ok')
        } catch (e) {
            res.status(500).send(JSON.stringify(e))
        }
    })

    app.post('/stop_record', jsonParser, async (req, res) => {
        const data: StopRecordParams = req.body
        console.log('stop record request: ', data)
        if (
            meeting.CURRENT_MEETING.param?.meeting_url != null &&
            meeting.CURRENT_MEETING.param?.meeting_url !== '' &&
            meeting.CURRENT_MEETING.param?.meeting_url !== data.meeting_url
        ) {
            res.send('ok')
            return
        }
        meeting.stopRecording('API request')
        res.send('ok')
    })

    app.post('/mark_moment', jsonParser, async (req, res) => {
        const data: MarkMomentParams = req.body
        try {
            await meeting.markMoment(data)
            res.send('ok')
        } catch (e) {
            res.status(500).send(JSON.stringify(e))
        }
    })

    app.get('/shutdown', async (_req, res) => {
        LOGGER.warn('Shutdown requested')
        res.send('ok')
        process.exit(0)
    })

    try {
        app.listen(PORT, HOST)
        LOGGER.info(`Running on http://${HOST}:${PORT}`)
    } catch (e) {
        LOGGER.error(`Failed to register instance: ${e}`)
    }
}
