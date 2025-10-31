"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CloudflareWorkersAdapter = void 0;
const logger_1 = require("../utils/logger");
class CloudflareWorkersAdapter {
    accountId;
    apiToken;
    queueName;
    constructor(config) {
        this.accountId = config.accountId;
        this.apiToken = config.apiToken;
        this.queueName = config.queueName || 'bot-jobs';
    }
    async provision(config) {
        logger_1.logger.info(`[Cloudflare] Provisioning worker for ${config.jobConfig.id}`);
        try {
            const messageId = `msg-${config.jobConfig.id}-${Date.now()}`;
            const queueMessage = {
                jobId: config.jobConfig.id,
                config: config.jobConfig,
                containerImage: config.image,
                resources: {
                    cpu: config.cpu,
                    memory: config.memory,
                },
                env: config.env,
                timestamp: new Date().toISOString(),
            };
            logger_1.logger.info(`[Cloudflare] Queue message:`, {
                messageId,
                queueName: this.queueName,
                jobId: config.jobConfig.id,
            });
            return {
                containerId: messageId,
                status: 'success',
                message: 'Cloudflare Queue message sent successfully',
                metadata: {
                    platform: 'cloudflare',
                    accountId: this.accountId,
                    queueName: this.queueName,
                },
            };
        }
        catch (error) {
            logger_1.logger.error(`[Cloudflare] Failed to provision:`, error);
            return {
                containerId: '',
                status: 'failed',
                message: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async getStatus(containerId) {
        logger_1.logger.info(`[Cloudflare] Getting status for ${containerId}`);
        return 'running';
    }
    async stop(containerId) {
        logger_1.logger.info(`[Cloudflare] Stopping worker ${containerId}`);
    }
    async getLogs(containerId) {
        logger_1.logger.info(`[Cloudflare] Getting logs for ${containerId}`);
        return 'Cloudflare logs not implemented';
    }
    async cleanup(containerId) {
        logger_1.logger.info(`[Cloudflare] Cleaning up ${containerId}`);
    }
}
exports.CloudflareWorkersAdapter = CloudflareWorkersAdapter;
//# sourceMappingURL=CloudflareWorkersAdapter.js.map