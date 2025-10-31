# Scheduler API - Quick Start Guide

## What is it?

A job scheduling system that receives HTTP requests to record meetings, queues them, and provisions containers on cloud platforms (Azure, GCP, Kubernetes, or Cloudflare) using an adapter pattern.

## How it works

1. **HTTP Request** → POST to `/api/scheduler/jobs` with meeting URL
2. **Queue** → Job is added to priority queue
3. **Worker** → Scheduler worker picks up job from queue
4. **Provision** → Container adapter provisions a container on your cloud platform
5. **Monitor** → Job status tracked until completion

## Quick Setup (3 steps)

### 1. Choose your platform

```typescript
// Option 1: Kubernetes (recommended)
import { SchedulerService, KubernetesAdapter } from './src/scheduler'

const adapter = new KubernetesAdapter({ namespace: 'bot-jobs' })

// Option 2: Azure
import { AzureContainerJobAdapter } from './src/scheduler'
const adapter = new AzureContainerJobAdapter({
    resourceGroup: 'my-rg',
    containerAppJobName: 'bot-job',
    location: 'eastus'
})

// Option 3: GCP
import { GCPCloudRunAdapter } from './src/scheduler'
const adapter = new GCPCloudRunAdapter({
    projectId: 'my-project',
    region: 'us-central1',
    jobName: 'bot-job'
})
```

### 2. Create scheduler and start worker

```typescript
const scheduler = new SchedulerService({
    containerAdapter: adapter,
    containerImage: 'meet-teams-bot:latest',
    maxConcurrentJobs: 10
})

await scheduler.start()
```

### 3. Mount API routes

```typescript
import express from 'express'
import { createSchedulerRoutes } from './src/scheduler'

const app = express()
app.use(express.json())
app.use('/api/scheduler', createSchedulerRoutes(scheduler))
app.listen(3000)
```

## Usage Examples

### Submit a job

```bash
curl -X POST http://localhost:3000/api/scheduler/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "meetingUrl": "https://meet.google.com/abc-def-ghi",
    "botName": "Recording Bot",
    "priority": 5
  }'
```

Response:
```json
{
  "success": true,
  "job": {
    "id": "A1B2C3D4E5F6G7H8",
    "meetingUrl": "https://meet.google.com/abc-def-ghi",
    "status": "queued",
    "createdAt": "2025-10-16T10:00:00.000Z"
  }
}
```

### Check job status

```bash
curl http://localhost:3000/api/scheduler/jobs/A1B2C3D4E5F6G7H8
```

### Get statistics

```bash
curl http://localhost:3000/api/scheduler/stats
```

### Health check

```bash
curl http://localhost:3000/api/scheduler/health
```

## Complete Example

Save this as `scheduler-server.ts`:

```typescript
import express from 'express'
import {
    SchedulerService,
    KubernetesAdapter,
    createSchedulerRoutes
} from './src/scheduler'

async function main() {
    // Initialize adapter
    const adapter = new KubernetesAdapter({
        namespace: process.env.K8S_NAMESPACE || 'default'
    })

    // Create scheduler
    const scheduler = new SchedulerService({
        containerAdapter: adapter,
        containerImage: process.env.CONTAINER_IMAGE || 'meet-teams-bot:latest',
        maxConcurrentJobs: parseInt(process.env.MAX_JOBS || '10')
    })

    // Start worker
    await scheduler.start()
    console.log('✅ Scheduler worker started')

    // Setup Express
    const app = express()
    app.use(express.json())
    
    // Mount scheduler routes
    app.use('/api/scheduler', createSchedulerRoutes(scheduler))
    
    // Health check
    app.get('/health', (req, res) => {
        res.json({ status: 'ok' })
    })

    // Start server
    const PORT = process.env.PORT || 3000
    app.listen(PORT, () => {
        console.log(`🚀 Scheduler API running on port ${PORT}`)
    })

    // Graceful shutdown
    process.on('SIGTERM', async () => {
        console.log('Shutting down...')
        await scheduler.stop()
        process.exit(0)
    })
}

main().catch(console.error)
```

Run it:
```bash
npx ts-node scheduler-server.ts
```

## API Reference

### POST /api/scheduler/jobs
Submit a new job

**Body:**
```json
{
  "meetingUrl": "string (required)",
  "botName": "string (optional)",
  "email": "string (optional)",
  "recordingMode": "string (optional)",
  "priority": "number (optional, 0-10)",
  "config": "object (optional)"
}
```

### GET /api/scheduler/jobs/:jobId
Get job status

### POST /api/scheduler/jobs/batch
Submit multiple jobs

**Body:**
```json
{
  "jobs": [
    { "meetingUrl": "...", "priority": 5 },
    { "meetingUrl": "...", "priority": 3 }
  ]
}
```

### GET /api/scheduler/stats
Get scheduler statistics

### GET /api/scheduler/health
Health check endpoint

## Job Status Flow

```
queued → provisioning → running → completed
                         ↓
                       failed
```

## Environment Variables

```bash
# Platform (kubernetes, azure, gcp, cloudflare)
PLATFORM=kubernetes

# Scheduler settings
MAX_JOBS=10
CONTAINER_IMAGE=meet-teams-bot:latest

# Kubernetes
K8S_NAMESPACE=default

# Azure
AZURE_RESOURCE_GROUP=my-rg
AZURE_JOB_NAME=bot-job

# GCP
GCP_PROJECT_ID=my-project
GCP_JOB_NAME=bot-job
```

## Files Created

```
src/scheduler/
├── README.md                          # Full documentation
├── types.ts                           # TypeScript interfaces
├── SchedulerService.ts                # Core service
├── index.ts                           # Exports
├── queue/JobQueue.ts                  # Queue implementation
├── adapters/
│   ├── ContainerAdapter.ts           # Interface
│   ├── AzureContainerJobAdapter.ts   # Azure implementation
│   ├── GCPCloudRunAdapter.ts         # GCP implementation
│   ├── KubernetesAdapter.ts          # K8s implementation
│   └── CloudflareWorkersAdapter.ts   # Cloudflare implementation
├── api/schedulerRoutes.ts            # REST API
├── utils/logger.ts                    # Logger
└── examples/scheduler-example.ts      # Examples
```

## Next Steps

1. **Production**: Replace `InMemoryJobQueue` with Redis or RabbitMQ
2. **Persistence**: Store job states in PostgreSQL/MongoDB
3. **Monitoring**: Add Prometheus metrics
4. **Security**: Add authentication/authorization
5. **Scaling**: Deploy multiple workers with load balancer

See `SCHEDULER.md` for detailed documentation and production considerations.
