"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSchedulerRoutes = void 0;
const express_1 = require("express");
const logger_1 = require("../utils/logger");
function createSchedulerRoutes(scheduler) {
    const router = (0, express_1.Router)();
    router.post('/jobs', async (req, res) => {
        try {
            const { meetingUrl, botName, email, recordingMode, config, priority, } = req.body;
            if (!meetingUrl) {
                res.status(400).json({
                    error: 'meetingUrl is required',
                });
                return;
            }
            const job = await scheduler.submitJob({
                meetingUrl,
                botName,
                email,
                recordingMode,
                config,
                priority: priority || 0,
            });
            logger_1.logger.info(`[API] Job submitted: ${job.id}`);
            res.status(201).json({
                success: true,
                job: {
                    id: job.id,
                    meetingUrl: job.meetingUrl,
                    status: 'queued',
                    createdAt: job.createdAt,
                },
            });
        }
        catch (error) {
            logger_1.logger.error('[API] Error submitting job:', error);
            res.status(500).json({
                error: 'Failed to submit job',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });
    router.get('/jobs/:jobId', async (req, res) => {
        try {
            const { jobId } = req.params;
            const status = await scheduler.getJobStatus(jobId);
            if (!status) {
                res.status(404).json({
                    error: 'Job not found',
                });
                return;
            }
            res.json({
                success: true,
                job: status,
            });
        }
        catch (error) {
            logger_1.logger.error('[API] Error getting job status:', error);
            res.status(500).json({
                error: 'Failed to get job status',
                message: error instanceof Error
                    ? error.message
                    : 'Unknown error',
            });
        }
    });
    router.get('/stats', async (req, res) => {
        try {
            const stats = await scheduler.getStats();
            res.json({
                success: true,
                stats,
            });
        }
        catch (error) {
            logger_1.logger.error('[API] Error getting stats:', error);
            res.status(500).json({
                error: 'Failed to get stats',
                message: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });
    router.post('/jobs/batch', async (req, res) => {
        try {
            const { jobs } = req.body;
            if (!Array.isArray(jobs) || jobs.length === 0) {
                res.status(400).json({
                    error: 'jobs array is required',
                });
                return;
            }
            const submittedJobs = [];
            for (const jobRequest of jobs) {
                if (!jobRequest.meetingUrl) {
                    continue;
                }
                const job = await scheduler.submitJob({
                    meetingUrl: jobRequest.meetingUrl,
                    botName: jobRequest.botName,
                    email: jobRequest.email,
                    recordingMode: jobRequest.recordingMode,
                    config: jobRequest.config,
                    priority: jobRequest.priority || 0,
                });
                submittedJobs.push({
                    id: job.id,
                    meetingUrl: job.meetingUrl,
                    status: 'queued',
                    createdAt: job.createdAt,
                });
            }
            logger_1.logger.info(`[API] Batch submitted: ${submittedJobs.length} jobs`);
            res.status(201).json({
                success: true,
                jobs: submittedJobs,
                count: submittedJobs.length,
            });
        }
        catch (error) {
            logger_1.logger.error('[API] Error submitting batch:', error);
            res.status(500).json({
                error: 'Failed to submit batch',
                message: error instanceof Error
                    ? error.message
                    : 'Unknown error',
            });
        }
    });
    router.get('/health', async (req, res) => {
        try {
            const stats = await scheduler.getStats();
            res.json({
                success: true,
                status: 'healthy',
                timestamp: new Date().toISOString(),
                stats,
            });
        }
        catch (error) {
            res.status(503).json({
                success: false,
                status: 'unhealthy',
                error: error instanceof Error ? error.message : 'Unknown error',
            });
        }
    });
    return router;
}
exports.createSchedulerRoutes = createSchedulerRoutes;
//# sourceMappingURL=schedulerRoutes.js.map