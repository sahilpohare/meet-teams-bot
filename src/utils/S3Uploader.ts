import { spawn } from 'child_process'
import * as fs from 'fs'
import { GLOBAL } from '../singleton'

// Singleton instance
let instance: S3Uploader | null = null

export class S3Uploader {
    private constructor() {}

    public static getInstance(): S3Uploader {
        if (GLOBAL.isServerless()) {
            console.log('Skipping S3 uploader - serverless mode')
            return null
        }

        if (!instance) {
            instance = new S3Uploader()
        }
        return instance
    }

    private async checkFileExists(filePath: string): Promise<void> {
        try {
            await fs.promises.access(filePath, fs.constants.F_OK)
        } catch (error) {
            throw new Error(`File does not exist: ${filePath}`)
        }
    }

    public async uploadFile(
        filePath: string,
        bucketName: string,
        s3Path: string,
        s3Args?: string[],
        isAudio: boolean = false,
    ): Promise<string> {
        if (GLOBAL.isServerless()) {
            console.log('Skipping S3 upload - serverless mode')
            return Promise.resolve('')
        }

        try {
            await this.checkFileExists(filePath)

            const s3FullPath = `s3://${bucketName}/${s3Path}`

            if (isAudio || !s3Args) {
                s3Args = []
            }

            s3Args.push(
                's3',
                'cp',
                filePath,
                s3FullPath,
                '--acl',
                'public-read',
            )

            return new Promise((resolve, reject) => {
                const awsProcess = spawn('aws', s3Args)
                let output = ''
                let errorOutput = ''

                awsProcess.stdout.on('data', (data) => {
                    output += data.toString()
                })

                awsProcess.stderr.on('data', (data) => {
                    errorOutput += data.toString()
                    console.error('S3 upload error:', data.toString().trim())
                })

                awsProcess.on('error', (error) => {
                    console.error(
                        'Failed to start AWS CLI process:',
                        error.message,
                    )
                    reject(
                        new Error(
                            `AWS CLI process failed to start: ${error.message}`,
                        ),
                    )
                })

                awsProcess.on('close', (code) => {
                    if (code === 0) {
                        const publicUrl = `https://${bucketName}.s3.fr-par.scw.cloud/${s3Path}`
                        resolve(publicUrl)
                    } else {
                        const errorMessage = `S3 upload failed (${code}): ${errorOutput || output}`
                        console.error(errorMessage)
                        reject(new Error(errorMessage))
                    }
                })
            })
        } catch (error: any) {
            console.error('S3 upload error:', error.message)
            throw error
        }
    }

    public async uploadToDefaultBucket(
        filePath: string,
        s3Path: string,
        s3_args: string[],
    ): Promise<string> {
        if (GLOBAL.isServerless()) {
            console.log('Skipping S3 upload - serverless mode')
            return Promise.resolve('')
        }

        try {
            return await this.uploadFile(
                filePath,
                GLOBAL.get().remote.aws_s3_log_bucket,
                s3Path,
                s3_args,
            )
        } catch (error: any) {
            console.error('Failed to upload to default bucket:', error.message)
            throw error
        }
    }

    public async uploadDirectory(
        localDir: string,
        bucketName: string,
        s3Path: string,
        s3Args?: string[],
    ): Promise<string> {
        if (GLOBAL.isServerless()) {
            console.log('Skipping S3 upload - serverless mode')
            return Promise.resolve('')
        }

        try {
            const s3FullPath = `s3://${bucketName}/${s3Path}`

            if (!s3Args) {
                s3Args = []
            }

            s3Args.push(
                's3',
                'sync',
                localDir,
                s3FullPath,
                '--acl',
                'public-read',
                '--delete', // Remove files in S3 that don't exist locally
            )

            return new Promise((resolve, reject) => {
                const awsProcess = spawn('aws', s3Args)
                let output = ''
                let errorOutput = ''

                awsProcess.stdout.on('data', (data) => {
                    output += data.toString()
                })

                awsProcess.stderr.on('data', (data) => {
                    errorOutput += data.toString()
                    console.error('S3 sync error:', data.toString().trim())
                })

                awsProcess.on('error', (error) => {
                    console.error(
                        'Failed to start AWS CLI process:',
                        error.message,
                    )
                    reject(
                        new Error(
                            `AWS CLI process failed to start: ${error.message}`,
                        ),
                    )
                })

                awsProcess.on('close', (code) => {
                    if (code === 0) {
                        const publicUrl = `https://${bucketName}.s3.fr-par.scw.cloud/${s3Path}`
                        resolve(publicUrl)
                    } else {
                        const errorMessage = `S3 sync failed (${code}): ${errorOutput || output}`
                        console.error(errorMessage)
                        reject(new Error(errorMessage))
                    }
                })
            })
        } catch (error: any) {
            console.error('S3 sync error:', error.message)
            throw error
        }
    }
}

// Export utility functions that use the singleton instance
export const s3cp = (
    local: string,
    s3path: string,
    s3_args: string[],
): Promise<string> =>
    S3Uploader.getInstance().uploadToDefaultBucket(local, s3path, s3_args)
