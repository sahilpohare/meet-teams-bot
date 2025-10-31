import { BlobServiceClient, StorageSharedKeyCredential } from '@azure/storage-blob'
import * as fs from 'fs'
import * as path from 'path'
import { GLOBAL } from '../singleton'

// Singleton instance
let instance: AzureBlobUploader | null = null

// Controlled concurrency: process files in batches to avoid overwhelming the system
const MAX_CONCURRENT_UPLOADS = 100 // Limit concurrent uploads

export class AzureBlobUploader {
    private blobServiceClient: BlobServiceClient

    private constructor() {
        // Azure SDK automatically detects:
        // - Connection string from AZURE_STORAGE_CONNECTION_STRING
        // - Account name and key from AZURE_STORAGE_ACCOUNT_NAME and AZURE_STORAGE_ACCOUNT_KEY
        // - SAS token from environment variables
        const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING
        const accountName = process.env.AZURE_STORAGE_ACCOUNT_NAME
        const accountKey = process.env.AZURE_STORAGE_ACCOUNT_KEY

        if (connectionString) {
            this.blobServiceClient = BlobServiceClient.fromConnectionString(connectionString)
        } else if (accountName && accountKey) {
            const sharedKeyCredential = new StorageSharedKeyCredential(accountName, accountKey)
            this.blobServiceClient = new BlobServiceClient(
                `https://${accountName}.blob.core.windows.net`,
                sharedKeyCredential
            )
        } else {
            throw new Error(
                'Azure Blob Storage credentials not found. Set AZURE_STORAGE_CONNECTION_STRING or AZURE_STORAGE_ACCOUNT_NAME + AZURE_STORAGE_ACCOUNT_KEY'
            )
        }
    }

    public static getInstance(): AzureBlobUploader | null {
        if (GLOBAL.isServerless()) {
            console.log('Skipping Azure Blob uploader - serverless mode')
            return null
        }

        try {
            if (!instance) {
                instance = new AzureBlobUploader()
            }
            return instance
        } catch (error) {
            console.warn('Azure Blob uploader not available:', error)
            return null
        }
    }

    public async uploadFile(
        filePath: string,
        containerName: string,
        blobPath: string,
    ): Promise<void> {
        if (GLOBAL.isServerless()) {
            console.log('Skipping Azure Blob upload - serverless mode')
            return
        }

        try {
            const containerClient = this.blobServiceClient.getContainerClient(containerName)
            const blockBlobClient = containerClient.getBlockBlobClient(blobPath)

            // Upload file with automatic retry and progress tracking
            const uploadResponse = await blockBlobClient.uploadFile(filePath, {
                blockSize: 4 * 1024 * 1024, // 4MB blocks
                concurrency: 20, // Parallel uploads
                onProgress: (progress) => {
                    if (progress.loadedBytes && progress.loadedBytes > 0) {
                        const percentage = ((progress.loadedBytes / (fs.statSync(filePath).size)) * 100).toFixed(1)
                        if (progress.loadedBytes % (10 * 1024 * 1024) === 0) { // Log every 10MB
                            console.log(`📤 Uploading ${path.basename(filePath)}: ${percentage}%`)
                        }
                    }
                }
            })

            console.log(`✅ Azure Blob upload successful: ${blobPath}`)
        } catch (error) {
            console.error(
                `Azure Blob upload error for ${filePath} container ${containerName} blobPath ${blobPath}`,
                error,
            )
            throw error
        }
    }

    public async uploadToDefaultContainer(
        filePath: string,
        blobPath: string,
    ): Promise<void> {
        if (GLOBAL.isServerless()) {
            console.log('Skipping Azure Blob upload - serverless mode')
            return
        }

        const containerName = GLOBAL.get().azure_storage?.container_name
        if (!containerName) {
            console.warn(
                'Skipping Azure Blob upload - container_name not configured',
            )
            return
        }
        await this.uploadFile(filePath, containerName, blobPath)
    }

    public async uploadDirectory(
        localDir: string,
        containerName: string,
        blobPath: string,
    ): Promise<void> {
        if (GLOBAL.isServerless()) {
            console.log('Skipping Azure Blob upload - serverless mode')
            return
        }

        try {
            // Get list of files in local directory (flat structure, no recursion needed)
            const items = await fs.promises.readdir(localDir, {
                withFileTypes: true,
            })
            const files = items
                .filter((item) => item.isFile())
                .map((item) => path.join(localDir, item.name))

            if (files.length === 0) {
                console.log('No files found in directory:', localDir)
                return
            }

            console.log(`Starting bulk upload of ${files.length} files to Azure Blob...`)

            const results: Array<{
                success: boolean
                file: string
                error?: string
            }> = []

            // Process files in batches
            for (let i = 0; i < files.length; i += MAX_CONCURRENT_UPLOADS) {
                const batch = files.slice(i, i + MAX_CONCURRENT_UPLOADS)
                const batchNumber = Math.floor(i / MAX_CONCURRENT_UPLOADS) + 1
                const totalBatches = Math.ceil(
                    files.length / MAX_CONCURRENT_UPLOADS,
                )

                console.log(
                    `Processing batch ${batchNumber}/${totalBatches} (${batch.length} files)...`,
                )

                // Upload batch concurrently using our existing uploadFile function
                const batchPromises = batch.map(async (file) => {
                    const filename = path.basename(file)
                    const blobKey = `${blobPath}/${filename}`

                    try {
                        await this.uploadFile(file, containerName, blobKey)
                        return { success: true, file: filename }
                    } catch (error: any) {
                        // Error is already logged in uploadFile
                        return {
                            success: false,
                            file: filename,
                            error: error.message,
                        }
                    }
                })

                // Wait for batch to complete before starting next batch
                const batchResults = await Promise.all(batchPromises)
                const batchSuccesses = batchResults.filter(
                    (r) => r.success,
                ).length
                const batchFailures = batchResults.length - batchSuccesses

                console.log(
                    `Batch ${batchNumber} complete: ${batchSuccesses} successful, ${batchFailures} failed`,
                )

                // Collect results
                results.push(...batchResults)
            }

            // Count total successes and failures
            const successful = results.filter((r) => r.success).length
            const failed = results.filter((r) => !r.success).length

            console.log(
                `Total upload summary: ${successful} successful, ${failed} failed`,
            )

            if (failed > 0) {
                throw new Error(`Bulk upload completed with ${failed} failures`)
            }
        } catch (error) {
            console.error('Azure Blob sync error:', error)
            throw error
        }
    }

    public async createContainerIfNotExists(containerName: string): Promise<void> {
        try {
            const containerClient = this.blobServiceClient.getContainerClient(containerName)
            await containerClient.createIfNotExists({
                access: 'blob' // Public read access for blobs
            })
            console.log(`✅ Azure Blob container ready: ${containerName}`)
        } catch (error) {
            console.error(`Failed to create Azure Blob container ${containerName}:`, error)
            throw error
        }
    }
}

// Export utility functions that use the singleton instance
export const azureBlobCp = (local: string, blobPath: string): Promise<void> => {
    const uploader = AzureBlobUploader.getInstance()
    return uploader ? uploader.uploadToDefaultContainer(local, blobPath) : Promise.resolve()
}