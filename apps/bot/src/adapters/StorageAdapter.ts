/**
 * Common interface for all storage providers
 */
export interface StorageAdapter {
    uploadFile(filePath: string, container: string, remotePath: string): Promise<void>
    uploadDirectory(localDir: string, container: string, remotePath: string): Promise<void>
    ensureContainerExists?(container: string): Promise<void>
}

/**
 * Storage provider factory that returns the appropriate adapter
 */
export class StorageProviderFactory {
    static async getProvider(provider: 'aws' | 'azure'): Promise<StorageAdapter> {
        switch (provider) {
            case 'aws':
                const { S3StorageAdapter } = await import('./S3StorageAdapter')
                return new S3StorageAdapter()
            case 'azure':
                const { AzureStorageAdapter } = await import('./AzureStorageAdapter')
                return new AzureStorageAdapter()
            default:
                throw new Error(`Unsupported storage provider: ${provider}`)
        }
    }
}