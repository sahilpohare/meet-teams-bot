"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHonoApp = void 0;
const zod_openapi_1 = require("@hono/zod-openapi");
const cors_1 = require("hono/cors");
const logger_1 = require("hono/logger");
const swagger_ui_1 = require("@hono/swagger-ui");
const logger_2 = require("../utils/logger");
const uuid_1 = require("uuid");
const JobRequestSchema = zod_openapi_1.z
    .object({
    meetingUrl: zod_openapi_1.z.string().url().openapi({
        description: 'Meeting URL (Google Meet, Teams, Zoom)',
        example: 'https://meet.google.com/abc-defg-hij',
    }),
    botName: zod_openapi_1.z.string().optional().openapi({
        description: 'Display name for the bot',
        example: 'Recording Bot',
    }),
    email: zod_openapi_1.z.string().email().optional().openapi({
        description: 'Email address for the bot',
        example: 'bot@example.com',
    }),
    recordingMode: zod_openapi_1.z
        .enum(['speaker_view', 'gallery_view'])
        .optional()
        .openapi({
        description: 'Recording mode',
        example: 'speaker_view',
    }),
    config: zod_openapi_1.z.record(zod_openapi_1.z.string(), zod_openapi_1.z.unknown()).optional().openapi({
        description: 'Additional configuration options',
    }),
})
    .openapi('JobRequest');
const JobResponseSchema = zod_openapi_1.z
    .object({
    success: zod_openapi_1.z.boolean(),
    job: zod_openapi_1.z.object({
        id: zod_openapi_1.z.string(),
        containerId: zod_openapi_1.z.string(),
        meetingUrl: zod_openapi_1.z.string(),
        status: zod_openapi_1.z.string(),
        createdAt: zod_openapi_1.z.string(),
    }),
})
    .openapi('JobResponse');
const JobStatusSchema = zod_openapi_1.z
    .object({
    id: zod_openapi_1.z.string(),
    containerId: zod_openapi_1.z.string(),
    status: zod_openapi_1.z.enum(['running', 'completed', 'failed', 'unknown']),
    meetingUrl: zod_openapi_1.z.string().optional(),
    createdAt: zod_openapi_1.z.string().optional(),
})
    .openapi('JobStatus');
const ErrorResponseSchema = zod_openapi_1.z
    .object({
    success: zod_openapi_1.z.boolean(),
    error: zod_openapi_1.z.string(),
    message: zod_openapi_1.z.string().optional(),
})
    .openapi('ErrorResponse');
const BatchJobRequestSchema = zod_openapi_1.z
    .object({
    jobs: zod_openapi_1.z.array(JobRequestSchema).min(1).openapi({
        description: 'Array of job requests',
    }),
})
    .openapi('BatchJobRequest');
const BatchJobResponseSchema = zod_openapi_1.z
    .object({
    success: zod_openapi_1.z.boolean(),
    jobs: zod_openapi_1.z.array(zod_openapi_1.z.object({
        id: zod_openapi_1.z.string(),
        containerId: zod_openapi_1.z.string(),
        meetingUrl: zod_openapi_1.z.string(),
        status: zod_openapi_1.z.string(),
        createdAt: zod_openapi_1.z.string(),
    })),
    count: zod_openapi_1.z.number(),
    errors: zod_openapi_1.z.array(zod_openapi_1.z.object({
        meetingUrl: zod_openapi_1.z.string(),
        error: zod_openapi_1.z.string(),
    })).optional(),
})
    .openapi('BatchJobResponse');
const CreateMeetingSchema = zod_openapi_1.z
    .object({
    meeting_url: zod_openapi_1.z.string().url().openapi({
        description: 'Meeting URL (Google Meet, Teams, Zoom)',
        example: 'https://meet.google.com/abc-defg-hij',
    }),
    bot_name: zod_openapi_1.z.string().optional().openapi({
        description: 'Display name for the bot',
        example: 'Recording Bot',
    }),
    email: zod_openapi_1.z.string().email().optional().openapi({
        description: 'Email address for the bot',
        example: 'bot@example.com',
    }),
    recording_mode: zod_openapi_1.z
        .enum(['speaker_view', 'gallery_view'])
        .optional()
        .openapi({
        description: 'Recording mode',
        example: 'speaker_view',
    }),
    bot_uuid: zod_openapi_1.z.string().optional().openapi({
        description: 'Unique bot identifier',
    }),
    user_id: zod_openapi_1.z.number().optional(),
    session_id: zod_openapi_1.z.string().optional(),
    bots_api_key: zod_openapi_1.z.string().optional(),
    bots_webhook_url: zod_openapi_1.z.string().url().optional(),
    enter_message: zod_openapi_1.z.string().optional(),
    automatic_leave: zod_openapi_1.z.object({
        waiting_room_timeout: zod_openapi_1.z.number().optional(),
        noone_joined_timeout: zod_openapi_1.z.number().optional(),
    }).optional(),
    custom_branding_bot_path: zod_openapi_1.z.string().url().optional(),
    storage_provider: zod_openapi_1.z.enum(['aws', 'azure', 'local']).optional(),
    mp4_s3_path: zod_openapi_1.z.string().optional(),
    azure_storage: zod_openapi_1.z.object({
        container_name: zod_openapi_1.z.string().optional(),
        blob_path_template: zod_openapi_1.z.string().optional(),
    }).optional(),
    speech_to_text_provider: zod_openapi_1.z.string().optional(),
    streaming_input: zod_openapi_1.z.string().optional(),
    streaming_output: zod_openapi_1.z.string().optional(),
    config: zod_openapi_1.z.record(zod_openapi_1.z.string(), zod_openapi_1.z.unknown()).optional().openapi({
        description: 'Additional bot configuration',
    }),
})
    .openapi('CreateMeeting');
const MeetingResponseSchema = zod_openapi_1.z
    .object({
    success: zod_openapi_1.z.boolean(),
    meeting: zod_openapi_1.z.object({
        id: zod_openapi_1.z.string(),
        containerId: zod_openapi_1.z.string(),
        meetingUrl: zod_openapi_1.z.string(),
        status: zod_openapi_1.z.string(),
        createdAt: zod_openapi_1.z.string(),
        botConfig: zod_openapi_1.z.record(zod_openapi_1.z.string(), zod_openapi_1.z.unknown()),
    }),
})
    .openapi('MeetingResponse');
const HealthResponseSchema = zod_openapi_1.z
    .object({
    success: zod_openapi_1.z.boolean(),
    status: zod_openapi_1.z.enum(['healthy', 'unhealthy']),
    timestamp: zod_openapi_1.z.string(),
    activeJobs: zod_openapi_1.z.number().optional(),
    error: zod_openapi_1.z.string().optional(),
})
    .openapi('HealthResponse');
const activeJobs = new Map();
function createHonoApp(containerAdapter, containerImage) {
    const app = new zod_openapi_1.OpenAPIHono();
    app.use('*', (0, cors_1.cors)());
    app.use('*', (0, logger_1.logger)());
    app.doc('/doc', {
        openapi: '3.0.0',
        info: {
            version: '1.0.0',
            title: 'Meeting Bot Scheduler API',
            description: 'API for direct container creation and management (no queuing)',
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Local development server',
            },
        ],
        tags: [
            {
                name: 'Jobs',
                description: 'Direct container management',
            },
            {
                name: 'Health',
                description: 'Health check endpoints',
            },
        ],
    });
    app.get('/ui', (0, swagger_ui_1.swaggerUI)({ url: '/doc' }));
    const rootRoute = (0, zod_openapi_1.createRoute)({
        method: 'get',
        path: '/',
        tags: ['Health'],
        responses: {
            200: {
                description: 'API information',
                content: {
                    'application/json': {
                        schema: zod_openapi_1.z.object({
                            name: zod_openapi_1.z.string(),
                            version: zod_openapi_1.z.string(),
                            documentation: zod_openapi_1.z.string(),
                            mode: zod_openapi_1.z.string(),
                            endpoints: zod_openapi_1.z.record(zod_openapi_1.z.string(), zod_openapi_1.z.string()),
                        }),
                    },
                },
            },
        },
    });
    app.openapi(rootRoute, (c) => {
        return c.json({
            name: 'Meeting Bot Scheduler API',
            version: '1.0.0',
            documentation: '/ui',
            mode: 'direct',
            endpoints: {
                openapi: 'GET /doc',
                swagger: 'GET /ui',
                health: 'GET /health',
                createJob: 'POST /api/scheduler/jobs',
                getJob: 'GET /api/scheduler/jobs/:jobId',
                batchCreate: 'POST /api/scheduler/jobs/batch',
                createMeeting: 'POST /api/scheduler/meetings',
            },
        });
    });
    const healthRoute = (0, zod_openapi_1.createRoute)({
        method: 'get',
        path: '/health',
        tags: ['Health'],
        responses: {
            200: {
                description: 'Service is healthy',
                content: {
                    'application/json': {
                        schema: HealthResponseSchema,
                    },
                },
            },
            503: {
                description: 'Service is unhealthy',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
        },
    });
    app.openapi(healthRoute, async (c) => {
        try {
            return c.json({
                success: true,
                status: 'healthy',
                timestamp: new Date().toISOString(),
                activeJobs: activeJobs.size,
            });
        }
        catch (error) {
            return c.json({
                success: false,
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                error: error instanceof Error
                    ? error.message
                    : 'Unknown error',
            }, 503);
        }
    });
    const createJobRoute = (0, zod_openapi_1.createRoute)({
        method: 'post',
        path: '/api/scheduler/jobs',
        tags: ['Jobs'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: JobRequestSchema,
                    },
                },
            },
        },
        responses: {
            201: {
                description: 'Container created successfully',
                content: {
                    'application/json': {
                        schema: JobResponseSchema,
                    },
                },
            },
            400: {
                description: 'Invalid request',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            500: {
                description: 'Server error',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
        },
    });
    app.openapi(createJobRoute, async (c) => {
        try {
            const body = c.req.valid('json');
            const jobId = (0, uuid_1.v4)();
            const createdAt = new Date().toISOString();
            const botConfig = {
                meeting_url: body.meetingUrl,
                bot_name: body.botName || 'Recording Bot',
                email: body.email,
                recording_mode: body.recordingMode || 'speaker_view',
                bot_uuid: jobId,
                ...(body.config || {}),
            };
            logger_2.logger.info(`[API] Creating container for job ${jobId}: ${body.meetingUrl}`);
            const result = await containerAdapter.provision({
                image: containerImage,
                cpu: '1',
                memory: '2Gi',
                env: {
                    RECORDING: 'true',
                },
                jobConfig: {
                    id: jobId,
                    meetingUrl: body.meetingUrl,
                    botName: body.botName,
                    email: body.email,
                    recordingMode: body.recordingMode,
                    config: botConfig,
                    priority: 0,
                    createdAt: new Date(createdAt),
                },
            });
            if (result.status === 'failed') {
                throw new Error(result.message || 'Failed to provision container');
            }
            const containerId = result.containerId;
            activeJobs.set(jobId, {
                id: jobId,
                containerId,
                meetingUrl: body.meetingUrl,
                createdAt,
            });
            logger_2.logger.info(`[API] Container created: ${containerId} for job ${jobId}`);
            return c.json({
                success: true,
                job: {
                    id: jobId,
                    containerId,
                    meetingUrl: body.meetingUrl,
                    status: 'running',
                    createdAt,
                },
            }, 201);
        }
        catch (error) {
            logger_2.logger.error('[API] Error creating container:', error);
            return c.json({
                success: false,
                error: 'Failed to create container',
                message: error instanceof Error
                    ? error.message
                    : 'Unknown error',
            }, 500);
        }
    });
    const getJobRoute = (0, zod_openapi_1.createRoute)({
        method: 'get',
        path: '/api/scheduler/jobs/{jobId}',
        tags: ['Jobs'],
        request: {
            params: zod_openapi_1.z.object({
                jobId: zod_openapi_1.z.string().openapi({
                    description: 'Job ID',
                    example: '550e8400-e29b-41d4-a716-446655440000',
                }),
            }),
        },
        responses: {
            200: {
                description: 'Job status retrieved',
                content: {
                    'application/json': {
                        schema: zod_openapi_1.z.object({
                            success: zod_openapi_1.z.boolean(),
                            job: JobStatusSchema,
                        }),
                    },
                },
            },
            404: {
                description: 'Job not found',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            500: {
                description: 'Server error',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
        },
    });
    app.openapi(getJobRoute, async (c) => {
        try {
            const { jobId } = c.req.valid('param');
            const job = activeJobs.get(jobId);
            if (!job) {
                return c.json({
                    success: false,
                    error: 'Job not found',
                }, 404);
            }
            const containerStatus = await containerAdapter.getStatus(job.containerId);
            return c.json({
                success: true,
                job: {
                    id: job.id,
                    containerId: job.containerId,
                    status: containerStatus || 'unknown',
                    meetingUrl: job.meetingUrl,
                    createdAt: job.createdAt,
                },
            });
        }
        catch (error) {
            logger_2.logger.error('[API] Error getting job status:', error);
            return c.json({
                success: false,
                error: 'Failed to get job status',
                message: error instanceof Error
                    ? error.message
                    : 'Unknown error',
            }, 500);
        }
    });
    const batchCreateRoute = (0, zod_openapi_1.createRoute)({
        method: 'post',
        path: '/api/scheduler/jobs/batch',
        tags: ['Jobs'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: BatchJobRequestSchema,
                    },
                },
            },
        },
        responses: {
            201: {
                description: 'Batch containers created successfully',
                content: {
                    'application/json': {
                        schema: BatchJobResponseSchema,
                    },
                },
            },
            400: {
                description: 'Invalid request',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            500: {
                description: 'Server error',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
        },
    });
    app.openapi(batchCreateRoute, async (c) => {
        try {
            const body = c.req.valid('json');
            const createdJobs = [];
            const errors = [];
            for (const jobRequest of body.jobs) {
                try {
                    const jobId = (0, uuid_1.v4)();
                    const createdAt = new Date().toISOString();
                    const botConfig = {
                        meeting_url: jobRequest.meetingUrl,
                        bot_name: jobRequest.botName || 'Recording Bot',
                        email: jobRequest.email,
                        recording_mode: jobRequest.recordingMode || 'speaker_view',
                        bot_uuid: jobId,
                        ...(jobRequest.config || {}),
                    };
                    const result = await containerAdapter.provision({
                        image: containerImage,
                        cpu: '1',
                        memory: '2Gi',
                        env: {
                            RECORDING: 'true',
                        },
                        jobConfig: {
                            id: jobId,
                            meetingUrl: jobRequest.meetingUrl,
                            botName: jobRequest.botName,
                            email: jobRequest.email,
                            recordingMode: jobRequest.recordingMode,
                            config: botConfig,
                            priority: 0,
                            createdAt: new Date(createdAt),
                        },
                    });
                    if (result.status === 'failed') {
                        throw new Error(result.message || 'Failed to provision container');
                    }
                    const containerId = result.containerId;
                    activeJobs.set(jobId, {
                        id: jobId,
                        containerId,
                        meetingUrl: jobRequest.meetingUrl,
                        createdAt,
                    });
                    createdJobs.push({
                        id: jobId,
                        containerId,
                        meetingUrl: jobRequest.meetingUrl,
                        status: 'running',
                        createdAt,
                    });
                }
                catch (error) {
                    logger_2.logger.error(`[API] Error creating container for ${jobRequest.meetingUrl}:`, error);
                    errors.push({
                        meetingUrl: jobRequest.meetingUrl,
                        error: error instanceof Error
                            ? error.message
                            : 'Unknown error',
                    });
                }
            }
            logger_2.logger.info(`[API] Batch created: ${createdJobs.length} containers`);
            return c.json({
                success: true,
                jobs: createdJobs,
                count: createdJobs.length,
                errors: errors.length > 0 ? errors : undefined,
            }, 201);
        }
        catch (error) {
            logger_2.logger.error('[API] Error in batch creation:', error);
            return c.json({
                success: false,
                error: 'Failed to create batch',
                message: error instanceof Error
                    ? error.message
                    : 'Unknown error',
            }, 500);
        }
    });
    const createMeetingRoute = (0, zod_openapi_1.createRoute)({
        method: 'post',
        path: '/api/scheduler/meetings',
        tags: ['Jobs'],
        request: {
            body: {
                content: {
                    'application/json': {
                        schema: CreateMeetingSchema,
                    },
                },
            },
        },
        responses: {
            201: {
                description: 'Meeting container created successfully',
                content: {
                    'application/json': {
                        schema: MeetingResponseSchema,
                    },
                },
            },
            400: {
                description: 'Invalid request',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
            500: {
                description: 'Server error',
                content: {
                    'application/json': {
                        schema: ErrorResponseSchema,
                    },
                },
            },
        },
    });
    app.openapi(createMeetingRoute, async (c) => {
        try {
            const body = c.req.valid('json');
            const jobId = body.bot_uuid || (0, uuid_1.v4)();
            const createdAt = new Date().toISOString();
            const botConfig = {
                id: body.session_id || `meeting-bot-session-${jobId}`,
                meeting_url: body.meeting_url,
                bot_name: body.bot_name || 'Recording Bot',
                email: body.email || 'bot@scheduler.local',
                bot_uuid: jobId,
                recording_mode: body.recording_mode || 'speaker_view',
                user_token: body.user_token || 'scheduler-token',
                user_id: body.user_id || 999,
                session_id: body.session_id || `scheduler-${jobId}`,
                environ: 'scheduler',
                local_recording_server_location: 'docker',
                bots_api_key: body.bots_api_key || '',
                bots_webhook_url: body.bots_webhook_url,
                enter_message: body.enter_message,
                automatic_leave: body.automatic_leave || {
                    waiting_room_timeout: 600,
                    noone_joined_timeout: 600,
                },
                custom_branding_bot_path: body.custom_branding_bot_path,
                storage_provider: body.storage_provider || 'azure',
                mp4_s3_path: body.mp4_s3_path || `recordings/${jobId}.mp4`,
                aws_s3_temporary_audio_bucket: body.aws_s3_temporary_audio_bucket || 'scheduler-audio',
                azure_storage: body.azure_storage,
                use_my_vocabulary: false,
                vocabulary: [],
                force_lang: false,
                speech_to_text_provider: body.speech_to_text_provider || 'Default',
                speech_to_text_api_key: '',
                streaming_input: body.streaming_input || '',
                streaming_output: body.streaming_output || '',
                streaming_audio_frequency: 24000,
                remote: null,
                ...(body.config || {}),
            };
            Object.keys(botConfig).forEach((key) => {
                if (botConfig[key] === undefined) {
                    delete botConfig[key];
                }
            });
            logger_2.logger.info(`[API] Creating meeting container for ${jobId}: ${body.meeting_url}`);
            const result = await containerAdapter.provision({
                image: containerImage,
                cpu: '1',
                memory: '2Gi',
                env: {
                    RECORDING: 'true',
                },
                jobConfig: {
                    id: jobId,
                    meetingUrl: body.meeting_url,
                    botName: body.bot_name,
                    email: body.email,
                    recordingMode: body.recording_mode,
                    config: botConfig,
                    priority: 0,
                    createdAt: new Date(createdAt),
                },
            });
            if (result.status === 'failed') {
                throw new Error(result.message || 'Failed to provision container');
            }
            const containerId = result.containerId;
            activeJobs.set(jobId, {
                id: jobId,
                containerId,
                meetingUrl: body.meeting_url,
                createdAt,
            });
            logger_2.logger.info(`[API] Meeting container created: ${containerId} for job ${jobId}`);
            return c.json({
                success: true,
                meeting: {
                    id: jobId,
                    containerId,
                    meetingUrl: body.meeting_url,
                    status: 'running',
                    createdAt,
                    botConfig,
                },
            }, 201);
        }
        catch (error) {
            logger_2.logger.error('[API] Error creating meeting container:', error);
            return c.json({
                success: false,
                error: 'Failed to create meeting container',
                message: error instanceof Error
                    ? error.message
                    : 'Unknown error',
            }, 500);
        }
    });
    return app;
}
exports.createHonoApp = createHonoApp;
//# sourceMappingURL=honoApp.js.map