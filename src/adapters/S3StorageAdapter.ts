import { StorageAdapter } from './StorageAdapter'
import { S3Uploader } from '../utils/S3Uploader'

/**
 * AWS S3 storage adapter
 */
export class S3StorageAdapter implements StorageAdapter {
    private s3Uploader: S3Uploader

    constructor() {
        const uploader = S3Uploader.getInstance()
        if (!uploader) {
            throw new Error('S3Uploader not available')
        }
        this.s3Uploader = uploader
    }

    async uploadFile(filePath: string, bucket: string, s3Key: string): Promise<void> {
        await this.s3Uploader.uploadFile(filePath, bucket, s3Key)
    }

    async uploadDirectory(localDir: string, bucket: string, s3Prefix: string): Promise<void> {
        await this.s3Uploader.uploadDirectory(localDir, bucket, s3Prefix)
    }

    // S3 buckets are assumed to exist, so this is a no-op
    async ensureContainerExists(bucket: string): Promise<void> {
        // No-op for S3
    }
}