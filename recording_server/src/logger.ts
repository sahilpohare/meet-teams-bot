import { BUCKET_NAME, s3cp } from './s3'

import axios from 'axios'
import { exec } from 'child_process'
import * as fs from 'fs/promises'

import * as path from 'path'
import { getFiles } from './utils'
const util = require('util')
const execPromise = util.promisify(exec)

export async function uploadLog(
    user_id: number,
    email: string,
    bot_id?: string,
) {
    const date = new Date()
        .toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'numeric',
            day: 'numeric',
        })
        .replace(/\//g, '-')
    const d = new Date()

    const link = `logs/${date}/${user_id}/${bot_id}/${d.getHours()}h${d.getMinutes()}`

    const linkSpeakerSeparationFile = `logs/${date}/${user_id}/${bot_id}/${d.getHours()}h-speaker_file`
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
            )}&bot_id=${bot_id}&user_id=${user_id}&screenshots=${encodeURIComponent(
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

export function uploadLogScript(bot_id: string) {
    return new Promise<void>((res, _rej) => {
        exec(`upload_log.sh ${bot_id ?? ''}`, (_error, stdout, stderr) => {
            console.log(`upload log`, { stdout, stderr })
            res()
        })
    })
}

export async function updateGrafanaAgentAddBotUuid(botUuid: string) {
    try {
        console.log('Starting config update...')

        // Mise à jour du fichier de configuration
        const sedResult = await execPromise(
            `sudo sed -i 's/BOT_UUID_PLACEHOLDER/${botUuid}/g' /etc/grafana-agent.yaml`,
        )

        if (sedResult.stderr) {
            console.error(
                `Erreur lors de la mise à jour du fichier de configuration : ${sedResult.stderr}`,
            )
        }

        console.log('Fichier de configuration mis à jour avec succès')

        // Rechargement de l'agent Grafana
        const reloadResult = await execPromise(
            'sudo systemctl restart grafana-agent.service',
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
