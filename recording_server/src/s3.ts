import { ChildProcess, spawn } from 'child_process'

export const BUCKET_NAME = 'meeting-baas-debug '

export async function s3cp(local: string, s3path: string) {
    await new Promise<void>((res, rej) => {
        const command: ChildProcess = spawn('aws', [
            's3',
            'cp',
            '--acl',
            'public-read',
            local,
            `s3://${BUCKET_NAME}/${s3path}`,
        ])
        command.on('close', (state) => {
            if (state === 0) {
                res()
            } else {
                console.error('Bad return value : ', state)
                rej()
            }
        })
        command.on('error', (err) => {
            console.error('s3cp error:', err)
            rej()
        })
    })
}
