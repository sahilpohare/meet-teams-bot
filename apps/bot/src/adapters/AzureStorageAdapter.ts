import { StorageAdapter } from './StorageAdapter'
import { AzureBlobUploader } from '../utils/AzureBlobUploader'

/**
 * Azure Blob Storage adapter
 */
export class AzureStorageAdapter implements StorageAdapter {
    private azureUploader: AzureBlobUploader

    constructor() {
        const uploader = AzureBlobUploader.getInstance()
        if (!uploader) {
            throw new Error('AzureBlobUploader not available')
        }
        this.azureUploader = uploader
    }

    async uploadFile(filePath: string, container: string, blobPath: string): Promise<void> {
        await this.azureUploader.uploadFile(filePath, container, blobPath)
    }

    async uploadDirectory(localDir: string, container: string, blobPrefix: string): Promise<void> {
        await this.azureUploader.uploadDirectory(localDir, container, blobPrefix)
    }

    async ensureContainerExists(container: string): Promise<void> {
        await this.azureUploader.createContainerIfNotExists(container)
    }
}