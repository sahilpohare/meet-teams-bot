import { ChildProcess, spawn } from 'child_process'

let environ: string = process.env.ENVIRON
const BUCKET_NAME =
    environ === 'preprod' ? 'preprod-meeting-baas-logs' : 'meeting-baas-logs'

export async function s3cp(local: string, s3path: string) {
    const s3Args = process.env.S3_ARGS ? process.env.S3_ARGS.split(' ') : []
    const args = environ !== 'local' ? [] : s3Args
    await new Promise<void>((res, rej) => {
        const command: ChildProcess = spawn('aws', [
            ...args,
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
