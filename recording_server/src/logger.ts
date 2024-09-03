import { BUCKET_NAME, s3cp } from './s3'

import { LOGGER } from './server'
import axios from 'axios'
import { exec } from 'child_process'
import * as fs from 'fs/promises'

import { getFiles } from './utils'
import * as path from 'path'

let PROJECT_ID: number | undefined = undefined

export function setLoggerProjectId(project_id: number) {
    PROJECT_ID = project_id
}

export class Logger {
    tags = {}

    constructor(tags: any) {
        this.tags = tags
    }

    new(tags: any) {
        return new Logger({ ...this.tags, ...tags })
    }

    log(level: string, message: string, tags: any) {
        try {
            let date = new Date()
            let iso = date.toISOString().split('T')

            let date_fmt = `${
                months[date.getMonth()]
            } ${date.getDate()} ${iso[1].slice(0, iso[1].length - 1)}`

            let tags_fmt = ``
            for (const [key, value] of Object.entries({
                ...this.tags,
                ...tags,
            })) {
                tags_fmt += `${key}: ${value}, `
            }
            if (tags_fmt.length > 2) {
                tags_fmt = tags_fmt.substring(0, tags_fmt.length - 2)
                console.log(`${date_fmt} ${level} ${message}, ${tags_fmt}`)
            } else {
                console.log(`${date_fmt} ${level} ${message}`)
            }
        } catch (e) {
            console.error(`Failed to log log: ERROR: ${e}, LOG: ${message}`)
        }
    }

    info(message: string, tags?: any) {
        this.log('INFO', message, tags || {})
    }

    warn(message: string, tags?: any) {
        this.log('WARN', message, tags || {})
    }

    error(message: string, tags?: any) {
        this.log('ERROR', message, tags || {})
    }
}

const months = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
]

export async function uploadLog(
    user_id: number,
    email: string,
    bot_id?: string,
    project_id?: number,
    share_link?: string,
) {
    const date = new Date()
        .toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
        })
        .replace(/\//g, '-')
    const d = new Date()

    const link = project_id
        ? `logs/${date}/${user_id}/${project_id}/${d.getHours()}h${d.getMinutes()}`
        : `logs/${date}/${user_id}/${bot_id}/${d.getHours()}h${d.getMinutes()}`

    const linkSpeakerSeparationFile = `logs/${date}/${user_id}/${project_id}/${d.getHours()}h-speaker_file`
    try {
        // Téléverser le fichier de log principal
        await s3cp(process.env.LOG_FILE, link)

        // Téléverser le fichier SeparationSpeakerLog
        const separationLogPath = path.join(
            __dirname,
            'SeparationSpeakerLog.txt',
        )
        await s3cp(separationLogPath, linkSpeakerSeparationFile)

        const s3File = `https://${BUCKET_NAME}.s3.amazonaws.com/${link}`
        const s3SeparationFile = `https://${BUCKET_NAME}.s3.amazonaws.com/${linkSpeakerSeparationFile}`

        const allScreenshotFiles = []
        console.log('get screenshot files')
        for await (const f of getFiles('./screenshot')) {
            console.log(f)
            const s3File = `https://${BUCKET_NAME}.s3.amazonaws.com/${f}`
            allScreenshotFiles.push(s3File)
        }

        let reqInstance = axios.create({
            headers: {
                Authorization: `Basic YWRtaW46U3Bva2VyMTIzNTgxMzIx`,
            },
        })

        await reqInstance.get(
            `https://spoke.app.n8n.cloud/webhook/failed_bot?email=${email}&s3_log=${encodeURIComponent(
                s3File,
            )}&s3_separation_log=${encodeURIComponent(
                s3SeparationFile,
            )}&bot_id=${bot_id}&user_id=${user_id}&share_link=${share_link}&project_id=${project_id}&screenshots=${encodeURIComponent(
                allScreenshotFiles.join(', '),
            )}`,
        )

        await fs.rm('./screenshot', { recursive: true, force: true })

        // Supprimer le fichier local de séparation des speakers
        // await fs.unlink(separationLogPath);
    } catch (e) {
        console.error('failed to upload log', e)
    }
}

export function uploadLogScript() {
    return new Promise<void>((res, _rej) => {
        exec(`upload_log.sh ${PROJECT_ID ?? ''}`, (_error, stdout, stderr) => {
            LOGGER.info(`upload log`, { stdout, stderr })
            res()
        })
    })
}
