/**
 * Azure Functions Handler
 * Entry point for deploying scheduler API to Azure Functions
 */

// @ts-ignore - @azure/functions may not be installed in all environments
import { app as azureApp, HttpRequest, HttpResponseInit, InvocationContext } from '@azure/functions'
import { createHonoApp } from '../api/honoApp'
import { AzureContainerJobAdapter } from '../index'
import { IContainerAdapter } from '../adapters/ContainerAdapter'

// Create adapter instance (singleton)
let adapter: IContainerAdapter | null = null
const containerImage = process.env.CONTAINER_IMAGE || 'meet-teams-bot:latest'

function getAdapter(): IContainerAdapter {
    if (!adapter) {
        adapter = new AzureContainerJobAdapter({
            resourceGroup: process.env.AZURE_RESOURCE_GROUP || '',
            containerAppJobName: process.env.AZURE_JOB_NAME || '',
            location: process.env.AZURE_LOCATION || 'eastus',
        })
    }
    return adapter
}

// Azure Functions HTTP handler
export async function schedulerHandler(
    request: HttpRequest,
    context: InvocationContext
): Promise<HttpResponseInit> {
    try {
        const adapter = getAdapter()
        const app = createHonoApp(adapter, containerImage)

        // Convert Azure Functions request to Hono request
        const url = new URL(request.url)
        const honoRequest = new Request(url, {
            method: request.method,
            headers: request.headers as any,
            body: request.body,
        })

        // Get response from Hono app
        const honoResponse = await app.fetch(honoRequest)

        // Convert Hono response to Azure Functions response
        return {
            status: honoResponse.status,
            headers: Object.fromEntries(honoResponse.headers.entries()),
            body: await honoResponse.text(),
        }
    } catch (error) {
        context.error('Error processing request:', error)
        return {
            status: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error',
            }),
        }
    }
}

// Register Azure Function
azureApp.http('scheduler', {
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    authLevel: 'anonymous',
    route: '{*path}',
    handler: schedulerHandler,
})
