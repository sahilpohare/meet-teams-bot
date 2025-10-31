/**
 * Hono-based Scheduler API with OpenAPI Documentation
 * Direct container creation without queuing
 */

import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { cors } from 'hono/cors'
import { logger as honoLogger } from 'hono/logger'
import { swaggerUI } from '@hono/swagger-ui'
import { IContainerAdapter } from '../adapters/ContainerAdapter'
import { logger } from '../utils/logger'
import { v4 as uuidv4 } from 'uuid'

// Zod Schemas
const JobRequestSchema = z
    .object({
        meetingUrl: z.string().url().openapi({
            description: 'Meeting URL (Google Meet, Teams, Zoom)',
            example: 'https://meet.google.com/abc-defg-hij',
        }),
        botName: z.string().optional().openapi({
            description: 'Display name for the bot',
            example: 'Recording Bot',
        }),
        email: z.string().email().optional().openapi({
            description: 'Email address for the bot',
            example: 'bot@example.com',
        }),
        recordingMode: z
            .enum(['speaker_view', 'gallery_view'])
            .optional()
            .openapi({
                description: 'Recording mode',
                example: 'speaker_view',
            }),
        config: z.record(z.string(), z.unknown()).optional().openapi({
            description: 'Additional configuration options',
        }),
    })
    .openapi('JobRequest')

const JobResponseSchema = z
    .object({
        success: z.boolean(),
        job: z.object({
            id: z.string(),
            containerId: z.string(),
            meetingUrl: z.string(),
            status: z.string(),
            createdAt: z.string(),
        }),
    })
    .openapi('JobResponse')

const JobStatusSchema = z
    .object({
        id: z.string(),
        containerId: z.string(),
        status: z.enum(['running', 'completed', 'failed', 'unknown']),
        meetingUrl: z.string().optional(),
        createdAt: z.string().optional(),
    })
    .openapi('JobStatus')

const ErrorResponseSchema = z
    .object({
        success: z.boolean(),
        error: z.string(),
        message: z.string().optional(),
    })
    .openapi('ErrorResponse')

const BatchJobRequestSchema = z
    .object({
        jobs: z.array(JobRequestSchema).min(1).openapi({
            description: 'Array of job requests',
        }),
    })
    .openapi('BatchJobRequest')

const BatchJobResponseSchema = z
    .object({
        success: z.boolean(),
        jobs: z.array(
            z.object({
                id: z.string(),
                containerId: z.string(),
                meetingUrl: z.string(),
                status: z.string(),
                createdAt: z.string(),
            })
        ),
        count: z.number(),
        errors: z.array(z.object({
            meetingUrl: z.string(),
            error: z.string(),
        })).optional(),
    })
    .openapi('BatchJobResponse')

const CreateMeetingSchema = z
    .object({
        meeting_url: z.string().url().openapi({
            description: 'Meeting URL (Google Meet, Teams, Zoom)',
            example: 'https://meet.google.com/abc-defg-hij',
        }),
        bot_name: z.string().optional().openapi({
            description: 'Display name for the bot',
            example: 'Recording Bot',
        }),
        email: z.string().email().optional().openapi({
            description: 'Email address for the bot',
            example: 'bot@example.com',
        }),
        recording_mode: z
            .enum(['speaker_view', 'gallery_view'])
            .optional()
            .openapi({
                description: 'Recording mode',
                example: 'speaker_view',
            }),
        bot_uuid: z.string().optional().openapi({
            description: 'Unique bot identifier',
        }),
        user_id: z.number().optional(),
        session_id: z.string().optional(),
        bots_api_key: z.string().optional(),
        bots_webhook_url: z.string().url().optional(),
        enter_message: z.string().optional(),
        automatic_leave: z.object({
            waiting_room_timeout: z.number().optional(),
            noone_joined_timeout: z.number().optional(),
        }).optional(),
        custom_branding_bot_path: z.string().url().optional(),
        storage_provider: z.enum(['aws', 'azure', 'local']).optional(),
        mp4_s3_path: z.string().optional(),
        azure_storage: z.object({
            container_name: z.string().optional(),
            blob_path_template: z.string().optional(),
        }).optional(),
        speech_to_text_provider: z.string().optional(),
        streaming_input: z.string().optional(),
        streaming_output: z.string().optional(),
        // Allow any additional fields
        config: z.record(z.string(), z.unknown()).optional().openapi({
            description: 'Additional bot configuration',
        }),
    })
    .openapi('CreateMeeting')

const MeetingResponseSchema = z
    .object({
        success: z.boolean(),
        meeting: z.object({
            id: z.string(),
            containerId: z.string(),
            meetingUrl: z.string(),
            status: z.string(),
            createdAt: z.string(),
            botConfig: z.record(z.string(), z.unknown()),
        }),
    })
    .openapi('MeetingResponse')

const HealthResponseSchema = z
    .object({
        success: z.boolean(),
        status: z.enum(['healthy', 'unhealthy']),
        timestamp: z.string(),
        activeJobs: z.number().optional(),
        error: z.string().optional(),
    })
    .openapi('HealthResponse')

// Store active jobs (in-memory, replace with Redis/DB for production)
const activeJobs = new Map<
    string,
    {
        id: string
        containerId: string
        meetingUrl: string
        createdAt: string
    }
>()

export function createHonoApp(
    containerAdapter: IContainerAdapter,
    containerImage: string
): OpenAPIHono {
    const app = new OpenAPIHono()

    // Middleware
    app.use('*', cors())
    app.use('*', honoLogger())

    // OpenAPI Documentation
    app.doc('/doc', {
        openapi: '3.0.0',
        info: {
            version: '1.0.0',
            title: 'Meeting Bot Scheduler API',
            description:
                'API for direct container creation and management (no queuing)',
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
    })

    // Swagger UI
    app.get('/ui', swaggerUI({ url: '/doc' }))

    // Root endpoint
    const rootRoute = createRoute({
        method: 'get',
        path: '/',
        tags: ['Health'],
        responses: {
            200: {
                description: 'API information',
                content: {
                    'application/json': {
                        schema: z.object({
                            name: z.string(),
                            version: z.string(),
                            documentation: z.string(),
                            mode: z.string(),
                            endpoints: z.record(z.string(), z.string()),
                        }),
                    },
                },
            },
        },
    })

    app.openapi(rootRoute, (c: any) => {
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
        })
    })

    // Health check
    const healthRoute = createRoute({
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
    })

    ;(app.openapi as any)(healthRoute, async (c: any) => {
        try {
            return c.json({
                success: true,
                status: 'healthy' as const,
                timestamp: new Date().toISOString(),
                activeJobs: activeJobs.size,
            })
        } catch (error) {
            return c.json(
                {
                    success: false,
                    status: 'unhealthy' as const,
                    timestamp: new Date().toISOString(),
                    error:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                },
                503
            )
        }
    })

    // Create job (direct container creation)
    const createJobRoute = createRoute({
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
    })

    ;(app.openapi as any)(createJobRoute, async (c: any) => {
        try {
            const body = c.req.valid('json')

            // Generate job ID
            const jobId = uuidv4()
            const createdAt = new Date().toISOString()

            // Build bot configuration
            const botConfig = {
                meeting_url: body.meetingUrl,
                bot_name: body.botName || 'Recording Bot',
                email: body.email,
                recording_mode: body.recordingMode || 'speaker_view',
                bot_uuid: jobId,
                ...(body.config || {}),
            }

            logger.info(
                `[API] Creating container for job ${jobId}: ${body.meetingUrl}`
            )

            // Create container directly
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
            })

            if (result.status === 'failed') {
                throw new Error(result.message || 'Failed to provision container')
            }

            const containerId = result.containerId

            // Store job info
            activeJobs.set(jobId, {
                id: jobId,
                containerId,
                meetingUrl: body.meetingUrl,
                createdAt,
            })

            logger.info(
                `[API] Container created: ${containerId} for job ${jobId}`
            )

            return c.json(
                {
                    success: true,
                    job: {
                        id: jobId,
                        containerId,
                        meetingUrl: body.meetingUrl,
                        status: 'running',
                        createdAt,
                    },
                },
                201
            )
        } catch (error) {
            logger.error('[API] Error creating container:', error)
            return c.json(
                {
                    success: false,
                    error: 'Failed to create container',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                },
                500
            )
        }
    })

    // Get job status
    const getJobRoute = createRoute({
        method: 'get',
        path: '/api/scheduler/jobs/{jobId}',
        tags: ['Jobs'],
        request: {
            params: z.object({
                jobId: z.string().openapi({
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
                        schema: z.object({
                            success: z.boolean(),
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
    })

    ;(app.openapi as any)(getJobRoute, async (c: any) => {
        try {
            const { jobId } = c.req.valid('param')

            const job = activeJobs.get(jobId)
            if (!job) {
                return c.json(
                    {
                        success: false,
                        error: 'Job not found',
                    },
                    404
                )
            }

            // Get container status
            const containerStatus = await containerAdapter.getStatus(
                job.containerId
            )

            return c.json({
                success: true,
                job: {
                    id: job.id,
                    containerId: job.containerId,
                    status: containerStatus || 'unknown',
                    meetingUrl: job.meetingUrl,
                    createdAt: job.createdAt,
                },
            })
        } catch (error) {
            logger.error('[API] Error getting job status:', error)
            return c.json(
                {
                    success: false,
                    error: 'Failed to get job status',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                },
                500
            )
        }
    })

    // Batch create jobs
    const batchCreateRoute = createRoute({
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
    })

    ;(app.openapi as any)(batchCreateRoute, async (c: any) => {
        try {
            const body = c.req.valid('json')

            const createdJobs = []
            const errors = []

            for (const jobRequest of body.jobs) {
                try {
                    const jobId = uuidv4()
                    const createdAt = new Date().toISOString()

                    const botConfig = {
                        meeting_url: jobRequest.meetingUrl,
                        bot_name: jobRequest.botName || 'Recording Bot',
                        email: jobRequest.email,
                        recording_mode:
                            jobRequest.recordingMode || 'speaker_view',
                        bot_uuid: jobId,
                        ...(jobRequest.config || {}),
                    }

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
                    })

                    if (result.status === 'failed') {
                        throw new Error(
                            result.message || 'Failed to provision container'
                        )
                    }

                    const containerId = result.containerId

                    activeJobs.set(jobId, {
                        id: jobId,
                        containerId,
                        meetingUrl: jobRequest.meetingUrl,
                        createdAt,
                    })

                    createdJobs.push({
                        id: jobId,
                        containerId,
                        meetingUrl: jobRequest.meetingUrl,
                        status: 'running',
                        createdAt,
                    })
                } catch (error) {
                    logger.error(
                        `[API] Error creating container for ${jobRequest.meetingUrl}:`,
                        error
                    )
                    errors.push({
                        meetingUrl: jobRequest.meetingUrl,
                        error:
                            error instanceof Error
                                ? error.message
                                : 'Unknown error',
                    })
                }
            }

            logger.info(`[API] Batch created: ${createdJobs.length} containers`)

            return c.json(
                {
                    success: true,
                    jobs: createdJobs,
                    count: createdJobs.length,
                    errors: errors.length > 0 ? errors : undefined,
                },
                201
            )
        } catch (error) {
            logger.error('[API] Error in batch creation:', error)
            return c.json(
                {
                    success: false,
                    error: 'Failed to create batch',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                },
                500
            )
        }
    })

    // Create meeting with full bot config
    const createMeetingRoute = createRoute({
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
    })

    ;(app.openapi as any)(createMeetingRoute, async (c: any) => {
        try {
            const body = c.req.valid('json')

            // Generate job ID
            const jobId = body.bot_uuid || uuidv4()
            const createdAt = new Date().toISOString()

            // Build complete bot configuration from request with scheduler defaults
            const botConfig = {
                // Required fields
                id: body.session_id || `meeting-bot-session-${jobId}`,
                meeting_url: body.meeting_url,
                bot_name: body.bot_name || 'Recording Bot',
                email: body.email || 'bot@scheduler.local',
                bot_uuid: jobId,
                recording_mode: body.recording_mode || 'speaker_view',

                // User/session info (defaults for scheduler mode)
                user_token: body.user_token || 'scheduler-token',
                user_id: body.user_id || 999,
                session_id: body.session_id || `scheduler-${jobId}`,

                // Environment config
                environ: 'scheduler',
                local_recording_server_location: 'docker',

                // Bot API config
                bots_api_key: body.bots_api_key || '',
                bots_webhook_url: body.bots_webhook_url,

                // Meeting settings
                enter_message: body.enter_message,
                automatic_leave: body.automatic_leave || {
                    waiting_room_timeout: 600,
                    noone_joined_timeout: 600,
                },
                custom_branding_bot_path: body.custom_branding_bot_path,

                // Storage config
                storage_provider: body.storage_provider || 'azure',
                mp4_s3_path: body.mp4_s3_path || `recordings/${jobId}.mp4`,
                aws_s3_temporary_audio_bucket: body.aws_s3_temporary_audio_bucket || 'scheduler-audio',
                azure_storage: body.azure_storage,

                // Speech/streaming config
                use_my_vocabulary: false,
                vocabulary: [],
                force_lang: false,
                speech_to_text_provider: body.speech_to_text_provider || 'Default',
                speech_to_text_api_key: '',
                streaming_input: body.streaming_input || '',
                streaming_output: body.streaming_output || '',
                streaming_audio_frequency: 24000,

                // Remote API (null for serverless mode)
                remote: null,

                // Additional config
                ...(body.config || {}),
            }

            // Remove undefined values
            Object.keys(botConfig).forEach((key) => {
                if (botConfig[key] === undefined) {
                    delete botConfig[key]
                }
            })

            logger.info(
                `[API] Creating meeting container for ${jobId}: ${body.meeting_url}`
            )

            // Create container directly
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
            })

            if (result.status === 'failed') {
                throw new Error(result.message || 'Failed to provision container')
            }

            const containerId = result.containerId

            // Store job info
            activeJobs.set(jobId, {
                id: jobId,
                containerId,
                meetingUrl: body.meeting_url,
                createdAt,
            })

            logger.info(
                `[API] Meeting container created: ${containerId} for job ${jobId}`
            )

            return c.json(
                {
                    success: true,
                    meeting: {
                        id: jobId,
                        containerId,
                        meetingUrl: body.meeting_url,
                        status: 'running',
                        createdAt,
                        botConfig,
                    },
                },
                201
            )
        } catch (error) {
            logger.error('[API] Error creating meeting container:', error)
            return c.json(
                {
                    success: false,
                    error: 'Failed to create meeting container',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                },
                500
            )
        }
    })

    return app
}
