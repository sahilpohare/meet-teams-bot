"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.InMemoryJobQueue = void 0;
const logger_1 = require("../utils/logger");
class InMemoryJobQueue {
    queue = [];
    statuses = new Map();
    async enqueue(job) {
        logger_1.logger.info(`[JobQueue] Enqueuing job ${job.id}`);
        this.queue.push(job);
        this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        await this.updateStatus(job.id, {
            id: job.id,
            status: 'queued',
            createdAt: job.createdAt,
        });
        logger_1.logger.info(`[JobQueue] Job ${job.id} queued. Queue size: ${this.queue.length}`);
    }
    async dequeue() {
        const job = this.queue.shift();
        if (job) {
            logger_1.logger.info(`[JobQueue] Dequeued job ${job.id}`);
            await this.updateStatus(job.id, {
                status: 'provisioning',
                startedAt: new Date(),
            });
        }
        return job || null;
    }
    async getStatus(jobId) {
        return this.statuses.get(jobId) || null;
    }
    async updateStatus(jobId, status) {
        const existing = this.statuses.get(jobId);
        this.statuses.set(jobId, {
            ...existing,
            ...status,
            id: jobId,
        });
        logger_1.logger.info(`[JobQueue] Updated job ${jobId} status: ${status.status || 'unchanged'}`);
    }
    async getQueueSize() {
        return this.queue.length;
    }
    getJobsByStatus(status) {
        return Array.from(this.statuses.values()).filter((s) => s.status === status);
    }
    clearCompleted(olderThanMs = 3600000) {
        const cutoff = Date.now() - olderThanMs;
        const entries = Array.from(this.statuses.entries());
        for (const [id, status] of entries) {
            if ((status.status === 'completed' || status.status === 'failed') &&
                status.completedAt &&
                status.completedAt.getTime() < cutoff) {
                this.statuses.delete(id);
                logger_1.logger.info(`[JobQueue] Cleaned up old job ${id}`);
            }
        }
    }
}
exports.InMemoryJobQueue = InMemoryJobQueue;
//# sourceMappingURL=JobQueue.js.map