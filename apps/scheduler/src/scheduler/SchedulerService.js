"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerService = void 0;
const tslib_1 = require("tslib");
const JobQueue_1 = require("./queue/JobQueue");
const logger_1 = require("./utils/logger");
const crypto = tslib_1.__importStar(require("crypto"));
class SchedulerService {
    queue;
    containerAdapter;
    containerImage;
    defaultCpu;
    defaultMemory;
    pollingInterval;
    maxConcurrentJobs;
    isRunning = false;
    runningJobs = new Set();
    constructor(config) {
        this.queue = config.queue || new JobQueue_1.InMemoryJobQueue();
        this.containerAdapter = config.containerAdapter;
        this.containerImage = config.containerImage || 'meet-teams-bot:latest';
        this.defaultCpu = config.defaultCpu || '1';
        this.defaultMemory = config.defaultMemory || '2Gi';
        this.pollingInterval = config.pollingInterval || 5000;
        this.maxConcurrentJobs = config.maxConcurrentJobs || 10;
    }
    async submitJob(request) {
        const job = {
            ...request,
            id: this.generateJobId(),
            createdAt: new Date(),
            priority: request.priority || 0,
        };
        logger_1.logger.info(`[Scheduler] Submitting job ${job.id}`, {
            meetingUrl: job.meetingUrl,
            priority: job.priority,
        });
        await this.queue.enqueue(job);
        return job;
    }
    async getJobStatus(jobId) {
        return await this.queue.getStatus(jobId);
    }
    async start() {
        if (this.isRunning) {
            logger_1.logger.warn('[Scheduler] Already running');
            return;
        }
        this.isRunning = true;
        logger_1.logger.info('[Scheduler] Starting worker', {
            pollingInterval: this.pollingInterval,
            maxConcurrentJobs: this.maxConcurrentJobs,
        });
        this.processQueue();
    }
    async stop() {
        logger_1.logger.info('[Scheduler] Stopping worker');
        this.isRunning = false;
    }
    async processQueue() {
        while (this.isRunning) {
            try {
                const queueSize = await this.queue.getQueueSize();
                if (this.runningJobs.size < this.maxConcurrentJobs &&
                    queueSize > 0) {
                    const job = await this.queue.dequeue();
                    if (job) {
                        this.processJob(job).catch((error) => {
                            logger_1.logger.error(`[Scheduler] Error processing job ${job.id}:`, error);
                        });
                    }
                }
                await this.sleep(this.pollingInterval);
            }
            catch (error) {
                logger_1.logger.error('[Scheduler] Error in queue processing:', error);
                await this.sleep(this.pollingInterval);
            }
        }
    }
    async processJob(job) {
        const jobId = job.id;
        this.runningJobs.add(jobId);
        try {
            logger_1.logger.info(`[Scheduler] Processing job ${jobId}`);
            const containerConfig = {
                image: this.containerImage,
                cpu: this.defaultCpu,
                memory: this.defaultMemory,
                env: {
                    MEETING_URL: job.meetingUrl,
                    BOT_NAME: job.botName || 'Recording Bot',
                    BOT_EMAIL: job.email || 'bot@example.com',
                    RECORDING_MODE: job.recordingMode || 'speaker_view',
                    JOB_ID: job.id,
                    ...this.serializeConfig(job.config || {}),
                },
                jobConfig: job,
                timeout: 3600,
            };
            logger_1.logger.info(`[Scheduler] Provisioning container for job ${jobId}`);
            const result = await this.containerAdapter.provision(containerConfig);
            if (result.status === 'success') {
                await this.queue.updateStatus(jobId, {
                    status: 'running',
                    containerId: result.containerId,
                    metadata: result.metadata,
                });
                logger_1.logger.info(`[Scheduler] Job ${jobId} running in container ${result.containerId}`);
                this.monitorJob(jobId, result.containerId);
            }
            else {
                await this.queue.updateStatus(jobId, {
                    status: 'failed',
                    error: result.message,
                    completedAt: new Date(),
                });
                logger_1.logger.error(`[Scheduler] Job ${jobId} failed to provision: ${result.message}`);
                this.runningJobs.delete(jobId);
            }
        }
        catch (error) {
            logger_1.logger.error(`[Scheduler] Error processing job ${jobId}:`, error);
            await this.queue.updateStatus(jobId, {
                status: 'failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                completedAt: new Date(),
            });
            this.runningJobs.delete(jobId);
        }
    }
    async monitorJob(jobId, containerId) {
        try {
            while (this.runningJobs.has(jobId)) {
                const status = await this.containerAdapter.getStatus(containerId);
                if (status === 'completed') {
                    await this.queue.updateStatus(jobId, {
                        status: 'completed',
                        completedAt: new Date(),
                    });
                    logger_1.logger.info(`[Scheduler] Job ${jobId} completed successfully`);
                    this.runningJobs.delete(jobId);
                    break;
                }
                else if (status === 'failed') {
                    const logs = await this.containerAdapter.getLogs(containerId);
                    await this.queue.updateStatus(jobId, {
                        status: 'failed',
                        error: 'Container failed',
                        completedAt: new Date(),
                        metadata: { logs },
                    });
                    logger_1.logger.error(`[Scheduler] Job ${jobId} failed`);
                    this.runningJobs.delete(jobId);
                    break;
                }
                await this.sleep(10000);
            }
        }
        catch (error) {
            logger_1.logger.error(`[Scheduler] Error monitoring job ${jobId}:`, error);
            this.runningJobs.delete(jobId);
        }
    }
    async getStats() {
        return {
            queueSize: await this.queue.getQueueSize(),
            runningJobs: this.runningJobs.size,
            maxConcurrentJobs: this.maxConcurrentJobs,
        };
    }
    generateJobId() {
        return crypto.randomBytes(8).toString('hex').toUpperCase();
    }
    serializeConfig(config) {
        const result = {};
        for (const [key, value] of Object.entries(config)) {
            result[`CONFIG_${key.toUpperCase()}`] = JSON.stringify(value);
        }
        return result;
    }
    sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
exports.SchedulerService = SchedulerService;
//# sourceMappingURL=SchedulerService.js.map