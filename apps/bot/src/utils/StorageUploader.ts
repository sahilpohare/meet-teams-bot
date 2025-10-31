import { StorageAdapter, StorageProviderFactory } from '../adapters/StorageAdapter'
import { GLOBAL } from '../singleton'

/**
 * Unified storage uploader that uses adapter pattern for different providers
 * Supports custom path templates for organized storage
 */
export class StorageUploader {
    private adapters: Map<string, StorageAdapter> = new Map()

    /**
     * Get storage adapter for the current request
     */
    private async getAdapter(): Promise<StorageAdapter> {
        if (GLOBAL.isServerless()) {
            throw new Error('Storage not available in serverless mode')
        }

        const provider = GLOBAL.get().storage_provider || 'aws'
        
        // Cache adapters per provider
        if (!this.adapters.has(provider)) {
            const adapter = await StorageProviderFactory.getProvider(provider)
            this.adapters.set(provider, adapter)
        }
        
        return this.adapters.get(provider)!
    }

    /**
     * Upload file with custom path template support
     */
    public async uploadFile(
        filePath: string,
        fileType: 'video' | 'audio' | 'chunk',
        fileName: string,
        customVariables?: Record<string, string>
    ): Promise<void> {
        const adapter = await this.getAdapter()
        const provider = GLOBAL.get().storage_provider || 'aws'
        
        if (provider === 'azure') {
            const container = GLOBAL.get().azure_storage?.container_name
            if (!container) {
                throw new Error('Azure container_name not configured')
            }

            const blobPath = this.buildAzureBlobPath(fileType, fileName, customVariables)
            await adapter.uploadFile(filePath, container, blobPath)
        } else {
            // AWS S3 - use existing bucket structure
            const bucketName = this.getS3Bucket(fileType)
            const s3Key = this.buildS3Key(fileType, fileName)
            await adapter.uploadFile(filePath, bucketName, s3Key)
        }
    }

    /**
     * Build Azure blob path using template and variables
     */
    private buildAzureBlobPath(
        fileType: 'video' | 'audio' | 'chunk',
        fileName: string,
        customVariables?: Record<string, string>
    ): string {
        const template = GLOBAL.get().azure_storage?.blob_path_template || '/{bot_uuid}'
        const botUuid = GLOBAL.get().bot_uuid
        const meetingUrl = GLOBAL.get().meeting_url
        
        // Extract meeting ID from URL for template variable
        const meetingId = this.extractMeetingId(meetingUrl)
        
        // Default variables
        const variables: Record<string, string> = {
            bot_uuid: botUuid,
            meeting_id: meetingId,
            file_type: fileType,
            ...customVariables
        }

        // Replace template variables
        let path = template
        Object.entries(variables).forEach(([key, value]) => {
            path = path.replace(new RegExp(`{${key}}`, 'g'), value)
        })

        // Ensure path starts with / and append filename
        if (!path.startsWith('/')) {
            path = '/' + path
        }
        if (!path.endsWith('/')) {
            path += '/'
        }
        
        return path + fileName
    }

    /**
     * Build S3 key for existing structure
     */
    private buildS3Key(fileType: 'video' | 'audio' | 'chunk', fileName: string): string {
        const botUuid = GLOBAL.get().bot_uuid
        
        if (fileType === 'chunk') {
            return `${botUuid}/${fileName}`
        } else {
            // For video/audio, use identifier
            const identifier = botUuid // or PathManager.getInstance().getIdentifier()
            return `${identifier}.${fileName.split('.').pop()}`
        }
    }

    /**
     * Get appropriate S3 bucket based on file type
     */
    private getS3Bucket(fileType: 'video' | 'audio' | 'chunk'): string {
        switch (fileType) {
            case 'video':
                return GLOBAL.get().remote?.aws_s3_video_bucket || 'default-video-bucket'
            case 'audio':
                return GLOBAL.get().remote?.aws_s3_video_bucket || 'default-video-bucket' // Same as video
            case 'chunk':
                return GLOBAL.get().aws_s3_temporary_audio_bucket || 'default-audio-bucket'
            default:
                throw new Error(`Unknown file type: ${fileType}`)
        }
    }

    /**
     * Extract meeting ID from meeting URL
     */
    private extractMeetingId(meetingUrl: string): string {
        try {
            const url = new URL(meetingUrl)
            
            // Google Meet: https://meet.google.com/abc-def-ghi
            if (url.hostname.includes('meet.google.com')) {
                return url.pathname.substring(1) // Remove leading /
            }
            
            // Teams: extract from various Teams URL formats
            if (url.hostname.includes('teams.microsoft.com')) {
                const pathParts = url.pathname.split('/')
                const meetingIndex = pathParts.findIndex(part => part === 'meetup-join')
                if (meetingIndex !== -1 && meetingIndex + 1 < pathParts.length) {
                    return pathParts[meetingIndex + 1]
                }
            }
            
            // Fallback: use full path without slashes
            return url.pathname.replace(/\//g, '_').substring(1)
        } catch (error) {
            // Fallback: use bot UUID if URL parsing fails
            return GLOBAL.get().bot_uuid
        }
    }

    /**
     * Create container/bucket if it doesn't exist (Azure only)
     */
    public async ensureContainerExists(): Promise<void> {
        const adapter = await this.getAdapter()
        const provider = GLOBAL.get().storage_provider || 'aws'
        
        if (provider === 'azure') {
            const containerName = GLOBAL.get().azure_storage?.container_name
            if (!containerName) {
                throw new Error('Azure container_name not configured')
            }
            
            if (adapter.ensureContainerExists) {
                await adapter.ensureContainerExists(containerName)
            }
        }
        // S3 buckets are assumed to already exist
    }

    /**
     * Legacy method for backward compatibility
     */
    public async uploadDirectory(
        localDir: string,
        container: string,
        remotePath: string,
    ): Promise<void> {
        const adapter = await this.getAdapter()
        await adapter.uploadDirectory(localDir, container, remotePath)
    }

    /**
     * Get audio container/bucket name based on storage provider
     */
    public getAudioContainer(): string {
        const provider = GLOBAL.get().storage_provider || 'aws'

        if (provider === 'azure') {
            const containerName = GLOBAL.get().azure_storage?.container_name
            if (!containerName) {
                throw new Error('Azure container_name not configured')
            }
            return containerName
        } else {
            // AWS S3 - return audio bucket
            return GLOBAL.get().aws_s3_temporary_audio_bucket || 'default-audio-bucket'
        }
    }

    /**
     * Static factory method for getting uploader instance
     */
    public static getInstance(): StorageUploader | null {
        if (GLOBAL.isServerless()) {
            console.log('Skipping storage uploader - serverless mode')
            return null
        }
        return new StorageUploader()
    }
}