/**
 * Scheduler API Routes
 * REST API endpoints for job scheduling
 */

import { Router, Request, Response } from 'express'
import { SchedulerService } from '../SchedulerService'
import { logger } from '../utils/logger'

export function createSchedulerRoutes(scheduler: SchedulerService): Router {
    const router = Router()

    /**
     * POST /api/scheduler/jobs
     * Submit a new job to the queue
     */
    router.post('/jobs', async (req: Request, res: Response): Promise<void> => {
        try {
            const {
                meetingUrl,
                botName,
                email,
                recordingMode,
                config,
                priority,
            } = req.body

            // Validation
            if (!meetingUrl) {
                res.status(400).json({
                    error: 'meetingUrl is required',
                })
                return
            }

            // Submit job
            const job = await scheduler.submitJob({
                meetingUrl,
                botName,
                email,
                recordingMode,
                config,
                priority: priority || 0,
            })

            logger.info(`[API] Job submitted: ${job.id}`)

            res.status(201).json({
                success: true,
                job: {
                    id: job.id,
                    meetingUrl: job.meetingUrl,
                    status: 'queued',
                    createdAt: job.createdAt,
                },
            })
        } catch (error) {
            logger.error('[API] Error submitting job:', error)
            res.status(500).json({
                error: 'Failed to submit job',
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            })
        }
    })

    /**
     * GET /api/scheduler/jobs/:jobId
     * Get job status
     */
    router.get(
        '/jobs/:jobId',
        async (req: Request, res: Response): Promise<void> => {
            try {
                const { jobId } = req.params

                const status = await scheduler.getJobStatus(jobId)

                if (!status) {
                    res.status(404).json({
                        error: 'Job not found',
                    })
                    return
                }

                res.json({
                    success: true,
                    job: status,
                })
            } catch (error) {
                logger.error('[API] Error getting job status:', error)
                res.status(500).json({
                    error: 'Failed to get job status',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                })
            }
        },
    )

    /**
     * GET /api/scheduler/stats
     * Get scheduler statistics
     */
    router.get('/stats', async (req: Request, res: Response) => {
        try {
            const stats = await scheduler.getStats()

            res.json({
                success: true,
                stats,
            })
        } catch (error) {
            logger.error('[API] Error getting stats:', error)
            res.status(500).json({
                error: 'Failed to get stats',
                message:
                    error instanceof Error ? error.message : 'Unknown error',
            })
        }
    })

    /**
     * POST /api/scheduler/jobs/batch
     * Submit multiple jobs at once
     */
    router.post(
        '/jobs/batch',
        async (req: Request, res: Response): Promise<void> => {
            try {
                const { jobs } = req.body

                if (!Array.isArray(jobs) || jobs.length === 0) {
                    res.status(400).json({
                        error: 'jobs array is required',
                    })
                    return
                }

                const submittedJobs = []
                for (const jobRequest of jobs) {
                    if (!jobRequest.meetingUrl) {
                        continue // Skip invalid jobs
                    }

                    const job = await scheduler.submitJob({
                        meetingUrl: jobRequest.meetingUrl,
                        botName: jobRequest.botName,
                        email: jobRequest.email,
                        recordingMode: jobRequest.recordingMode,
                        config: jobRequest.config,
                        priority: jobRequest.priority || 0,
                    })

                    submittedJobs.push({
                        id: job.id,
                        meetingUrl: job.meetingUrl,
                        status: 'queued',
                        createdAt: job.createdAt,
                    })
                }

                logger.info(
                    `[API] Batch submitted: ${submittedJobs.length} jobs`,
                )

                res.status(201).json({
                    success: true,
                    jobs: submittedJobs,
                    count: submittedJobs.length,
                })
            } catch (error) {
                logger.error('[API] Error submitting batch:', error)
                res.status(500).json({
                    error: 'Failed to submit batch',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                })
            }
        },
    )

    /**
     * GET /api/scheduler/health
     * Health check endpoint
     */
    router.get('/health', async (req: Request, res: Response) => {
        try {
            const stats = await scheduler.getStats()

            res.json({
                success: true,
                status: 'healthy',
                timestamp: new Date().toISOString(),
                stats,
            })
        } catch (error) {
            res.status(503).json({
                success: false,
                status: 'unhealthy',
                error: error instanceof Error ? error.message : 'Unknown error',
            })
        }
    })

    return router
}
