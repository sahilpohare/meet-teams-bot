"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exampleJobSubmission = exports.startSchedulerApp = exports.createGCPScheduler = exports.createAzureScheduler = exports.createKubernetesScheduler = void 0;
const tslib_1 = require("tslib");
const express_1 = tslib_1.__importDefault(require("express"));
const index_1 = require("../index");
function createKubernetesScheduler() {
    const adapter = new index_1.KubernetesAdapter({
        namespace: 'bot-jobs',
    });
    const scheduler = new index_1.SchedulerService({
        containerAdapter: adapter,
        containerImage: 'meet-teams-bot:latest',
        maxConcurrentJobs: 10,
        pollingInterval: 5000,
    });
    return scheduler;
}
exports.createKubernetesScheduler = createKubernetesScheduler;
function createAzureScheduler() {
    const adapter = new index_1.AzureContainerJobAdapter({
        resourceGroup: process.env.AZURE_RESOURCE_GROUP || 'bot-rg',
        containerAppJobName: 'meeting-bot-job',
        location: 'eastus',
    });
    const scheduler = new index_1.SchedulerService({
        containerAdapter: adapter,
        containerImage: 'meet-teams-bot:latest',
        maxConcurrentJobs: 5,
    });
    return scheduler;
}
exports.createAzureScheduler = createAzureScheduler;
function createGCPScheduler() {
    const adapter = new index_1.GCPCloudRunAdapter({
        projectId: process.env.GCP_PROJECT_ID || 'my-project',
        region: 'us-central1',
        jobName: 'meeting-bot-job',
    });
    const scheduler = new index_1.SchedulerService({
        containerAdapter: adapter,
        containerImage: 'gcr.io/my-project/meet-teams-bot:latest',
        maxConcurrentJobs: 10,
    });
    return scheduler;
}
exports.createGCPScheduler = createGCPScheduler;
async function startSchedulerApp() {
    const app = (0, express_1.default)();
    app.use(express_1.default.json());
    let scheduler;
    const platform = process.env.PLATFORM || 'kubernetes';
    switch (platform) {
        case 'azure':
            scheduler = createAzureScheduler();
            break;
        case 'gcp':
            scheduler = createGCPScheduler();
            break;
        case 'kubernetes':
        default:
            scheduler = createKubernetesScheduler();
            break;
    }
    await scheduler.start();
    console.log(`Scheduler started on ${platform}`);
    app.use('/api/scheduler', (0, index_1.createSchedulerRoutes)(scheduler));
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
    });
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`Scheduler API listening on port ${PORT}`);
    });
    process.on('SIGTERM', async () => {
        console.log('SIGTERM received, shutting down gracefully');
        await scheduler.stop();
        process.exit(0);
    });
}
exports.startSchedulerApp = startSchedulerApp;
async function exampleJobSubmission() {
    const scheduler = createKubernetesScheduler();
    await scheduler.start();
    const job = await scheduler.submitJob({
        meetingUrl: 'https://meet.google.com/abc-def-ghi',
        botName: 'Recording Bot',
        email: 'bot@example.com',
        recordingMode: 'speaker_view',
        priority: 5,
        config: {
            customSetting: 'value',
        },
    });
    console.log(`Job submitted: ${job.id}`);
    setTimeout(async () => {
        const status = await scheduler.getJobStatus(job.id);
        console.log(`Job status:`, status);
    }, 5000);
}
exports.exampleJobSubmission = exampleJobSubmission;
if (require.main === module) {
    startSchedulerApp().catch((error) => {
        console.error('Failed to start scheduler app:', error);
        process.exit(1);
    });
}
//# sourceMappingURL=scheduler-example.js.map