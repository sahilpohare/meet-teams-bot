/**
 * Azure Functions HTTP Trigger for Meeting Bot Scheduler
 * Handles all scheduler API requests through a single function
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { createHonoApp } from '../scheduler/api/honoApp'
import {
    AzureContainerJobAdapter,
    IContainerAdapter,
} from '../scheduler'
import { logger } from '../scheduler/utils/logger'

// Initialize container adapter
let containerAdapter: IContainerAdapter | null = null

function getAdapter(): IContainerAdapter {
    if (!containerAdapter) {
        const platform = process.env.PLATFORM || 'azure'

        if (platform !== 'azure') {
            throw new Error('Only Azure platform is supported in Functions')
        }

        const resourceGroup = process.env.AZURE_RESOURCE_GROUP
        const jobName = process.env.AZURE_JOB_NAME

        if (!resourceGroup || !jobName) {
            throw new Error(
                'AZURE_RESOURCE_GROUP and AZURE_JOB_NAME environment variables are required'
            )
        }

        containerAdapter = new AzureContainerJobAdapter({
            resourceGroup,
            containerAppJobName: jobName,
            location: process.env.AZURE_LOCATION,
        })

        logger.info('✅ Azure Container Job adapter initialized')
    }

    return containerAdapter
}

// Initialize Hono app
const containerImage = process.env.SCHEDULER_CONTAINER_IMAGE || 'meet-teams-bot:latest'
const honoApp = createHonoApp(getAdapter(), containerImage)

/**
 * Azure Functions HTTP handler
 * Routes all requests to the Hono app
 */
async function schedulerHandler(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    try {
        logger.info(`[${request.method}] ${request.url}`)

        // Convert Azure Functions request to Fetch API request
        const url = new URL(request.url)
        const fetchRequest = new Request(url.toString(), {
            method: request.method,
            headers: request.headers as HeadersInit,
            body: request.body,
        })

        // Process request with Hono
        const response = await honoApp.fetch(fetchRequest)

        // Convert Hono response to Azure Functions response
        const body = await response.text()

        return {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body: body,
        }
    } catch (error) {
        logger.error('Function error:', error)
        return {
            status: 500,
            jsonBody: {
                success: false,
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error',
            },
        }
    }
}

// Register HTTP trigger for all routes
app.http('scheduler', {
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    authLevel: 'anonymous',
    route: '{*path}',
    handler: schedulerHandler,
})

export default schedulerHandler
