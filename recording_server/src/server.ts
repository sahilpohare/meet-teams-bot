import * as express from 'express'
import * as fs from 'fs/promises'
import * as path from 'path'
import * as redis from 'redis'

import { execSync, spawn } from 'child_process'
import { SoundContext, VideoContext } from './media_context'
import {
    MessageToBroadcast,
    RecordingApprovalState,
    SpeakerData,
    StopRecordParams,
} from './types'

import axios from 'axios'
import { NO_SPEAKER_DETECTED_TIMESTAMP } from './meeting'

import { unlinkSync } from 'fs'
import { PORT } from './instance'
import { MeetingHandle } from './meeting'
import { ZOOM_RECORDING_APPROVAL_STATUS } from './meeting/zoom'
import { Streaming } from './streaming'
import { TRANSCODER } from './transcoder'

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

const PAUSE_BETWEEN_SENTENCES: number = 600 // ms
var CUR_SPEAKER: SpeakerData | null = null

export async function server() {
    const app = express()
    const allowedOrigins = await getAllowedOrigins()

    app.use(express.urlencoded({ extended: true }))
    app.use(express.raw({ type: 'application/octet-stream', limit: '1000mb' }))
    app.use(express.json({ limit: '1000mb' })) // To parse the incoming requests with JSON payloads
    app.use(express.urlencoded({ limit: '1000mb' }))

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
        Streaming.instance?.send_speaker_state(speakers)
        console.table(speakers)
        let input = JSON.stringify(speakers)
        await fs.appendFile(SPEAKER_LOG_PATHNAME, `${input}\n`).catch((e) => {
            console.error(`Cannot append speaker log file ! : ${e}`)
        })
        // Count the number of active speakers;
        // an active speaker is a speaker who is currently speaking.
        const speakers_count: number = speakers.reduce(
            (acc, s) => acc + (s.isSpeaking === true ? 1 : 0),
            0,
        )
        switch (speakers_count) {
            case 0:
                // There are no speaker
                NO_SPEAKER_DETECTED_TIMESTAMP.set(Date.now())
                if (CUR_SPEAKER) {
                    CUR_SPEAKER.isSpeaking = false
                    if (speakers.length > 0) {
                        CUR_SPEAKER.timestamp = speakers[0].timestamp
                    }
                }
                break
            case 1:
                NO_SPEAKER_DETECTED_TIMESTAMP.set(null)
                // Only one speaker is detected
                const active_speaker = speakers.find(
                    (v) => v.isSpeaking === true,
                )
                if (active_speaker.name !== CUR_SPEAKER?.name) {
                    // Change of speaker case
                    MeetingHandle.addSpeaker(active_speaker)
                } else {
                    if (CUR_SPEAKER!.isSpeaking === false) {
                        // The speaker was no longer speaking
                        if (
                            active_speaker.timestamp >=
                            CUR_SPEAKER!.timestamp + PAUSE_BETWEEN_SENTENCES
                        ) {
                            // Update the information that the speaker has started speaking again.
                            // Make a break between sentences.
                            MeetingHandle.addSpeaker(active_speaker)
                        }
                    } else {
                        // Speaker is already on speaking : Dont do anything
                    }
                }
                CUR_SPEAKER = active_speaker
                break
            default:
                NO_SPEAKER_DETECTED_TIMESTAMP.set(null)
                // Multiple speakers are currently speaking.

                // Interuption Behavior - Not the best choice
                // Make an arbitrary choice for the new speaker; they take over from the previous one.
                // ------------------------------------------
                // const new_active_speaker = speakers.find(
                //     (v) =>
                //         v.isSpeaking === true &&
                //         new_active_speaker.name !== CUR_SPEAKER?.name,
                // )
                // MeetingHandle.addSpeaker(new_active_speaker)
                // CUR_SPEAKER = new_active_speaker

                // Same Speaker Prime - Best for me (mordak)
                // -----------------------------------------
                const has_speaking_cur_speaker = speakers.some(
                    (speaker) =>
                        speaker.name === CUR_SPEAKER?.name &&
                        speaker.isSpeaking === true,
                )
                if (has_speaking_cur_speaker) {
                    const active_speaker = speakers.find(
                        (speaker) => speaker.name === CUR_SPEAKER!.name,
                    )
                    if (CUR_SPEAKER!.isSpeaking === false) {
                        // The speaker was no longer speaking
                        if (
                            active_speaker.timestamp >=
                            CUR_SPEAKER!.timestamp + PAUSE_BETWEEN_SENTENCES
                        ) {
                            // Update the information that the speaker has started speaking again.
                            // Make a break between sentences.
                            MeetingHandle.addSpeaker(active_speaker)
                        }
                    } else {
                        // Speaker is already on speaking : Dont do anything
                    }
                    CUR_SPEAKER = active_speaker
                } else {
                    // Make an arbitrary choice for the new speaker;
                    const active_speaker = speakers.find(
                        (v) => v.isSpeaking === true,
                    )
                    MeetingHandle.addSpeaker(active_speaker)
                    CUR_SPEAKER = active_speaker
                }
        }
        res.status(200).send('ok')
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
        ZOOM_RECORDING_APPROVAL_STATUS.set(RecordingApprovalState.DISABLE)
        stop_record(res, 'zoom request')
    })

    // Stop meeting from extension
    app.post('/stop_meeting', async (_req, res) => {
        console.log('end meeting from extension notification')
        stop_record(res, 'extension request')
    })
    app.post('/start_zoom_recording', async (_req, res) => {
        console.log('start recording from zoom notification')

        try {
            await ZOOM_RECORDING_APPROVAL_STATUS.set(
                RecordingApprovalState.ENABLE,
            )
            res.status(200).json({ message: 'Recording started successfully' })
        } catch (e) {
            console.error(`start recording error: ${e}`)
            res.status(400).json({
                error: e || 'An error occurred while starting the recording',
            })
        }
    })

    //logger zoom
    app.post('/logs', (req, res) => {
        // console.log('logs from zoom', req.body)
        const { level, message, timestamp } = req.body

        // Fonction pour colorer les logs dans le terminal
        function colorLog(level, message, timestamp) {
            switch (level) {
                case 'warn':
                    console.warn(
                        '\x1b[33m%s\x1b[0m',
                        `[WARN] ${timestamp}: ${message}`,
                    )
                    break
                case 'info':
                    console.info(
                        '\x1b[36m%s\x1b[0m',
                        `[INFO] ${timestamp}: ${message}`,
                    )
                    break
                case 'error':
                    console.error(
                        '\x1b[31m%s\x1b[0m',
                        `[ERROR] ${timestamp}: ${message}`,
                    )
                    break
                default:
                    console.log(
                        '\x1b[0m%s\x1b[0m',
                        `[LOG] ${timestamp}: ${message}`,
                    )
            }
        }

        colorLog(level, message, timestamp)

        res.sendStatus(200)
    })

    function stop_record(res: any, reason: string) {
        MeetingHandle.instance
            .stopRecording(reason)
            .then(() => {
                res.status(200)
            })
            .catch((e) => {
                console.error(`stop recording error ${e}`)
                res.status(400).json({
                    error: e,
                })
            })
    }

    // Get Recording Server Build Version Info
    app.get('/version', async (_req, res) => {
        console.log(`version requested`)
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
        console.warn('Shutdown requested')
        res.send('ok')
        process.exit(0)
    })

    app.post('/transcoder/start', async (req, res) => {
        try {
            const bucketName = req.body.bucketName
            const videoS3Path = req.body.videoS3Path
            await TRANSCODER.init(bucketName, videoS3Path)
            res.status(200).json({ message: 'Script lancé avec succès' })
        } catch (err) {
            console.error('Erreur:', err)
            res.status(500).json({
                error: 'Erreur lors de la création de la FIFO ou du lancement du script',
            })
        }
    })

    app.post('/transcoder/upload_chunk', async (req, res) => {
        if (!req.body || !Buffer.isBuffer(req.body)) {
            return res
                .status(400)
                .json({ error: 'Le corps de la requête doit être un buffer' })
        }

        try {
            await TRANSCODER.uploadChunk(req.body)
            return res
                .status(200)
                .json({ message: 'Chunk uploadé avec succès' })
        } catch (err) {
            console.error("Erreur lors de l'upload du chunk:", err)
            return res
                .status(500)
                .json({ error: "Erreur lors de l'upload du chunk" })
        }
    })

    // Ajout d'une route pour arrêter le transcodeur si nécessaire
    app.post('/transcoder/stop', (req, res) => {
        TRANSCODER.stop()
        res.status(200).json({ message: 'Transcoder arrêté avec succès' })
    })

    // Ajoutez cette nouvelle route pour récupérer le chemin du fichier de sortie
    app.get('/transcoder/output', (req, res) => {
        const outputPath = TRANSCODER.getOutputPath()
        res.status(200).json({ outputPath })
    })

    app.post('/transcoder/extract_audio', async (req, res) => {
        const { timeStart, timeEnd, bucketName, s3Path } = req.body

        if (typeof timeStart !== 'number' || typeof timeEnd !== 'number') {
            return res.status(400).json({
                error: 'timeStart et timeEnd doivent être des nombres',
            })
        }

        if (typeof bucketName !== 'string' || typeof s3Path !== 'string') {
            return res.status(400).json({
                error: 'bucketName et s3Path doivent être des chaînes de caractères',
            })
        }

        try {
            const s3Url = await TRANSCODER.extractAudio(
                timeStart,
                timeEnd,
                bucketName,
                s3Path,
            )
            return res.status(200).json({
                message: 'Extraction audio et upload réussis',
                s3Url,
            })
        } catch (err) {
            console.error(
                "Erreur lors de l'extraction audio ou de l'upload:",
                err,
            )
            return res.status(500).json({
                error: "Erreur lors de l'extraction audio ou de l'upload",
            })
        }
    })

    // Route modifiée pour supprimer un fichier S3
    app.delete('/transcoder/s3file', async (req, res) => {
        const { s3Path, bucketName } = req.body

        function deleteFromS3(
            bucketName: string,
            s3Path: string,
        ): Promise<void> {
            return new Promise((resolve, reject) => {
                const s3FullPath = `s3://${bucketName}/${s3Path}`

                const awsCommand = spawn('aws', ['s3', 'rm', s3FullPath])

                let errorOutput = ''

                awsCommand.stderr.on('data', (data) => {
                    errorOutput += data.toString()
                })

                awsCommand.on('close', (code) => {
                    if (code === 0) {
                        console.log(
                            `Fichier supprimé avec succès: ${s3FullPath}`,
                        )
                        resolve()
                    } else {
                        console.error(
                            'Erreur lors de la suppression du fichier S3:',
                            errorOutput,
                        )
                        reject(
                            new Error(
                                `Échec de la suppression S3 avec le code ${code}`,
                            ),
                        )
                    }
                })
            })
        }

        if (!s3Path || typeof s3Path !== 'string') {
            return res.status(400).json({
                error: 'Le paramètre s3Path est requis dans le corps de la requête et doit être une chaîne de caractères',
            })
        }

        try {
            await deleteFromS3(bucketName, s3Path)
            return res
                .status(200)
                .json({ message: 'Fichier S3 supprimé avec succès' })
        } catch (error) {
            console.error('Erreur lors de la suppression du fichier S3:', error)
            return res.status(500).json({
                error: 'Erreur lors de la suppression du fichier S3',
            })
        }
    })

    try {
        app.listen(PORT, HOST)
        console.log(`Running on http://${HOST}:${PORT}`)
    } catch (e) {
        console.error(`Failed to register instance: ${e}`)
    }
}
