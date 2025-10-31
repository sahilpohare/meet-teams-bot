"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const functions_1 = require("@azure/functions");
const honoApp_1 = require("../scheduler/api/honoApp");
const scheduler_1 = require("../scheduler");
const logger_1 = require("../scheduler/utils/logger");
let containerAdapter = null;
function getAdapter() {
    if (!containerAdapter) {
        const platform = process.env.PLATFORM || 'azure';
        if (platform !== 'azure') {
            throw new Error('Only Azure platform is supported in Functions');
        }
        const resourceGroup = process.env.AZURE_RESOURCE_GROUP;
        const jobName = process.env.AZURE_JOB_NAME;
        if (!resourceGroup || !jobName) {
            throw new Error('AZURE_RESOURCE_GROUP and AZURE_JOB_NAME environment variables are required');
        }
        containerAdapter = new scheduler_1.AzureContainerJobAdapter({
            resourceGroup,
            containerAppJobName: jobName,
            location: process.env.AZURE_LOCATION,
        });
        logger_1.logger.info('✅ Azure Container Job adapter initialized');
    }
    return containerAdapter;
}
const containerImage = process.env.SCHEDULER_CONTAINER_IMAGE || 'meet-teams-bot:latest';
const honoApp = (0, honoApp_1.createHonoApp)(getAdapter(), containerImage);
async function schedulerHandler(request, context) {
    try {
        logger_1.logger.info(`[${request.method}] ${request.url}`);
        const url = new URL(request.url);
        const fetchRequest = new Request(url.toString(), {
            method: request.method,
            headers: request.headers,
            body: request.body,
        });
        const response = await honoApp.fetch(fetchRequest);
        const body = await response.text();
        return {
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            body: body,
        };
    }
    catch (error) {
        logger_1.logger.error('Function error:', error);
        return {
            status: 500,
            jsonBody: {
                success: false,
                error: 'Internal server error',
                message: error instanceof Error ? error.message : 'Unknown error',
            },
        };
    }
}
functions_1.app.http('scheduler', {
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    authLevel: 'anonymous',
    route: '{*path}',
    handler: schedulerHandler,
});
exports.default = schedulerHandler;
//# sourceMappingURL=scheduler.js.map