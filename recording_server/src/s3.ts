import { exec, spawn } from 'child_process'

export const BUCKET_NAME = 'spoke-log-bot'
export async function s3cp(local: string, s3path: string) {
    await new Promise<void>((res, rej) => {
        const command = spawn('aws', [
            's3',
            'cp',
            '--acl',
            'public-read',
            local,
            `s3://${BUCKET_NAME}/${s3path}`,
        ])
        command.on('close', () => {
            res()
        })
        command.on('error', (err) => {
            console.error('s3cp error:', err)
            rej()
        })
    })
}
