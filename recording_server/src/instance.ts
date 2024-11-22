import { exec } from 'child_process'
import { Logger } from './logger'
import { clientRedis } from './server'

export const PORT = 8080
export const LOCK_INSTANCE_AT_STARTUP =
    process.env.LOCK_INSTANCE_AT_STARTUP === 'true'
export const API_SERVER_BASEURL = process.env.API_SERVER_BASEURL
export const POD_IP = `${process.env.POD_IP}:${PORT}`
export const LOCAL_RECORDING_SERVER_LOCATION = `http://localhost:${PORT}/`

export type MeetingBotSession = {
    user_id: number
    bot_ip: string
    meeting_url: string
}

export const REDIS_SESSION_EXPIRATION = 3600 * 5

export async function setSessionInRedis(
    session_id: string,
    session: MeetingBotSession,
): Promise<string> {
    const res = await clientRedis.set(session_id, JSON.stringify(session))
    await clientRedis.expire(session_id, REDIS_SESSION_EXPIRATION)
    return res
}

export async function delSessionInRedis(session_id: string): Promise<number> {
    return await clientRedis.del(session_id)
}

export function setProtection(enabled: boolean): Promise<void> {
    return new Promise((res, _rej) => {
        if (!LOCK_INSTANCE_AT_STARTUP) {
            if (enabled) {
                exec('set_protection.sh on', (_error, _stdout, _stderr) => {
                    console.log(`Set protection`, {
                        enabled: enabled,
                        stdout: _stdout,
                        stderr: _stderr,
                    })
                    res()
                })
            } else {
                exec('set_protection.sh off', (_error, _stdout, _stderr) => {
                    console.log(`Set protection`, {
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
        await Logger.instance.upload_log()
    } catch (e) {
        console.error('fail to upload logs: ', e)
    }
    await new Promise<void>((res, _rej) => {
        exec('terminate_instance.sh', (_error, stdout, stderr) => {
            console.log(`terminate instance`, { stdout, stderr })
            res()
        })
    })
    process.exit(0)
}
