import { LOGGER } from './server'
import { exec } from 'child_process'
import { clientRedis } from './server'
import { uploadLogScript } from './logger'

export const PORT = 8080
export const LOCK_INSTANCE_AT_STARTUP =
    process.env.LOCK_INSTANCE_AT_STARTUP === 'true'
export const API_SERVER_BASEURL = process.env.API_SERVER_BASEURL
const POD_IP = `${process.env.POD_IP}:${PORT}`
export const MEETING_BOT_SESSION_KEY = 'meeting_bot_session'

export function setSessionInRedis(session_id: string) {
    return clientRedis.hset(MEETING_BOT_SESSION_KEY, session_id, POD_IP)
}

export function delSessionInRedis(session_id: string) {
    return clientRedis.hdel(MEETING_BOT_SESSION_KEY, session_id)
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

export async function terminateInstance() {
    try {
        await uploadLogScript()
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
