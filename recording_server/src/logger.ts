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

import { Console } from './utils'
import { MeetingParams } from './types'
import { Page } from 'puppeteer'

const EFS_MOUNT_POINT: string = '/mnt/efs'
const LOG_UPDATE_INTERVAL: number = 1_000 // ms

export class Logger extends Console {
    public static instance: Logger | null

    private destination_dir: string

    constructor(meetingParams: MeetingParams) {
        super()
        let environ: string = process.env.ENVIRON
        this.info('ENVIRON :', environ)

        if (environ === 'prod') {
            this.destination_dir = `${EFS_MOUNT_POINT}/prod/${meetingParams.bot_uuid}`
        } else if (environ === 'preprod') {
            this.destination_dir = `${EFS_MOUNT_POINT}/preprod/${meetingParams.bot_uuid}`
        } else {
            this.destination_dir = `./${meetingParams.bot_uuid}`
        }
        Logger.instance = this
    }

    public async init() {
        await fs.mkdir(this.destination_dir, { recursive: true }).catch((e) => {
            this.error('Unable to create logger directory :', e)
        })
    }

    public async periodic_log_update() {
        setInterval(() => this.updateLogInterval(), LOG_UPDATE_INTERVAL);
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
            await page.screenshot({ path: link })
            // ___OLD_COPY_TO_S3___
            // await s3cp(link, link.substring(2))
        } catch (e) {
            console.error(`Failed to take screenshot ${e}`)
        }
    }

    public get_video_directory(): string {
        return `${this.destination_dir}/video.mp4`
    }

    public async upload_log_script() {
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
    }

    public async upload_log() {
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

        // ___OLD_UPLOAD_SEPARATION_SPEAKER_FILE_TO_S3
        // const linkSpeakerSeparationFile = `logs/${date}/${user_id}/${bot_id}/${d.getHours()}h-speaker_file`
        // const separationLogPath = path.join(
        //     __dirname,
        //     'SeparationSpeakerLog.txt',
        // )
        // await s3cp(separationLogPath, linkSpeakerSeparationFile).catch((e) {
        //     console.error('failed to upload speaker file', e)
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
    }

    private async updateLogInterval() {
        let source: string = process.env.LOG_FILE
        let destination: string = `${this.destination_dir}/logs.txt`
        try {
            const data = await fs.readFile(source, 'utf-8');
            await fs.writeFile(destination, data);
        } catch(error) {
            console.error(`Cannot Update log file : ${error}`);
        }
    }
}

export async function updateGrafanaAgentAddBotUuid(botUuid: string) {
    let environ: string = process.env.ENVIRON
    if (environ === 'local') {
        return
    }
    try {
        console.log('Starting config update...')

        // Mise à jour du fichier de configuration
        const sedResult = await execPromise(
            `sudo -n sed -i 's/${NODE_NAME}/${botUuid}/g' /etc/grafana-agent.yaml`,
        )

        if (sedResult.stderr) {
            console.error(
                `Erreur lors de la mise à jour du fichier de configuration : ${sedResult.stderr}`,
            )
        }

        console.log('Fichier de configuration mis à jour avec succès')

        // Rechargement de l'agent Grafana
        const reloadResult = await execPromise(
            'sudo -n systemctl restart grafana-agent.service',
        )

        if (reloadResult.stderr) {
            console.error(
                `Erreur lors du rechargement de l'agent Grafana : ${reloadResult.stderr}`,
            )
        }

        console.log('Agent Grafana rechargé avec succès')
    } catch (error) {
        console.error(`Une erreur est survenue : ${error}`)
    }
}