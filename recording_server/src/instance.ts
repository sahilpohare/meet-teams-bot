import axios from 'axios'
import { LOGGER } from './server'
import { exec } from 'child_process'
import { axiosRetry } from './axiosRetry'
import { PROJECT_ID } from './server'

const LOCAL = process.env.ZOOM_LOCAL === 'true'
export const PORT = 8080
const SERVICE_HANDLER_BASEURL = process.env.SERVICE_HANDLER_BASEURL
const LOCK_INSTANCE_AT_STARTUP = process.env.LOCK_INSTANCE_AT_STARTUP === 'true'
export const API_SERVER_BASEURL = process.env.API_SERVER_BASEURL
const SERVICE_NAME = process.env.SERVICE_NAME
const POD_NAME = process.env.POD_NAME
const POD_IP = `${process.env.POD_IP}:${PORT}`

export function setProtection(enabled: boolean): Promise<void> {
    return new Promise((res, _rej) => {
        if (!LOCK_INSTANCE_AT_STARTUP) {
            if (enabled) {
                exec('set_protection.sh on', (_error, _stdout, _stderr) => {
                    LOGGER.info(`Set protection`, {
                        enabled: enabled,
                        stdout: _stdout,
                        stderr: _stderr,
                    })
                    res()
                })
            } else {
                exec('set_protection.sh off', (_error, _stdout, _stderr) => {
                    LOGGER.info(`Set protection`, {
                        enabled: enabled,
                        stdout: _stdout,
                        stderr: _stderr,
                    })
                    res()
                })
            }
        } else {
            res()
        }
    })
}

export async function terminateInstance() {
    try {
        await new Promise<void>((res, _rej) => {
            exec(
                `upload_log.sh ${PROJECT_ID ?? ''}`,
                (_error, stdout, stderr) => {
                    LOGGER.info(`upload log`, { stdout, stderr })
                    res()
                },
            )
        })
    } catch (e) {
        console.error('fail to upload logs: ', e)
    }
    await new Promise<void>((res, _rej) => {
        exec('terminate_instance.sh', (_error, stdout, stderr) => {
            LOGGER.info(`terminate instance`, { stdout, stderr })
            res()
        })
    })
    process.exit(0)
}
