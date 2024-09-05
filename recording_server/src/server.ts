import * as express from 'express'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as redis from 'redis'

import {
    ChangeAgendaRequest,
    MessageToBroadcast,
    SpeakerData,
    StatusParams,
    StopRecordParams,
} from './types'

import { Logger } from './logger'
import { MeetingHandle } from './meeting'
import { PORT } from './instance'

import { sleep } from './utils'

import axios from 'axios'
import { SoundContext, VideoContext } from './media_context'
import { execSync } from 'child_process'
import { unlinkSync } from 'fs'

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

const SPEAKER_LOG_PATHNAME = path.join(__dirname, 'SeparationSpeakerLog.txt')
console.log(`Speaker log pathname : ${SPEAKER_LOG_PATHNAME}`)

const MEET_ORIGINS = [
    'https://meet.google.com',
    'https://meet.googleapis.com',
    'https://meetings.googleapis.com',
    'https://teams.microsoft.com',
]
async function getAllowedOrigins(): Promise<string[]> {
    return [
        process.env.ALLOWED_ORIGIN,
        'http://localhost:3005',
        ...MEET_ORIGINS,
    ]
}

export async function server() {
    const app = express()
    const allowedOrigins = await getAllowedOrigins()

    app.use(express.urlencoded({ extended: true }))
    app.use(express.json({ limit: '50mb' })) // To parse the incoming requests with JSON payloads

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

    app.post('/broadcast_message', async (req, res) => {
        const message: MessageToBroadcast = req.body
        console.log('Message received from extension :', message)
        res.status(200).json({})
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

    app.post('/add_speaker', async (req, res) => {
        const speakers: SpeakerData[] = req.body
        console.log('Speaker update received:', speakers)
        speakers.forEach((speaker) => {
            if (speaker.isSpeaking) {
                MeetingHandle.addSpeaker(speaker)
            }
        })
        res.status(200).send('ok')
    })

    // TODO : Same function as below
    app.post('/end_zoom_meeting', async (_req, res) => {
        console.log('end meeting for zoom notification recieved:')
        MeetingHandle.instance
            .stopRecording('zoom meeting ENDED')
            .catch((e) => {
                LOGGER.error(`stop recording error ${e}`)
            })

        res.status(200).send('ok')
    })

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

    type Upload = {
        url: string
    }

    enum FileExtension {
        Jpg = '.jpg',
        Png = '.png',
        Mp4 = '.mp4',
        Mp3 = '.mp3',
    }

    const path = require('path')

    // Upload ressources into the server
    app.post('/upload', async (request, result) => {
        const params: Upload = request.body
        console.log(params)

        const extension = path.extname(params.url)
        if (!Object.values(FileExtension).includes(extension)) {
            result.status(400).json({
                error: 'This extension is not compatible',
            })
            return
        }
        await axios
            .get(params.url, { responseType: 'arraybuffer' })
            .then((file) => {
                const filename = path.basename(params.url)

                fs.writeFile(filename, file.data)
                console.log('Ressource downloaded @', filename)

                // In case of image, create a video from it with FFMPEG and delete tmp files
                if (extension == '.jpg' || extension == '.png') {
                    try {
                        const command = `ffmpeg -y -i ${filename} -vf scale=${VideoContext.WIDTH}:${VideoContext.HEIGHT} -y resized_${filename}`
                        const output = execSync(command)
                        console.log(output.toString())
                    } catch (e) {
                        console.error(
                            `Unexpected error when scaling image : ${e}`,
                        )
                        result.status(400).json({
                            error: 'Cannot scale image',
                        })
                        return
                    }
                    try {
                        const command = `ffmpeg -y -loop 1 -i resized_${filename} -c:v libx264 -r 30 -t 1 -pix_fmt yuv420p ${filename}.mp4`
                        const output = execSync(command)
                        console.log(output.toString())
                    } catch (e) {
                        console.error(
                            `Unexpected error when generating video : ${e}`,
                        )
                        result.status(400).json({
                            error: 'Cannot generate video',
                        })
                        return
                    }
                    try {
                        unlinkSync(`${filename}`)
                        unlinkSync(`resized_${filename}`)
                    } catch (e) {
                        console.error(`Cannot unlink files : ${e}`)
                    }
                }
                result.status(200).json({
                    ok: 'New ressource uploaded',
                })
            })
            .catch((e) => {
                console.log(e)
                result.status(400).json({
                    error: e,
                })
            })
    })

    // Play a given ressource into microphone, camera or both
    app.post('/play', async (request, result) => {
        const params: Upload = request.body
        console.log(params)

        const extension = path.extname(params.url)
        if (!Object.values(FileExtension).includes(extension)) {
            result.status(400).json({
                error: 'This extension is not compatible',
            })
            return
        }
        const filename = path.basename(params.url)
        switch (extension) {
            case '.png':
            case '.jpg':
                await VideoContext.instance.stop()
                VideoContext.instance.play(`${filename}.mp4`, true)
                break
            case '.mp3':
                await SoundContext.instance.stop()
                SoundContext.instance.play(`${filename}`, false)
                break
            case '.mp4':
                await VideoContext.instance.stop()
                await SoundContext.instance.stop()
                VideoContext.instance.play(`${filename}`, false)
                SoundContext.instance.play(`${filename}`, false)
                break
            default:
                console.error('Unexpected Extension :', extension)
                result.status(400).json({
                    error: 'Unexpected Extension',
                })
                return
        }
        result.status(200).json({
            ok: 'Ressource on playing...',
        })
    })

    try {
        app.listen(PORT, HOST)
        LOGGER.info(`Running on http://${HOST}:${PORT}`)
    } catch (e) {
        LOGGER.error(`Failed to register instance: ${e}`)
    }
}
