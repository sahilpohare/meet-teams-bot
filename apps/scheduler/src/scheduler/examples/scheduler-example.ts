/**
 * Scheduler Integration Example
 * Shows how to integrate the scheduler with your Express app
 */

import express from 'express'
import {
    SchedulerService,
    createSchedulerRoutes,
    KubernetesAdapter,
    AzureContainerJobAdapter,
    GCPCloudRunAdapter,
} from '../index'

// Example 1: Using Kubernetes Adapter
function createKubernetesScheduler() {
    const adapter = new KubernetesAdapter({
        namespace: 'bot-jobs',
    })

    const scheduler = new SchedulerService({
        containerAdapter: adapter,
        containerImage: 'meet-teams-bot:latest',
        maxConcurrentJobs: 10,
        pollingInterval: 5000,
    })

    return scheduler
}

// Example 2: Using Azure Container Apps Jobs Adapter
function createAzureScheduler() {
    const adapter = new AzureContainerJobAdapter({
        resourceGroup: process.env.AZURE_RESOURCE_GROUP || 'bot-rg',
        containerAppJobName: 'meeting-bot-job',
        location: 'eastus',
    })

    const scheduler = new SchedulerService({
        containerAdapter: adapter,
        containerImage: 'meet-teams-bot:latest',
        maxConcurrentJobs: 5,
    })

    return scheduler
}

// Example 3: Using GCP Cloud Run Jobs Adapter
function createGCPScheduler() {
    const adapter = new GCPCloudRunAdapter({
        projectId: process.env.GCP_PROJECT_ID || 'my-project',
        region: 'us-central1',
        jobName: 'meeting-bot-job',
    })

    const scheduler = new SchedulerService({
        containerAdapter: adapter,
        containerImage: 'gcr.io/my-project/meet-teams-bot:latest',
        maxConcurrentJobs: 10,
    })

    return scheduler
}

// Example 4: Full Express Application
async function startSchedulerApp() {
    const app = express()
    app.use(express.json())

    // Choose your adapter based on environment
    let scheduler: SchedulerService
    const platform = process.env.PLATFORM || 'kubernetes'

    switch (platform) {
        case 'azure':
            scheduler = createAzureScheduler()
            break
        case 'gcp':
            scheduler = createGCPScheduler()
            break
        case 'kubernetes':
        default:
            scheduler = createKubernetesScheduler()
            break
    }

    // Start scheduler worker
    await scheduler.start()
    console.log(`Scheduler started on ${platform}`)

    // Mount API routes
    app.use('/api/scheduler', createSchedulerRoutes(scheduler))

    // Health check endpoint
    app.get('/health', (req, res) => {
        res.json({ status: 'ok', timestamp: new Date().toISOString() })
    })

    // Start server
    const PORT = process.env.PORT || 3000
    app.listen(PORT, () => {
        console.log(`Scheduler API listening on port ${PORT}`)
    })

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        console.log('SIGTERM received, shutting down gracefully')
        await scheduler.stop()
        process.exit(0)
    })
}

// Example 5: Programmatic Job Submission
async function exampleJobSubmission() {
    const scheduler = createKubernetesScheduler()
    await scheduler.start()

    // Submit a single job
    const job = await scheduler.submitJob({
        meetingUrl: 'https://meet.google.com/abc-def-ghi',
        botName: 'Recording Bot',
        email: 'bot@example.com',
        recordingMode: 'speaker_view',
        priority: 5,
        config: {
            customSetting: 'value',
        },
    })

    console.log(`Job submitted: ${job.id}`)

    // Check job status
    setTimeout(async () => {
        const status = await scheduler.getJobStatus(job.id)
        console.log(`Job status:`, status)
    }, 5000)
}

// Export for use in other modules
export {
    createKubernetesScheduler,
    createAzureScheduler,
    createGCPScheduler,
    startSchedulerApp,
    exampleJobSubmission,
}

// Run if executed directly
if (require.main === module) {
    startSchedulerApp().catch((error) => {
        console.error('Failed to start scheduler app:', error)
        process.exit(1)
    })
}
