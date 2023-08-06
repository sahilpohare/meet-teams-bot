import { spawn, exec } from "child_process"

export const BUCKET_NAME = 'spoke-log-bot'
export async function s3cp(local: string, s3path: string) {
    await (new Promise<void>((res, _rej) => {
        const command = spawn('aws', ["s3", "cp", "--acl", "public-read", local, `s3://${BUCKET_NAME}/${s3path}`])
        command.on('close', () => {
            res()
        })
    }))

}
