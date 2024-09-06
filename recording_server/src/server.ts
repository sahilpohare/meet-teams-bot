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

    // Console log message (into logs)
    app.post('/broadcast_message', async (req, res) => {
        const message: MessageToBroadcast = req.body
        console.log('Message received from extension :', message)
        res.status(200).json({})
    })

    // Speakers event from All providers : Write logs and send data to extension
    app.post('/add_speaker', async (req, res) => {
        const speakers: SpeakerData[] = req.body
        console.log('Speaker update received:', speakers)
        let input = JSON.stringify(speakers)
        await fs.appendFile(SPEAKER_LOG_PATHNAME, `${input}\n`).catch((e) => {
            LOGGER.error(`Cannot append speaker log file ! : ${e}`)
        })
        speakers.forEach((speaker) => {
            if (speaker.isSpeaking) {
                MeetingHandle.addSpeaker(speaker)
            }
        })
        res.status(200).send('ok')

        // export const MIN_SPEAKER_DURATION = 200
        // const COUNT_INTERVAL: number = 100

        // // Array to store the maximum occurrences of a speaker in a 100 ms interval
        // let MAX_OCCURRENCES: { speaker: string; timestamp: number; count: number }[] =
        //     []

        // // Array to store current speaker count in this 100 ms interval
        // let SPEAKERS_COUNT = new Map()

        // // Function to reset speaker counts
        // function resetSpeakerCounts() {
        //     SPEAKERS_COUNT = new Map()
        // }

        // // Function to log speaker counts
        // function calcSpeaker() {
        //     let maxCount = 0
        //     let maxSpeaker = ''

        //     // Find the speaker with the maximum occurrences
        //     SPEAKERS_COUNT.forEach((count, speaker) => {
        //         if (count > maxCount) {
        //             maxSpeaker = speaker
        //             maxCount = count
        //         }
        //     })

        //     if (maxSpeaker) {
        //         const currentDate = Date.now()
        //         MAX_OCCURRENCES.push({
        //             speaker: maxSpeaker,
        //             timestamp: currentDate,
        //             count: maxCount,
        //         })
        //     }
        //     resetSpeakerCounts()
        // }

        //     // Set interval to log and reset speaker counts every 100 ms
        //     setInterval(calcSpeaker, COUNT_INTERVAL)

        // if (speakers != null) {
        //     SPEAKERS_COUNT.set(speakers[0].name, (SPEAKERS_COUNT.get(speakers[0].name) || 0) + 1)
        // }

        // // Check for more than 3 adjacent occurrences of a different speaker
        // for (let i = 0; i < MAX_OCCURRENCES.length; i++) {
        //     if (MAX_OCCURRENCES[i].speaker !== currentSpeaker) {
        //         let differentSpeaker = MAX_OCCURRENCES[i]
        //         let differentSpeakerCount = 0
        //         for (let j = i; j < MAX_OCCURRENCES.length; j++) {
        //             if (MAX_OCCURRENCES[j].speaker === differentSpeaker.speaker) {
        //                 if (differentSpeakerCount >= 4) {
        //                     MAX_OCCURRENCES = MAX_OCCURRENCES.slice(j)
        //                     return [
        //                         {
        //                             name: differentSpeaker.speaker,
        //                             id: 0,
        //                             timestamp: differentSpeaker.timestamp,
        //                             isSpeaking: true,
        //                         },
        //                     ]
        //                 }
        //                 differentSpeakerCount++
        //             } else {
        //                 break
        //             }
        //         }
        //     }
        // }
        // if (MAX_OCCURRENCES.length > 0) {
        //     if (
        //         MAX_OCCURRENCES[MAX_OCCURRENCES.length - 1].speaker ===
        //         currentSpeaker
        //     ) {
        //         MAX_OCCURRENCES = MAX_OCCURRENCES.slice(-1)
        //     }
        // }
        // return []

        // PHILOU : C'est une logique interessante, mais ca devrait etre ailleurs, comme sur la background par ex.
        // // New logic for Meet and Teams
        // const activeSpeakers = currentSpeakersList.filter(
        //     (s) => s.isSpeaking,
        // )
        // // si lazare parle,  si Philippe se met a parler en meme temps
        // // philippe prend forcement la precedence
        // const newActiveSpeakers = activeSpeakers.filter(
        //     (s) =>
        //         s.name !== BOT_NAME &&
        //         (SPEAKERS.length === 0 ||
        //             s.name !== SPEAKERS[SPEAKERS.length - 1].name),
        // )
        // // essayer de gerer MIN DURATION ICI ?
        // //  && Date.now() - s.timestamp >
        // //     PROVIDER.MIN_SPEAKER_DURATION)),

        // if (newActiveSpeakers.length > 0) {
        //     // TODO: not handling multiple speakers in the same time
        //     const newSpeaker = newActiveSpeakers[0]
        //     SPEAKERS.push(newSpeaker)
        //     console.log('speaker changed to: ', newSpeaker)
        //     chrome.runtime.sendMessage({
        //         type: 'REFRESH_SPEAKERS',
        //         payload: SPEAKERS,
        //     })
        // }
    })

    // Leave bot request from api server
    app.post('/stop_record', async (req, res) => {
        const data: StopRecordParams = req.body
        console.log('end meeting from api server :', data)
        stop_record(res, 'api request')
    })

    // Stop meeting from zoom
    app.post('/end_zoom_meeting', async (_req, res) => {
        console.log('end meeting from zoom notification')
        stop_record(res, 'zoom request')
    })

    // Stop meeting from extension
    app.post('/stop_meeting', async (_req, res) => {
        console.log('end meeting from extension notification')
        stop_record(res, 'extension request')
    })

    function stop_record(res: any, reason: string) {
        MeetingHandle.instance
            .stopRecording(reason)
            .then(() => {
                res.status(200)
            })
            .catch((e) => {
                LOGGER.error(`stop recording error ${e}`)
                res.status(400).json({
                    error: e,
                })
            })
    }

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

    // Unused ?
    app.get('/shutdown', async (_req, res) => {
        LOGGER.warn('Shutdown requested')
        res.send('ok')
        process.exit(0)
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

    try {
        app.listen(PORT, HOST)
        LOGGER.info(`Running on http://${HOST}:${PORT}`)
    } catch (e) {
        LOGGER.error(`Failed to register instance: ${e}`)
    }
}
