import { exec } from 'child_process'
import * as fs from 'fs/promises'

// import { BUCKET_NAME, s3cp } from './s3'
// import axios from 'axios'
// import * as path from 'path'
// import { getFiles } from './utils'
// import { dirname } from 'path'

const NODE_NAME = process.env.NODE_NAME
const util = require('util')
const execPromise = util.promisify(exec)

import { Page } from '@playwright/test'

import { s3cp } from './s3'
import { MeetingParams } from './types'

const EFS_MOUNT_POINT: string = '/mnt/efs'

export class Logger {
    public static instance: Logger | null

    private destination_dir: string
    private bot_uuid: string

    constructor(meetingParams: MeetingParams) {
        let environ: string = process.env.ENVIRON
        console.log('ENVIRON :', environ)

        this.bot_uuid = meetingParams.bot_uuid
        if (environ === 'prod') {
            this.destination_dir = `${EFS_MOUNT_POINT}/prod/${meetingParams.bot_uuid}`
        } else if (environ === 'preprod') {
            this.destination_dir = `${EFS_MOUNT_POINT}/preprod/${meetingParams.bot_uuid}`
        } else {
            this.destination_dir = `./logs/${meetingParams.bot_uuid}`
        }
        Logger.instance = this
    }

    public async init() {
        await fs.mkdir(this.destination_dir, { recursive: true }).catch((e) => {
            console.error('Unable to create logger directory :', e)
        })
    }

    public async screenshot(page: Page, name: string) {
        try {
            const date = new Date()
                .toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'numeric',
                    day: 'numeric',
                })
                .replace(/\//g, '-')
            const link = `${this.destination_dir}/screenshot_${name.replaceAll(
                '/',
                '',
            )}_${date}.jpg`
            await page.screenshot({
                path: link,
                timeout: 5000,
                animations: 'disabled',
                scale: 'css',
            })
            await s3cp(
                link,
                `${this.bot_uuid}/screenshot_${name.replaceAll(
                    '/',
                    '',
                )}_${date}.jpg`,
            ).catch((e) => {
                console.error(`Failed to upload screenshot to s3 ${e}`)
            })
        } catch (e) {
            console.error(`Failed to take screenshot ${e}`)
        }
    }

    public get_video_directory(): string {
        return `${this.destination_dir}/output.mp4`
    }

    public get_speaker_log_directory(): string {
        return `${this.destination_dir}/SeparationSpeakerLog.txt`
    }

    public async updateGrafanaAgentAddBotUuid() {
        let environ: string = process.env.ENVIRON
        if (environ === 'local') {
            return
        }
        try {
            console.log('Starting config update...')

            // Update of the configuration file
            const sedResult = await execPromise(
                `sudo -n sed -i 's/${NODE_NAME}/${this.bot_uuid}/g' /etc/grafana-agent.yaml`,
            )

            if (sedResult.stderr) {
                console.error(
                    `Error while updating the configuration file: ${sedResult.stderr}`,
                )
            }

            console.log('Configuration file updated successfully')

            // Reloading the Grafana agent
            const reloadResult = await execPromise(
                'sudo -n systemctl restart grafana-agent.service',
            )

            if (reloadResult.stderr) {
                console.error(
                    `Error while reloading the Grafana agent : ${reloadResult.stderr}`,
                )
            }

            console.log('Grafana agent reloaded successfully')
        } catch (error) {
            console.error(`An error has occurred : ${error}`)
        }
    }

    public async remove_video() {
        await fs.unlink(this.get_video_directory()).catch((e) => {
            console.error('Cannot remove video : ', e)
        })
    }

    public async upload_log() {
        let source_base_log: string = process.env.LOG_FILE
        let destination_base_log: string = `${this.destination_dir}/logs.txt`

        await fs
            .readFile(source_base_log, 'utf-8')
            .catch((e) => {
                console.error(`Cannot read log file : ${e}`)
            })
            .then(async (log) => {
                if (log) {
                    await fs.writeFile(destination_base_log, log).catch((e) => {
                        console.error(`Cannot Update log file : ${e}`)
                    })
                }
            })
    }
}

// ___OLD_COPY_TO_S3___
// await s3cp(link, link.substring(2))

// export function uploadLogScript(bot_id: string) {
//     return new Promise<void>((res, _rej) => {
//         exec(`upload_log.sh ${bot_id ?? ''}`, (_error, stdout, stderr) => {
//             console.log(`upload log`, { stdout, stderr })
//             res()
//         })
//     })
// }
//
// #!/bin/bash -x
// if [ -z $1 ]; then
// 	export LOG_FILE_S3=$NODE_NAME
// else
// 	export LOG_FILE_S3=$1
// fi
// aws s3 cp "$LOG_FILE" "s3://spoke-log-zoom/$LOG_FILE_S3" --storage-class=ONEZONE_IA

// ___OLD_UPLOAD_SEPARATION_SPEAKER_FILE_TO_S3
// await s3cp(separationLogPath, linkSpeakerSeparationFile).catch((e) {
//     console.error('failed to upload speaker file', e)
// })

// ___OLD_UPLOAD_LOG_TO_s3___
// const date = new Date()
//     .toLocaleDateString('en-US', {
//         year: 'numeric',
//         month: 'numeric',
//         day: 'numeric',
//     })
//     .replace(/\//g, '-')
// const d = new Date()
// const link = `logs/${date}/${user_id}/${bot_id}/${d.getHours()}h${d.getMinutes()}`
// await s3cp(process.env.LOG_FILE, link).catch((e) => {
//     console.error('failed to upload log', e)
// })

// ___OLD_SCREENSHOOT_TO_S3_SEQUENCE___
// const allScreenshotFiles = []
// console.log('get screenshot files')
// for await (const f of getFiles('./screenshot')) {
//     console.log(f)
//     const s3File = `https://${BUCKET_NAME}.s3.amazonaws.com/${f}`
//     allScreenshotFiles.push(s3File)
// }

// ___OLD_N8N_SEQUENCE___
// let reqInstance = axios.create({
//     headers: {
//         Authorization: `Basic YWRtaW46U3Bva2VyMTIzNTgxMzIx`,
//     },
// })
// await reqInstance.get(
//     `https://spoke.app.n8n.cloud/webhook/failed_bot?email=${email}&s3_log=${encodeURIComponent(
//         s3File,
//     )}&s3_separation_log=${encodeURIComponent(
//         s3SeparationFile,
//     )}&bot_id=${bot_id}&user_id=${user_id}&screenshots=${encodeURIComponent(
//         allScreenshotFiles.join(', '),
//     )}`,
// )
