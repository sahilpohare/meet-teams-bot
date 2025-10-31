"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.schedulerHandler = void 0;
const functions_1 = require("@azure/functions");
const honoApp_1 = require("../api/honoApp");
const index_1 = require("../index");
let adapter = null;
const containerImage = process.env.CONTAINER_IMAGE || 'meet-teams-bot:latest';
function getAdapter() {
    if (!adapter) {
        adapter = new index_1.AzureContainerJobAdapter({
            resourceGroup: process.env.AZURE_RESOURCE_GROUP || '',
            containerAppJobName: process.env.AZURE_JOB_NAME || '',
            location: process.env.AZURE_LOCATION || 'eastus',
        });
    }
    return adapter;
}
async function schedulerHandler(request, context) {
    try {
        const adapter = getAdapter();
        const app = (0, honoApp_1.createHonoApp)(adapter, containerImage);
        const url = new URL(request.url);
        const honoRequest = new Request(url, {
            method: request.method,
            headers: request.headers,
            body: request.body,
        });
        const honoResponse = await app.fetch(honoRequest);
        return {
            status: honoResponse.status,
            headers: Object.fromEntries(honoResponse.headers.entries()),
            body: await honoResponse.text(),
        };
    }
    catch (error) {
        context.error('Error processing request:', error);
        return {
            status: 500,
            body: JSON.stringify({
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error',
            }),
        };
    }
}
exports.schedulerHandler = schedulerHandler;
functions_1.app.http('scheduler', {
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
    authLevel: 'anonymous',
    route: '{*path}',
    handler: schedulerHandler,
});
//# sourceMappingURL=azure-functions.js.map