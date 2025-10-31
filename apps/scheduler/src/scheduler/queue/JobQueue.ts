/**
 * Job Queue Interface and In-Memory Implementation
 * Handles job queuing with priority support
 */

import { JobRequest, JobStatus } from '../types'
import { logger } from '../utils/logger'

export interface IJobQueue {
    enqueue(job: JobRequest): Promise<void>
    dequeue(): Promise<JobRequest | null>
    getStatus(jobId: string): Promise<JobStatus | null>
    updateStatus(jobId: string, status: Partial<JobStatus>): Promise<void>
    getQueueSize(): Promise<number>
}

/**
 * In-memory job queue implementation
 * Can be replaced with Redis, RabbitMQ, etc. in production
 */
export class InMemoryJobQueue implements IJobQueue {
    private queue: JobRequest[] = []
    private statuses: Map<string, JobStatus> = new Map()

    async enqueue(job: JobRequest): Promise<void> {
        logger.info(`[JobQueue] Enqueuing job ${job.id}`)

        // Add to queue with priority sorting
        this.queue.push(job)
        this.queue.sort((a, b) => (b.priority || 0) - (a.priority || 0))

        // Initialize status
        await this.updateStatus(job.id, {
            id: job.id,
            status: 'queued',
            createdAt: job.createdAt,
        })

        logger.info(
            `[JobQueue] Job ${job.id} queued. Queue size: ${this.queue.length}`,
        )
    }

    async dequeue(): Promise<JobRequest | null> {
        const job = this.queue.shift()
        if (job) {
            logger.info(`[JobQueue] Dequeued job ${job.id}`)
            await this.updateStatus(job.id, {
                status: 'provisioning',
                startedAt: new Date(),
            })
        }
        return job || null
    }

    async getStatus(jobId: string): Promise<JobStatus | null> {
        return this.statuses.get(jobId) || null
    }

    async updateStatus(
        jobId: string,
        status: Partial<JobStatus>,
    ): Promise<void> {
        const existing = this.statuses.get(jobId)
        this.statuses.set(jobId, {
            ...existing,
            ...status,
            id: jobId,
        } as JobStatus)

        logger.info(
            `[JobQueue] Updated job ${jobId} status: ${status.status || 'unchanged'}`,
        )
    }

    async getQueueSize(): Promise<number> {
        return this.queue.length
    }

    // Additional utility methods
    getJobsByStatus(status: JobStatus['status']): JobStatus[] {
        return Array.from(this.statuses.values()).filter(
            (s) => s.status === status,
        )
    }

    clearCompleted(olderThanMs: number = 3600000): void {
        const cutoff = Date.now() - olderThanMs
        const entries = Array.from(this.statuses.entries())
        for (const [id, status] of entries) {
            if (
                (status.status === 'completed' || status.status === 'failed') &&
                status.completedAt &&
                status.completedAt.getTime() < cutoff
            ) {
                this.statuses.delete(id)
                logger.info(`[JobQueue] Cleaned up old job ${id}`)
            }
        }
    }
}
