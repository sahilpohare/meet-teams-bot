import { spawn } from 'child_process'
import { EventEmitter } from 'events'
import * as path from 'path'

export class S3Uploader extends EventEmitter {
    private environment: string
    private defaultBucketName: string

    constructor() {
        super()
        this.environment = process.env.ENVIRON || 'local'
        this.defaultBucketName = this.environment === 'preprod' 
            ? 'preprod-meeting-baas-logs' 
            : 'meeting-baas-logs'
    }

    public async uploadFile(
        filePath: string,
        bucketName: string,
        s3Path: string,
        isAudio: boolean = false,
    ): Promise<string> {
        const s3FullPath = `s3://${bucketName}/${s3Path}`

        return new Promise((resolve, reject) => {
            const s3Args: string[] = []

            if (!isAudio && process.env.S3_ARGS) {
                s3Args.push(...process.env.S3_ARGS.split(' '))
            }

            s3Args.push(
                's3',
                'cp',
                filePath,
                s3FullPath,
                '--acl',
                'public-read',
            )

            const awsProcess = spawn('aws', s3Args)
            let output = ''

            awsProcess.stdout.on('data', (data) => {
                output += data.toString()
                this.emit('progress', data.toString())
            })
            awsProcess.stderr.on('data', (data) => {
                output += data.toString()
                this.emit('error', data.toString())
            })

            awsProcess.on('close', (code) => {
                if (code === 0) {
                    const publicUrl = `https://${bucketName}.s3.amazonaws.com/${s3Path}`
                    resolve(publicUrl)
                } else {
                    reject(new Error(`S3 upload failed (${code}): ${output}`))
                }
            })
        })
    }

    public async uploadToDefaultBucket(
        filePath: string,
        s3Path: string,
    ): Promise<string> {
        return this.uploadFile(filePath, this.defaultBucketName, s3Path)
    }

    public async uploadDirectory(
        localDir: string,
        bucketName: string,
        s3Prefix: string,
    ): Promise<string[]> {
        const fs = require('fs')
        const files = await fs.promises.readdir(localDir)
        const uploadPromises: Promise<string>[] = []

        for (const file of files) {
            const localPath = path.join(localDir, file)
            const stats = await fs.promises.stat(localPath)
            
            if (stats.isFile()) {
                const s3Path = `${s3Prefix}/${file}`
                uploadPromises.push(this.uploadFile(localPath, bucketName, s3Path))
            }
        }

        return Promise.all(uploadPromises)
    }
}
