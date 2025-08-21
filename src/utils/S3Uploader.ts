import { DeleteObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import * as fs from 'fs'
import { GLOBAL } from '../singleton'

// Singleton instance
let instance: S3Uploader | null = null

// Default S3 endpoint for Scaleway in fr-par region
const S3_ENDPOINT = process.env.S3_ENDPOINT || 's3.fr-par.scw.cloud'

export class S3Uploader {
    private s3Client: S3Client

    private constructor() {
        // Initialize S3 client with configuration
        const config: any = {
            region: process.env.AWS_REGION || 'fr-par',
        }

        // If using custom endpoint (like Scaleway), configure it
        if (S3_ENDPOINT !== 's3.amazonaws.com') {
            config.endpoint = `https://${S3_ENDPOINT}`
            config.forcePathStyle = true // Required for custom endpoints
        }

        // Add credentials if provided
        if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
            config.credentials = {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
            }
        }

        this.s3Client = new S3Client(config)
    }

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

    private getS3Args(s3Args?: string[]): string[] {
        // Order of precedence for s3Args:
        // 1. Provided s3Args argument (if non-empty)
        // 2. GLOBAL.get().remote?.s3_args (if non-empty)
        // 3. process.env.S3_ARGS (if set)
        // 4. []
        let finalS3Args: string[] = []
        if (s3Args && s3Args.length > 0) {
            finalS3Args = s3Args
        } else if (
            GLOBAL.get().remote?.s3_args &&
            GLOBAL.get().remote.s3_args.length > 0
        ) {
            finalS3Args = GLOBAL.get().remote.s3_args
        } else if (process.env.S3_ARGS) {
            finalS3Args = process.env.S3_ARGS.split(' ')
        }
        return finalS3Args
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

            s3Args = this.getS3Args(s3Args)

            // Create the full command array
            const fullArgs = [
                ...s3Args,
                's3',
                'cp',
                filePath,
                s3FullPath
            ]

            console.log('🔍 S3 upload command:', 'aws', fullArgs.join(' '))

            // Use AWS SDK
            const fileContent = await fs.promises.readFile(filePath)
            
            const command = new PutObjectCommand({
                Bucket: bucketName,
                Key: s3Path,
                Body: fileContent,
                ACL: 'public-read',
            })

            await this.s3Client.send(command)
            
            const publicUrl = `https://${bucketName}.${S3_ENDPOINT}/${s3Path}`
            return publicUrl
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

            s3Args = this.getS3Args(s3Args)

            // Create the full command array
            const fullArgs = [
                ...s3Args,
                's3',
                'sync',
                localDir,
                s3FullPath,
                '--delete', // Remove files in S3 that don't exist locally
            ]

            console.log('🔍 S3 sync command:', 'aws', fullArgs.join(' '))

            // Use AWS SDK
            // Get list of files in local directory
            const files = await this.getFilesRecursively(localDir)
            
            // Upload each file
            for (const file of files) {
                const relativePath = file.replace(localDir, '').replace(/^\/+/, '')
                const s3Key = `${s3Path}/${relativePath}`.replace(/\/+/g, '/')
                
                await this.uploadFile(file, bucketName, s3Key, s3Args)
            }

            // Handle deletion of files in S3 that don't exist locally (if --delete was specified)
            if (s3Args?.includes('--delete')) {
                await this.cleanupS3Directory(bucketName, s3Path, files, localDir)
            }

            const publicUrl = `https://${bucketName}.${S3_ENDPOINT}/${s3Path}`
            return publicUrl
        } catch (error: any) {
            console.error('S3 sync error:', error.message)
            throw error
        }
    }

    private async getFilesRecursively(dir: string): Promise<string[]> {
        const files: string[] = []
        
        const items = await fs.promises.readdir(dir, { withFileTypes: true })
        
        for (const item of items) {
            const fullPath = `${dir}/${item.name}`
            
            if (item.isDirectory()) {
                files.push(...(await this.getFilesRecursively(fullPath)))
            } else {
                files.push(fullPath)
            }
        }
        
        return files
    }

    private async cleanupS3Directory(
        bucketName: string, 
        s3Path: string, 
        localFiles: string[], 
        localDir: string
    ): Promise<void> {
        try {
            // List objects in S3 directory
            const command = new ListObjectsV2Command({
                Bucket: bucketName,
                Prefix: s3Path,
            })
            
            const response = await this.s3Client.send(command)
            
            if (!response.Contents) return
            
            for (const object of response.Contents) {
                if (!object.Key) continue
                
                // Check if this S3 object corresponds to a local file
                const relativeS3Path = object.Key.replace(s3Path, '').replace(/^\/+/, '')
                const correspondingLocalFile = `${localDir}/${relativeS3Path}`
                
                if (!localFiles.includes(correspondingLocalFile)) {
                    // Delete S3 object that doesn't exist locally
                    const deleteCommand = new DeleteObjectCommand({
                        Bucket: bucketName,
                        Key: object.Key,
                    })
                    
                    await this.s3Client.send(deleteCommand)
                    console.log(`🗑️ Deleted S3 object: ${object.Key}`)
                }
            }
        } catch (error) {
            console.warn('Warning: Could not cleanup S3 directory:', error)
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
