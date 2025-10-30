/**
 * Bot Scheduler Server
 * Separate entry point for the job scheduler API
 */

import { serve } from '@hono/node-server'
import { createHonoApp } from './scheduler/api/honoApp'
import {
    PodmanAdapter,
    KubernetesAdapter,
    AzureContainerJobAdapter,
    GCPCloudRunAdapter,
    IContainerAdapter,
} from './scheduler'
import { logger } from './scheduler/utils/logger'

// Configuration from environment
const PORT = parseInt(process.env.PORT || '3000')
const PLATFORM = process.env.PLATFORM || 'podman'
const MAX_CONCURRENT_JOBS = parseInt(
    process.env.SCHEDULER_MAX_CONCURRENT_JOBS || '10'
)
const CONTAINER_IMAGE =
    process.env.SCHEDULER_CONTAINER_IMAGE || 'meet-teams-bot:latest'

/**
 * Create container adapter based on platform
 */
function createAdapter(): IContainerAdapter {
    switch (PLATFORM.toLowerCase()) {
        case 'podman':
        case 'docker':
            return new PodmanAdapter({
                containerEngine: PLATFORM as 'podman' | 'docker',
                recordingsPath: process.env.RECORDINGS_PATH,
                autoDetect: process.env.AUTO_DETECT_ENGINE === 'true',
            })

        case 'kubernetes':
        case 'k8s':
            return new KubernetesAdapter({
                namespace: process.env.K8S_NAMESPACE || 'default',
                kubeconfig: process.env.KUBECONFIG,
            })

        case 'azure':
            if (
                !process.env.AZURE_RESOURCE_GROUP ||
                !process.env.AZURE_JOB_NAME
            ) {
                throw new Error(
                    'Azure adapter requires AZURE_RESOURCE_GROUP and AZURE_JOB_NAME environment variables'
                )
            }
            return new AzureContainerJobAdapter({
                resourceGroup: process.env.AZURE_RESOURCE_GROUP,
                containerAppJobName: process.env.AZURE_JOB_NAME,
                location: process.env.AZURE_LOCATION,
            })

        case 'gcp':
            if (!process.env.GCP_PROJECT_ID || !process.env.GCP_JOB_NAME) {
                throw new Error(
                    'GCP adapter requires GCP_PROJECT_ID and GCP_JOB_NAME environment variables'
                )
            }
            return new GCPCloudRunAdapter({
                projectId: process.env.GCP_PROJECT_ID,
                region: process.env.GCP_REGION,
                jobName: process.env.GCP_JOB_NAME,
            })

        default:
            logger.warn(
                `Unknown platform '${PLATFORM}', defaulting to Podman adapter`
            )
            return new PodmanAdapter({ autoDetect: true })
    }
}

/**
 * Main server function
 */
async function main() {
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.log('   🤖 Meeting Bot Scheduler Server')
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')

    try {
        // Create container adapter
        logger.info(`Platform: ${PLATFORM}`)
        const adapter = createAdapter()
        logger.info('✅ Container adapter created')

        // Create Hono app (direct mode - no queuing)
        const app = createHonoApp(adapter, CONTAINER_IMAGE)

        // Start HTTP server
        const server = serve(
            {
                fetch: app.fetch,
                port: PORT,
            },
            (info) => {
                console.log('')
                logger.info(`🚀 Server listening on http://localhost:${info.port}`)
                logger.info(
                    `📊 Max concurrent jobs: ${MAX_CONCURRENT_JOBS}`
                )
                logger.info(`🐳 Container image: ${CONTAINER_IMAGE}`)
                console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
                console.log('   API Endpoints:')
                console.log(`   GET  http://localhost:${info.port}/`)
                console.log(`   GET  http://localhost:${info.port}/health`)
                console.log(`   GET  http://localhost:${info.port}/ui - Swagger UI`)
                console.log(`   GET  http://localhost:${info.port}/doc - OpenAPI Spec`)
                console.log(`   POST http://localhost:${info.port}/api/scheduler/jobs`)
                console.log(`   GET  http://localhost:${info.port}/api/scheduler/jobs/:jobId`)
                console.log(`   POST http://localhost:${info.port}/api/scheduler/jobs/batch`)
                console.log(`   GET  http://localhost:${info.port}/api/scheduler/stats`)
                console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n')
            }
        )

        // Graceful shutdown
        const shutdown = async (signal: string) => {
            logger.info(`\n${signal} received, shutting down gracefully...`)
            server.close(() => {
                logger.info('Server closed')
                process.exit(0)
            })

            // Force exit after 10 seconds
            setTimeout(() => {
                logger.error('Forcefully shutting down...')
                process.exit(1)
            }, 10000)
        }

        process.on('SIGTERM', () => shutdown('SIGTERM'))
        process.on('SIGINT', () => shutdown('SIGINT'))
    } catch (error) {
        logger.error('Failed to start scheduler server:', error)
        process.exit(1)
    }
}

// Run server
if (require.main === module) {
    main().catch((error) => {
        console.error('Fatal error:', error)
        process.exit(1)
    })
}

export { main }
