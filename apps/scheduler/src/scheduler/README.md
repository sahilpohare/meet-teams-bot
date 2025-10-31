
# Job Scheduler

A flexible job scheduling system with adapter pattern for multi-cloud container provisioning.

## Architecture

```
┌─────────────┐
│  REST API   │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ SchedulerService│
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌────────┐ ┌──────────────┐
│  Queue │ │ContainerAdapter│
└────────┘ └───────┬────────┘
                   │
      ┌────────────┼────────────┬──────────────┐
      │            │            │              │
      ▼            ▼            ▼              ▼
  ┌──────┐   ┌────────┐   ┌────────┐   ┌────────────┐
  │Azure │   │  GCP   │   │  K8s   │   │Cloudflare  │
  └──────┘   └────────┘   └────────┘   └────────────┘
```

## Features

- **Queue Management**: Priority-based job queuing
- **Adapter Pattern**: Platform-agnostic container provisioning
- **Multiple Backends**: Azure, GCP, Kubernetes, Cloudflare
- **Monitoring**: Job status tracking and statistics
- **REST API**: Easy integration with HTTP endpoints
- **Batch Processing**: Submit multiple jobs at once

## Usage

### Initialize Scheduler

```typescript
import { SchedulerService, KubernetesAdapter } from './scheduler'

// Create adapter (choose one)
const adapter = new KubernetesAdapter({
    namespace: 'bot-jobs',
})

// Initialize scheduler
const scheduler = new SchedulerService({
    containerAdapter: adapter,
    containerImage: 'meet-teams-bot:latest',
    maxConcurrentJobs: 10,
})

// Start processing
await scheduler.start()
```

### Submit Jobs via API

```typescript
import express from 'express'
import { createSchedulerRoutes } from './scheduler'

const app = express()
app.use(express.json())
app.use('/api/scheduler', createSchedulerRoutes(scheduler))

app.listen(3000)
```

### API Endpoints

#### Submit Job

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
    "custom_field": "value"
  }
}
```

#### Get Job Status

```bash
GET /api/scheduler/jobs/:jobId
```

#### Get Statistics

```bash
GET /api/scheduler/stats
```

#### Batch Submit

```bash
POST /api/scheduler/jobs/batch
```

#### Health Check

```bash
GET /api/scheduler/health
```

## Adapters

### Kubernetes

```typescript
import { KubernetesAdapter } from './scheduler'

const adapter = new KubernetesAdapter({
    namespace: 'bot-jobs',
    kubeconfig: '/path/to/kubeconfig', // optional
})
```

### Azure Container Apps Jobs

```typescript
import { AzureContainerJobAdapter } from './scheduler'

const adapter = new AzureContainerJobAdapter({
    resourceGroup: 'my-resource-group',
    containerAppJobName: 'bot-job',
    location: 'eastus',
})
```

### GCP Cloud Run Jobs

```typescript
import { GCPCloudRunAdapter } from './scheduler'

const adapter = new GCPCloudRunAdapter({
    projectId: 'my-gcp-project',
    region: 'us-central1',
    jobName: 'bot-job',
})
```

### Cloudflare Workers

```typescript
import { CloudflareWorkersAdapter } from './scheduler'

const adapter = new CloudflareWorkersAdapter({
    accountId: 'my-account-id',
    apiToken: 'my-api-token',
    queueName: 'bot-jobs',
})
```

## Custom Adapters

Create your own adapter by implementing `IContainerAdapter`:

```typescript
import { IContainerAdapter, ContainerConfig, ProvisionResult } from './scheduler'

class MyCustomAdapter implements IContainerAdapter {
    async provision(config: ContainerConfig): Promise<ProvisionResult> {
        // Your provisioning logic
        return {
            containerId: 'my-container-id',
            status: 'success',
        }
    }

    async getStatus(containerId: string): Promise<'running' | 'completed' | 'failed' | 'unknown'> {
        return 'running'
    }

    async stop(containerId: string): Promise<void> {}
    async getLogs(containerId: string): Promise<string> { return 'logs' }
    async cleanup(containerId: string): Promise<void> {}
}
```

## Environment Variables

- `SCHEDULER_POLLING_INTERVAL` - Queue polling interval in ms (default: 5000)
- `SCHEDULER_MAX_CONCURRENT_JOBS` - Max concurrent jobs (default: 10)
- `SCHEDULER_CONTAINER_IMAGE` - Docker image to use (default: meet-teams-bot:latest)
- `SCHEDULER_DEFAULT_CPU` - Default CPU allocation (default: "1")
- `SCHEDULER_DEFAULT_MEMORY` - Default memory allocation (default: "2Gi")

## Production Considerations

1. **Queue Backend**: Replace `InMemoryJobQueue` with Redis, RabbitMQ, or cloud-native queues
2. **State Persistence**: Store job states in a database (PostgreSQL, MongoDB)
3. **Monitoring**: Add Prometheus metrics and health checks
4. **Authentication**: Add API authentication and authorization
5. **Rate Limiting**: Implement rate limiting for API endpoints
6. **Error Handling**: Add retry logic and dead letter queues
7. **Logging**: Integrate with centralized logging (ELK, CloudWatch)
8. **Secrets Management**: Use Vault, Azure Key Vault, or GCP Secret Manager
