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

export async function unlockInstance() {
    if (!LOCK_INSTANCE_AT_STARTUP && !LOCAL) {
        await axios({
            method: 'post',
            url: `${SERVICE_HANDLER_BASEURL}/service/update`,
            data: {
                pod_name: POD_NAME,
                service_name: SERVICE_NAME,
                update_metadata: true,
                metadata: {
                    owner_id: null,
                },
            },
        })
    }
}

export async function detachZoomSession(session_id: string) {
    console.log('detaching zoom session: ')
    try {
        await axios({
            method: 'POST',
            url: `${SERVICE_HANDLER_BASEURL}/service/detach_meeting_bot_session`,
            data: {
                session_id,
            },
        })
    } catch (e) {
        console.error('[detachZoomSession] error detaching zoom session', e)
    }
    if (LOCK_INSTANCE_AT_STARTUP) {
        console.log('terminating instance')
        await terminateInstance()
    }
}

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

export async function registerInstance() {
    if (!LOCAL) {
        LOGGER.info(`Registering instance to service controller`)
        // Send a POST request
        await axios({
            method: 'post',
            url: `${SERVICE_HANDLER_BASEURL}/service/register`,
            data: {
                pod_name: POD_NAME,
                service_name: SERVICE_NAME,
                pod_private_ip: POD_IP,
                max_liveness_probe_interval: 120,
                metadata: {
                    owner_id: LOCK_INSTANCE_AT_STARTUP ? 1 : null,
                },
            },
        })
    }
}

export async function terminateInstance() {
    await deregisterInstance()
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

export async function deregisterInstance() {
    await axiosRetry({
        method: 'post',
        url: `${SERVICE_HANDLER_BASEURL}/service/deregister`,
        data: {
            pod_name: POD_NAME,
            service_name: SERVICE_NAME,
        },
    })
}

let REFRESH_INSTANCE_FAILED_COUNTER = 0

export async function refreshInstance() {
    if (!LOCAL) {
        try {
            await axios({
                method: 'post',
                url: `${SERVICE_HANDLER_BASEURL}/service/update`,
                data: {
                    pod_name: POD_NAME,
                    service_name: SERVICE_NAME,
                    update_metadata: false,
                    metadata: null,
                },
            })
            REFRESH_INSTANCE_FAILED_COUNTER = 0
        } catch (e) {
            console.error(
                'refresh instance failed: ',
                // { PROJECT_ID, REFRESH_INSTANCE_FAILED_COUNTER },
                // 'error: ',
                // e,
            )
            REFRESH_INSTANCE_FAILED_COUNTER += 1
            if (REFRESH_INSTANCE_FAILED_COUNTER > 10 && PROJECT_ID == null) {
                await terminateInstance()
            }
        }
    }
}
