"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const honoApp_1 = require("../api/honoApp");
const index_1 = require("../index");
let adapter = null;
function getAdapter(env) {
    if (!adapter) {
        adapter = new index_1.CloudflareWorkersAdapter({
            accountId: env.CLOUDFLARE_ACCOUNT_ID || '',
            apiToken: env.CLOUDFLARE_API_TOKEN || '',
            queueName: env.CLOUDFLARE_QUEUE_NAME || 'bot-jobs',
        });
    }
    return adapter;
}
exports.default = {
    async fetch(request, env, ctx) {
        try {
            const adapter = getAdapter(env);
            const containerImage = env.CONTAINER_IMAGE || 'meet-teams-bot:latest';
            const app = (0, honoApp_1.createHonoApp)(adapter, containerImage);
            return await app.fetch(request, env, ctx);
        }
        catch (error) {
            return new Response(JSON.stringify({
                error: 'Internal server error',
                message: error instanceof Error
                    ? error.message
                    : 'Unknown error',
            }), {
                status: 500,
                headers: { 'Content-Type': 'application/json' },
            });
        }
    },
};
//# sourceMappingURL=cloudflare-workers.js.map