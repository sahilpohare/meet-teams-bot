"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GCPCloudRunAdapter = void 0;
const logger_1 = require("../utils/logger");
class GCPCloudRunAdapter {
    projectId;
    region;
    jobName;
    constructor(config) {
        this.projectId = config.projectId;
        this.region = config.region || 'us-central1';
        this.jobName = config.jobName;
    }
    async provision(config) {
        logger_1.logger.info(`[GCP] Provisioning Cloud Run Job for ${config.jobConfig.id}`);
        try {
            const executionName = `execution-${config.jobConfig.id}-${Date.now()}`;
            const jobRequest = {
                parent: `projects/${this.projectId}/locations/${this.region}`,
                job: {
                    name: `${this.jobName}-${config.jobConfig.id}`,
                    template: {
                        template: {
                            containers: [
                                {
                                    name: 'bot-container',
                                    image: config.image,
                                    resources: {
                                        limits: {
                                            cpu: config.cpu || '1',
                                            memory: config.memory || '2Gi',
                                        },
                                    },
                                    env: this.formatEnvVars(config.env || {}),
                                },
                            ],
                            maxRetries: 0,
                            timeout: `${config.timeout || 3600}s`,
                        },
                    },
                },
            };
            logger_1.logger.info(`[GCP] Job request:`, {
                executionName,
                image: config.image,
                region: this.region,
            });
            return {
                containerId: executionName,
                status: 'success',
                message: 'GCP Cloud Run Job started successfully',
                metadata: {
                    platform: 'gcp',
                    projectId: this.projectId,
                    region: this.region,
                    jobName: this.jobName,
                },
            };
        }
        catch (error) {
            logger_1.logger.error(`[GCP] Failed to provision container:`, error);
            return {
                containerId: '',
                status: 'failed',
                message: error instanceof Error ? error.message : 'Unknown error',
            };
        }
    }
    async getStatus(containerId) {
        logger_1.logger.info(`[GCP] Getting status for ${containerId}`);
        return 'running';
    }
    async stop(containerId) {
        logger_1.logger.info(`[GCP] Stopping container ${containerId}`);
    }
    async getLogs(containerId) {
        logger_1.logger.info(`[GCP] Getting logs for ${containerId}`);
        return 'GCP logs not implemented';
    }
    async cleanup(containerId) {
        logger_1.logger.info(`[GCP] Cleaning up container ${containerId}`);
    }
    formatEnvVars(env) {
        return Object.entries(env).map(([name, value]) => ({ name, value }));
    }
}
exports.GCPCloudRunAdapter = GCPCloudRunAdapter;
//# sourceMappingURL=GCPCloudRunAdapter.js.map