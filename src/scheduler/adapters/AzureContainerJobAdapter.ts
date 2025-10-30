/**
 * Azure Container Apps Jobs Adapter
 * Provisions containers using Azure Container Apps Jobs
 */

import { IContainerAdapter } from './ContainerAdapter'
import { ContainerConfig, ProvisionResult } from '../types'
import { logger } from '../utils/logger'
import { ContainerAppsAPIClient } from '@azure/arm-appcontainers'
import { DefaultAzureCredential } from '@azure/identity'

export class AzureContainerJobAdapter implements IContainerAdapter {
    private resourceGroup: string
    private containerAppJobName: string
    private location: string
    private client: ContainerAppsAPIClient | null = null
    private subscriptionId: string

    constructor(config: {
        resourceGroup: string
        containerAppJobName: string
        location?: string
        subscriptionId?: string
    }) {
        this.resourceGroup = config.resourceGroup
        this.containerAppJobName = config.containerAppJobName
        this.location = config.location || 'eastus'
        this.subscriptionId = config.subscriptionId || process.env.AZURE_SUBSCRIPTION_ID || ''
    }

    private async getClient(): Promise<ContainerAppsAPIClient> {
        if (!this.client) {
            if (!this.subscriptionId) {
                throw new Error('AZURE_SUBSCRIPTION_ID environment variable is required')
            }
            const credential = new DefaultAzureCredential()
            this.client = new ContainerAppsAPIClient(credential, this.subscriptionId)
            logger.info('[Azure] Container Apps API client initialized')
        }
        return this.client
    }

    async provision(config: ContainerConfig): Promise<ProvisionResult> {
        logger.info(
            `[Azure] Provisioning container job for ${config.jobConfig.id}`,
        )

        try {
            const client = await this.getClient()
            const jobExecutionName = `exec-${config.jobConfig.id.substring(0, 8)}-${Date.now()}`

            // Prepare bot configuration as JSON string for env var
            const botConfigJson = JSON.stringify(config.jobConfig.config)

            // Build environment variables
            const envVars = [
                { name: 'BOT_CONFIG', value: botConfigJson },
                { name: 'MEETING_URL', value: config.jobConfig.meetingUrl },
                { name: 'BOT_NAME', value: config.jobConfig.botName || 'Recording Bot' },
                { name: 'RECORDING', value: config.env?.RECORDING || 'true' },
                ...this.formatEnvVars(config.env || {}),
            ]

            logger.info(`[Azure] Starting job execution:`, {
                jobName: this.containerAppJobName,
                executionName: jobExecutionName,
                image: config.image,
                resourceGroup: this.resourceGroup,
            })

            // Start the Container Apps Job execution
            const result = await client.jobs.beginStartAndWait(
                this.resourceGroup,
                this.containerAppJobName,
                {
                    template: {
                        containers: [
                            {
                                name: 'meeting-bot',
                                image: config.image,
                                resources: {
                                    cpu: parseFloat(config.cpu || '1.0'),
                                    memory: config.memory || '2Gi',
                                },
                                env: envVars,
                            },
                        ],
                    },
                }
            )

            logger.info(`[Azure] Job execution started:`, {
                executionName: result.name,
            })

            return {
                containerId: result.name || jobExecutionName,
                status: 'success',
                message: 'Azure Container Job started successfully',
                metadata: {
                    platform: 'azure',
                    resourceGroup: this.resourceGroup,
                    jobName: this.containerAppJobName,
                    executionName: result.name,
                },
            }
        } catch (error) {
            logger.error(`[Azure] Failed to provision container:`, error)
            return {
                containerId: '',
                status: 'failed',
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            }
        }
    }

    async getStatus(
        containerId: string,
    ): Promise<'running' | 'completed' | 'failed' | 'unknown'> {
        logger.info(`[Azure] Getting status for ${containerId}`)

        // Simulated status check
        // In production: query Azure Container Apps Jobs API
        return 'running'
    }

    async stop(containerId: string): Promise<void> {
        logger.info(`[Azure] Stopping container ${containerId}`)
        // Azure Container Apps Jobs are typically short-lived and auto-terminate
    }

    async getLogs(containerId: string): Promise<string> {
        logger.info(`[Azure] Getting logs for ${containerId}`)
        // In production: use Azure Monitor / Log Analytics
        return 'Azure logs not implemented'
    }

    async cleanup(containerId: string): Promise<void> {
        logger.info(`[Azure] Cleaning up container ${containerId}`)
        // Azure auto-cleanup after job completion
    }

    private formatEnvVars(
        env: Record<string, string>,
    ): Array<{ name: string; value: string }> {
        return Object.entries(env).map(([name, value]) => ({ name, value }))
    }
}
