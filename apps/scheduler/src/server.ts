#!/usr/bin/env node
/**
 * Standalone HTTP Server for Scheduler (VM Deployment)
 *
 * This server runs the scheduler API using Hono on Node.js
 * Suitable for deployment on VMs, EC2, or any Node.js environment
 */

import { serve } from '@hono/node-server'
import { createHonoApp } from './scheduler/api/honoApp'
import { AzureContainerJobAdapter } from './scheduler/adapters/AzureContainerJobAdapter'
import { PodmanAdapter } from './scheduler/adapters/PodmanAdapter'
import { logger } from './scheduler/utils/logger'

// Configuration from environment variables
const PORT = parseInt(process.env.PORT || '3000', 10)
const HOST = process.env.HOST || '0.0.0.0'
const CONTAINER_ADAPTER = process.env.CONTAINER_ADAPTER || 'podman' // 'podman' or 'azure'
const CONTAINER_IMAGE = process.env.CONTAINER_IMAGE || 'skyfernaic01.azurecr.io/meet-teams-bot:latest'

// Azure configuration (if using Azure adapter)
const AZURE_SUBSCRIPTION_ID = process.env.AZURE_SUBSCRIPTION_ID
const AZURE_RESOURCE_GROUP = process.env.AZURE_RESOURCE_GROUP
const AZURE_CONTAINER_APP_JOB_NAME = process.env.AZURE_CONTAINER_APP_JOB_NAME
const AZURE_LOCATION = process.env.AZURE_LOCATION || 'eastus'

async function main() {
    logger.info('🚀 Starting Meeting Bot Scheduler Server...')
    logger.info(`   Port: ${PORT}`)
    logger.info(`   Host: ${HOST}`)
    logger.info(`   Container Adapter: ${CONTAINER_ADAPTER}`)
    logger.info(`   Container Image: ${CONTAINER_IMAGE}`)

    // Initialize container adapter based on configuration
    let containerAdapter

    if (CONTAINER_ADAPTER === 'azure') {
        if (!AZURE_SUBSCRIPTION_ID || !AZURE_RESOURCE_GROUP || !AZURE_CONTAINER_APP_JOB_NAME) {
            logger.error('❌ Azure adapter requires: AZURE_SUBSCRIPTION_ID, AZURE_RESOURCE_GROUP, AZURE_CONTAINER_APP_JOB_NAME')
            process.exit(1)
        }

        logger.info('   Using Azure Container Apps Jobs adapter')
        containerAdapter = new AzureContainerJobAdapter({
            subscriptionId: AZURE_SUBSCRIPTION_ID,
            resourceGroup: AZURE_RESOURCE_GROUP,
            containerAppJobName: AZURE_CONTAINER_APP_JOB_NAME,
            location: AZURE_LOCATION,
        })
    } else {
        logger.info('   Using Podman adapter (local containers)')
        containerAdapter = new PodmanAdapter()
    }

    // Create Hono app with container adapter
    const app = createHonoApp(containerAdapter, CONTAINER_IMAGE)

    // Start HTTP server
    const server = serve({
        fetch: app.fetch,
        port: PORT,
        hostname: HOST,
    })

    logger.info(`✅ Scheduler API running at http://${HOST}:${PORT}`)
    logger.info(`   📖 API Documentation: http://${HOST}:${PORT}/ui`)
    logger.info(`   ❤️  Health Check: http://${HOST}:${PORT}/health`)
    logger.info('')
    logger.info('Available endpoints:')
    logger.info(`   POST /api/scheduler/jobs - Create single job`)
    logger.info(`   POST /api/scheduler/jobs/batch - Create multiple jobs`)
    logger.info(`   POST /api/scheduler/meetings - Create meeting with full config`)
    logger.info(`   GET  /api/scheduler/jobs/:jobId - Get job status`)
    logger.info('')

    // Graceful shutdown
    process.on('SIGTERM', () => {
        logger.info('⏳ SIGTERM received, shutting down gracefully...')
        process.exit(0)
    })

    process.on('SIGINT', () => {
        logger.info('⏳ SIGINT received, shutting down gracefully...')
        process.exit(0)
    })
}

// Start server
main().catch((error) => {
    logger.error('❌ Failed to start server:', error)
    process.exit(1)
})
