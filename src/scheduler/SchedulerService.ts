/**
 * Scheduler Service
 * Core orchestration service for job scheduling and container provisioning
 */

import { IJobQueue, InMemoryJobQueue } from './queue/JobQueue'
import { IContainerAdapter } from './adapters/ContainerAdapter'
import { JobRequest, JobStatus, ContainerConfig } from './types'
import { logger } from './utils/logger'
import * as crypto from 'crypto'

export interface SchedulerConfig {
    containerAdapter: IContainerAdapter
    queue?: IJobQueue
    containerImage?: string
    defaultCpu?: string
    defaultMemory?: string
    pollingInterval?: number
    maxConcurrentJobs?: number
}

export class SchedulerService {
    private queue: IJobQueue
    private containerAdapter: IContainerAdapter
    private containerImage: string
    private defaultCpu: string
    private defaultMemory: string
    private pollingInterval: number
    private maxConcurrentJobs: number
    private isRunning: boolean = false
    private runningJobs: Set<string> = new Set()

    constructor(config: SchedulerConfig) {
        this.queue = config.queue || new InMemoryJobQueue()
        this.containerAdapter = config.containerAdapter
        this.containerImage = config.containerImage || 'meet-teams-bot:latest'
        this.defaultCpu = config.defaultCpu || '1'
        this.defaultMemory = config.defaultMemory || '2Gi'
        this.pollingInterval = config.pollingInterval || 5000
        this.maxConcurrentJobs = config.maxConcurrentJobs || 10
    }

    /**
     * Submit a new job to the queue
     */
    async submitJob(
        request: Omit<JobRequest, 'id' | 'createdAt'>,
    ): Promise<JobRequest> {
        const job: JobRequest = {
            ...request,
            id: this.generateJobId(),
            createdAt: new Date(),
            priority: request.priority || 0,
        }

        logger.info(`[Scheduler] Submitting job ${job.id}`, {
            meetingUrl: job.meetingUrl,
            priority: job.priority,
        })

        await this.queue.enqueue(job)

        return job
    }

    /**
     * Get job status
     */
    async getJobStatus(jobId: string): Promise<JobStatus | null> {
        return await this.queue.getStatus(jobId)
    }

    /**
     * Start the scheduler worker
     */
    async start(): Promise<void> {
        if (this.isRunning) {
            logger.warn('[Scheduler] Already running')
            return
        }

        this.isRunning = true
        logger.info('[Scheduler] Starting worker', {
            pollingInterval: this.pollingInterval,
            maxConcurrentJobs: this.maxConcurrentJobs,
        })

        this.processQueue()
    }

    /**
     * Stop the scheduler worker
     */
    async stop(): Promise<void> {
        logger.info('[Scheduler] Stopping worker')
        this.isRunning = false
    }

    /**
     * Main queue processing loop
     */
    private async processQueue(): Promise<void> {
        while (this.isRunning) {
            try {
                const queueSize = await this.queue.getQueueSize()

                if (
                    this.runningJobs.size < this.maxConcurrentJobs &&
                    queueSize > 0
                ) {
                    const job = await this.queue.dequeue()

                    if (job) {
                        // Process job asynchronously
                        this.processJob(job).catch((error) => {
                            logger.error(
                                `[Scheduler] Error processing job ${job.id}:`,
                                error,
                            )
                        })
                    }
                }

                // Wait before next poll
                await this.sleep(this.pollingInterval)
            } catch (error) {
                logger.error('[Scheduler] Error in queue processing:', error)
                await this.sleep(this.pollingInterval)
            }
        }
    }

    /**
     * Process a single job
     */
    private async processJob(job: JobRequest): Promise<void> {
        const jobId = job.id
        this.runningJobs.add(jobId)

        try {
            logger.info(`[Scheduler] Processing job ${jobId}`)

            // Build container configuration
            const containerConfig: ContainerConfig = {
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
                timeout: 3600, // 1 hour default timeout
            }

            // Provision container
            logger.info(`[Scheduler] Provisioning container for job ${jobId}`)
            const result =
                await this.containerAdapter.provision(containerConfig)

            if (result.status === 'success') {
                await this.queue.updateStatus(jobId, {
                    status: 'running',
                    containerId: result.containerId,
                    metadata: result.metadata,
                })
                logger.info(
                    `[Scheduler] Job ${jobId} running in container ${result.containerId}`,
                )

                // Monitor job status (in background)
                this.monitorJob(jobId, result.containerId)
            } else {
                await this.queue.updateStatus(jobId, {
                    status: 'failed',
                    error: result.message,
                    completedAt: new Date(),
                })
                logger.error(
                    `[Scheduler] Job ${jobId} failed to provision: ${result.message}`,
                )
                this.runningJobs.delete(jobId)
            }
        } catch (error) {
            logger.error(`[Scheduler] Error processing job ${jobId}:`, error)
            await this.queue.updateStatus(jobId, {
                status: 'failed',
                error: error instanceof Error ? error.message : 'Unknown error',
                completedAt: new Date(),
            })
            this.runningJobs.delete(jobId)
        }
    }

    /**
     * Monitor a running job
     */
    private async monitorJob(
        jobId: string,
        containerId: string,
    ): Promise<void> {
        try {
            // Poll container status
            while (this.runningJobs.has(jobId)) {
                const status =
                    await this.containerAdapter.getStatus(containerId)

                if (status === 'completed') {
                    await this.queue.updateStatus(jobId, {
                        status: 'completed',
                        completedAt: new Date(),
                    })
                    logger.info(
                        `[Scheduler] Job ${jobId} completed successfully`,
                    )
                    this.runningJobs.delete(jobId)
                    break
                } else if (status === 'failed') {
                    const logs =
                        await this.containerAdapter.getLogs(containerId)
                    await this.queue.updateStatus(jobId, {
                        status: 'failed',
                        error: 'Container failed',
                        completedAt: new Date(),
                        metadata: { logs },
                    })
                    logger.error(`[Scheduler] Job ${jobId} failed`)
                    this.runningJobs.delete(jobId)
                    break
                }

                // Wait before next status check
                await this.sleep(10000) // Check every 10 seconds
            }
        } catch (error) {
            logger.error(`[Scheduler] Error monitoring job ${jobId}:`, error)
            this.runningJobs.delete(jobId)
        }
    }

    /**
     * Get scheduler statistics
     */
    async getStats(): Promise<{
        queueSize: number
        runningJobs: number
        maxConcurrentJobs: number
    }> {
        return {
            queueSize: await this.queue.getQueueSize(),
            runningJobs: this.runningJobs.size,
            maxConcurrentJobs: this.maxConcurrentJobs,
        }
    }

    // Utility methods
    private generateJobId(): string {
        // Generate a random 16-character hex ID
        return crypto.randomBytes(8).toString('hex').toUpperCase()
    }

    private serializeConfig(
        config: Record<string, any>,
    ): Record<string, string> {
        const result: Record<string, string> = {}
        for (const [key, value] of Object.entries(config)) {
            result[`CONFIG_${key.toUpperCase()}`] = JSON.stringify(value)
        }
        return result
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms))
    }
}
