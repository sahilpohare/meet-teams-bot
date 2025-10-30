# Job Scheduler System

A production-ready job scheduling system with adapter pattern for multi-cloud container provisioning.

## Overview

The scheduler provides a queue-based job management system that receives meeting recording requests via REST API, queues them, and provisions containers on various cloud platforms (Azure, GCP, Kubernetes, Cloudflare) using an adapter pattern.

## Architecture

```
┌──────────────────┐
│   REST API       │  ← HTTP Requests
│  /api/scheduler  │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ SchedulerService │  ← Queue Processor
│  - Job Queue     │
│  - Worker Pool   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ Container        │  ← Adapter Pattern
│    Adapter       │
└────────┬─────────┘
         │
    ┌────┴────┬─────────┬──────────┐
    │         │         │          │
    ▼         ▼         ▼          ▼
┌────────┐ ┌─────┐ ┌──────┐ ┌────────────┐
│ Azure  │ │ GCP │ │ K8s  │ │ Cloudflare │
└────────┘ └─────┘ └──────┘ └────────────┘
```

## Directory Structure

```
src/scheduler/
├── README.md                   # Detailed documentation
├── types.ts                    # TypeScript interfaces
├── SchedulerService.ts         # Core orchestration service
├── index.ts                    # Module exports
├── queue/
│   └── JobQueue.ts            # Job queue implementation
├── adapters/
│   ├── ContainerAdapter.ts    # Adapter interface
│   ├── AzureContainerJobAdapter.ts
│   ├── GCPCloudRunAdapter.ts
│   ├── KubernetesAdapter.ts
│   ├── CloudflareWorkersAdapter.ts
│   └── index.ts
├── api/
│   └── schedulerRoutes.ts     # REST API endpoints
├── utils/
│   └── logger.ts              # Logging utility
└── examples/
    └── scheduler-example.ts   # Integration examples
```

## Features

### Core Features
- ✅ **Priority Queue**: Jobs can be prioritized
- ✅ **Concurrent Execution**: Configurable max concurrent jobs
- ✅ **Job Status Tracking**: Real-time job status monitoring
- ✅ **Adapter Pattern**: Easy to add new cloud providers
- ✅ **REST API**: HTTP interface for job management
- ✅ **Batch Operations**: Submit multiple jobs at once
- ✅ **Health Checks**: Built-in health monitoring

### Supported Platforms
- ✅ **Azure Container Apps Jobs**
- ✅ **GCP Cloud Run Jobs**
- ✅ **Kubernetes Jobs**
- ✅ **Cloudflare Workers/Queues**

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Choose Your Platform

Create a scheduler with your preferred adapter:

```typescript
import { SchedulerService, KubernetesAdapter } from './src/scheduler'

// Kubernetes example
const adapter = new KubernetesAdapter({
    namespace: 'bot-jobs',
})

const scheduler = new SchedulerService({
    containerAdapter: adapter,
    containerImage: 'meet-teams-bot:latest',
    maxConcurrentJobs: 10,
})

await scheduler.start()
```

### 3. Integrate with Express

```typescript
import express from 'express'
import { createSchedulerRoutes } from './src/scheduler'

const app = express()
app.use(express.json())
app.use('/api/scheduler', createSchedulerRoutes(scheduler))

app.listen(3000, () => {
    console.log('Scheduler API running on port 3000')
})
```

## API Endpoints

### Submit Job

```bash
POST /api/scheduler/jobs
Content-Type: application/json

{
  "meetingUrl": "https://meet.google.com/abc-def-ghi",
  "botName": "Recording Bot",
  "email": "bot@example.com",
  "recordingMode": "speaker_view",
  "priority": 5,
  "config": {
    "customField": "value"
  }
}
```

**Response:**
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

### Get Job Status

```bash
GET /api/scheduler/jobs/:jobId
```

**Response:**
```json
{
  "success": true,
  "job": {
    "id": "A1B2C3D4E5F6G7H8",
    "status": "running",
    "containerId": "bot-job-a1b2c3d4",
    "startedAt": "2025-10-16T10:00:05.000Z",
    "metadata": {
      "platform": "kubernetes",
      "namespace": "bot-jobs"
    }
  }
}
```

### Get Statistics

```bash
GET /api/scheduler/stats
```

**Response:**
```json
{
  "success": true,
  "stats": {
    "queueSize": 3,
    "runningJobs": 5,
    "maxConcurrentJobs": 10
  }
}
```

### Batch Submit

```bash
POST /api/scheduler/jobs/batch
Content-Type: application/json

{
  "jobs": [
    {
      "meetingUrl": "https://meet.google.com/abc-def-ghi",
      "priority": 5
    },
    {
      "meetingUrl": "https://meet.google.com/xyz-123-456",
      "priority": 3
    }
  ]
}
```

### Health Check

```bash
GET /api/scheduler/health
```

## Adapter Configuration

### Kubernetes

```typescript
import { KubernetesAdapter } from './src/scheduler'

const adapter = new KubernetesAdapter({
    namespace: 'bot-jobs',              // Kubernetes namespace
    kubeconfig: '/path/to/kubeconfig',  // Optional, defaults to ~/.kube/config
})
```

### Azure Container Apps Jobs

```typescript
import { AzureContainerJobAdapter } from './src/scheduler'

const adapter = new AzureContainerJobAdapter({
    resourceGroup: 'my-resource-group',
    containerAppJobName: 'bot-job',
    location: 'eastus',
})
```

### GCP Cloud Run Jobs

```typescript
import { GCPCloudRunAdapter } from './src/scheduler'

const adapter = new GCPCloudRunAdapter({
    projectId: 'my-gcp-project',
    region: 'us-central1',
    jobName: 'bot-job',
})
```

### Cloudflare Workers

```typescript
import { CloudflareWorkersAdapter } from './src/scheduler'

const adapter = new CloudflareWorkersAdapter({
    accountId: 'my-account-id',
    apiToken: 'my-api-token',
    queueName: 'bot-jobs',
})
```

## Environment Variables

Configure the scheduler using environment variables:

```bash
# Platform selection
PLATFORM=kubernetes          # or azure, gcp, cloudflare

# Scheduler settings
SCHEDULER_POLLING_INTERVAL=5000        # Queue polling interval (ms)
SCHEDULER_MAX_CONCURRENT_JOBS=10       # Max concurrent jobs
SCHEDULER_CONTAINER_IMAGE=meet-teams-bot:latest
SCHEDULER_DEFAULT_CPU=1                # Default CPU allocation
SCHEDULER_DEFAULT_MEMORY=2Gi           # Default memory allocation

# Kubernetes
K8S_NAMESPACE=default
KUBECONFIG=/path/to/kubeconfig

# Azure
AZURE_RESOURCE_GROUP=my-rg
AZURE_JOB_NAME=bot-job
AZURE_LOCATION=eastus

# GCP
GCP_PROJECT_ID=my-project
GCP_REGION=us-central1
GCP_JOB_NAME=bot-job

# Cloudflare
CLOUDFLARE_ACCOUNT_ID=my-account
CLOUDFLARE_API_TOKEN=my-token
CLOUDFLARE_QUEUE_NAME=bot-jobs
```

## Custom Adapters

Create your own adapter by implementing `IContainerAdapter`:

```typescript
import { IContainerAdapter, ContainerConfig, ProvisionResult } from './src/scheduler'

class MyCustomAdapter implements IContainerAdapter {
    async provision(config: ContainerConfig): Promise<ProvisionResult> {
        // Your provisioning logic
        return {
            containerId: 'my-container-id',
            status: 'success',
            metadata: { platform: 'custom' }
        }
    }

    async getStatus(containerId: string): Promise<'running' | 'completed' | 'failed' | 'unknown'> {
        // Your status check logic
        return 'running'
    }

    async stop(containerId: string): Promise<void> {
        // Your stop logic
    }

    async getLogs(containerId: string): Promise<string> {
        // Your logs retrieval logic
        return 'Container logs...'
    }

    async cleanup(containerId: string): Promise<void> {
        // Your cleanup logic
    }
}
```

## Testing

Run the example:

```bash
# Set your platform
export PLATFORM=kubernetes

# Run the example
npx ts-node src/scheduler/examples/scheduler-example.ts
```

Test with curl:

```bash
# Submit a job
curl -X POST http://localhost:3000/api/scheduler/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "meetingUrl": "https://meet.google.com/abc-def-ghi",
    "botName": "Test Bot",
    "priority": 5
  }'

# Get job status
curl http://localhost:3000/api/scheduler/jobs/A1B2C3D4E5F6G7H8

# Get stats
curl http://localhost:3000/api/scheduler/stats

# Health check
curl http://localhost:3000/api/scheduler/health
```

## Production Considerations

### Queue Backend
Replace `InMemoryJobQueue` with a persistent queue:
- **Redis**: High performance, pub/sub support
- **RabbitMQ**: Advanced routing, durable queues
- **AWS SQS**: Managed, scalable
- **GCP Pub/Sub**: Managed, global
- **Azure Service Bus**: Enterprise features

### State Persistence
Store job states in a database:
- **PostgreSQL**: Relational, reliable
- **MongoDB**: Document-based, flexible
- **DynamoDB**: Serverless, scalable
- **Redis**: Fast, ephemeral

### Monitoring & Observability
- Add Prometheus metrics endpoints
- Integrate with Grafana dashboards
- Use distributed tracing (Jaeger, Zipkin)
- Set up alerts for queue depth and failures

### Security
- Implement API authentication (JWT, OAuth)
- Add rate limiting per client
- Validate and sanitize inputs
- Use secrets management (Vault, Key Vault)
- Enable HTTPS/TLS

### Reliability
- Add retry logic with exponential backoff
- Implement dead letter queues
- Set up job timeouts
- Enable graceful shutdown
- Add circuit breakers

### Scalability
- Deploy multiple scheduler workers
- Use load balancer for API
- Implement horizontal pod autoscaling
- Optimize polling intervals
- Add job priority levels

## Troubleshooting

### Jobs stuck in queue
- Check if scheduler worker is running
- Verify max concurrent jobs limit
- Check adapter connectivity

### Container provisioning fails
- Verify cloud credentials
- Check resource quotas
- Review adapter logs

### High memory usage
- Reduce max concurrent jobs
- Optimize queue cleanup
- Check for memory leaks in adapters

## License

Apache 2.0

## Contributing

See CONTRIBUTING.md for guidelines.
