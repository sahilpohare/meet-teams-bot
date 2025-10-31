"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AzureContainerJobAdapter = void 0;
const logger_1 = require("../utils/logger");
const arm_appcontainers_1 = require("@azure/arm-appcontainers");
const identity_1 = require("@azure/identity");
class AzureContainerJobAdapter {
    resourceGroup;
    containerAppJobName;
    location;
    client = null;
    subscriptionId;
    constructor(config) {
        this.resourceGroup = config.resourceGroup;
        this.containerAppJobName = config.containerAppJobName;
        this.location = config.location || 'eastus';
        this.subscriptionId = config.subscriptionId || process.env.AZURE_SUBSCRIPTION_ID || '';
    }
    async getClient() {
        if (!this.client) {
            if (!this.subscriptionId) {
                throw new Error('AZURE_SUBSCRIPTION_ID environment variable is required');
            }
            const credential = new identity_1.DefaultAzureCredential();
            this.client = new arm_appcontainers_1.ContainerAppsAPIClient(credential, this.subscriptionId);
            logger_1.logger.info('[Azure] Container Apps API client initialized');
        }
        return this.client;
    }
    async provision(config) {
        logger_1.logger.info(`[Azure] Provisioning container job for ${config.jobConfig.id}`);
        try {
            const client = await this.getClient();
            const jobExecutionName = `exec-${config.jobConfig.id.substring(0, 8)}-${Date.now()}`;
            const botConfigJson = JSON.stringify(config.jobConfig.config);
            const envVars = [
                { name: 'BOT_CONFIG', value: botConfigJson },
                { name: 'MEETING_URL', value: config.jobConfig.meetingUrl },
                { name: 'BOT_NAME', value: config.jobConfig.botName || 'Recording Bot' },
                { name: 'RECORDING', value: config.env?.RECORDING || 'true' },
                { name: 'AZURE_STORAGE_CONNECTION_STRING', value: process.env.AZURE_STORAGE_CONNECTION_STRING || '' },
                { name: 'AZURE_STORAGE_ACCOUNT_NAME', value: process.env.AZURE_STORAGE_ACCOUNT_NAME || '' },
                ...this.formatEnvVars(config.env || {}),
            ];
            logger_1.logger.info(`[Azure] Starting job execution:`, {
                jobName: this.containerAppJobName,
                executionName: jobExecutionName,
                image: config.image,
                resourceGroup: this.resourceGroup,
            });
            const result = await client.jobs.beginStartAndWait(this.resourceGroup, this.containerAppJobName, {
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
            });
            logger_1.logger.info(`[Azure] Job execution started:`, {
                executionName: result.name,
            });
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
            };
        }
        catch (error) {
            logger_1.logger.error(`[Azure] Failed to provision container:`, error);
            return {
                containerId: '',
                status: 'failed',
                message: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async getStatus(containerId) {
        logger_1.logger.info(`[Azure] Getting status for ${containerId}`);
        return 'running';
    }
    async stop(containerId) {
        logger_1.logger.info(`[Azure] Stopping container ${containerId}`);
    }
    async getLogs(containerId) {
        logger_1.logger.info(`[Azure] Getting logs for ${containerId}`);
        return 'Azure logs not implemented';
    }
    async cleanup(containerId) {
        logger_1.logger.info(`[Azure] Cleaning up container ${containerId}`);
    }
    formatEnvVars(env) {
        return Object.entries(env).map(([name, value]) => ({ name, value }));
    }
}
exports.AzureContainerJobAdapter = AzureContainerJobAdapter;
//# sourceMappingURL=AzureContainerJobAdapter.js.map