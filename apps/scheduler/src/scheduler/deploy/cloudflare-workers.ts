/**
 * Cloudflare Workers Handler
 * Entry point for deploying scheduler API to Cloudflare Workers
 */

import { createHonoApp } from '../api/honoApp'
import { CloudflareWorkersAdapter } from '../index'
import { IContainerAdapter } from '../adapters/ContainerAdapter'

// Type for Cloudflare Workers ExecutionContext
interface ExecutionContext {
    waitUntil(promise: Promise<any>): void
    passThroughOnException(): void
}

// Create adapter instance (singleton)
let adapter: IContainerAdapter | null = null

function getAdapter(env: any): IContainerAdapter {
    if (!adapter) {
        adapter = new CloudflareWorkersAdapter({
            accountId: env.CLOUDFLARE_ACCOUNT_ID || '',
            apiToken: env.CLOUDFLARE_API_TOKEN || '',
            queueName: env.CLOUDFLARE_QUEUE_NAME || 'bot-jobs',
        })
    }
    return adapter
}

// Cloudflare Workers fetch handler
export default {
    async fetch(
        request: Request,
        env: any,
        ctx: ExecutionContext
    ): Promise<Response> {
        try {
            const adapter = getAdapter(env)
            const containerImage = env.CONTAINER_IMAGE || 'meet-teams-bot:latest'
            const app = createHonoApp(adapter, containerImage)
            // Pass ctx as any to avoid type mismatch with Hono's ExecutionContext
            return await app.fetch(request, env, ctx as any)
        } catch (error) {
            return new Response(
                JSON.stringify({
                    error: 'Internal server error',
                    message:
                        error instanceof Error
                            ? error.message
                            : 'Unknown error',
                }),
                {
                    status: 500,
                    headers: { 'Content-Type': 'application/json' },
                }
            )
        }
    },
}
