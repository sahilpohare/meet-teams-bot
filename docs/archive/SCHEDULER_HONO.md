# Bot Scheduler - Hono API

The Bot Scheduler is a **separate project** within this repository that provides a REST API for scheduling and managing meeting recording bot jobs. It's built with [Hono](https://hono.dev/), making it deployable to multiple platforms.

## Two Projects in One Repository

### 1. Meeting Bot (Original)
- **Entry Point**: `src/main.ts`
- **Purpose**: Core meeting recording bot
- **Usage**: Direct bot execution via `run_bot.js`

### 2. Bot Scheduler (New)
- **Entry Point**: `src/scheduler-server.ts`
- **Purpose**: API for scheduling bot jobs
- **Usage**: HTTP API for job management

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Bot Scheduler API                  │
│              (Hono Framework)                   │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│           Scheduler Service                     │
│   - Job Queue (Priority-based)                 │
│   - Worker Pool (Concurrent execution)         │
│   - Job Status Tracking                        │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│         Container Adapter (Pluggable)           │
└─────────────────────────────────────────────────┘
                      │
        ┌─────────────┼──────────────┬───────────┐
        │             │              │           │
        ▼             ▼              ▼           ▼
  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌─────────┐
  │ Podman  │  │Kubernetes│  │  Azure  │  │   GCP   │
  │ Docker  │  │   Jobs   │  │Container│  │CloudRun │
  └─────────┘  └──────────┘  │AppJobs  │  │  Jobs   │
                              └─────────┘  └─────────┘
```

## Podman Adapter

The **PodmanAdapter** recreates the functionality of `run_bot.js`, allowing you to:
- Run bot containers locally using Podman or Docker
- Auto-detect available container engine
- Track running containers and their status
- Manage recordings output

### How It Works

1. **Job Submission** → API receives job request
2. **Queue** → Job added to priority queue
3. **Worker Picks Up** → Scheduler worker processes job
4. **Container Spawn** → Podman/Docker container started with bot config
5. **Monitor** → Container tracked until completion
6. **Output** → Recordings saved to local filesystem

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.scheduler .env

# Edit .env with your settings
nano .env
```

### 3. Build the Scheduler

```bash
npm run build:scheduler
```

### 4. Start the Scheduler Server

```bash
# Development mode (with auto-reload)
npm run dev:scheduler

# Production mode
npm run start:scheduler
```

The server will start on `http://localhost:3000` (or your configured PORT).

## API Usage

### Submit a Job

```bash
curl -X POST http://localhost:3000/api/scheduler/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "meetingUrl": "https://meet.google.com/abc-def-ghi",
    "botName": "Recording Bot",
    "email": "bot@example.com",
    "recordingMode": "speaker_view",
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
    "createdAt": "2025-10-16T12:00:00.000Z"
  }
}
```

### Check Job Status

```bash
curl http://localhost:3000/api/scheduler/jobs/A1B2C3D4E5F6G7H8
```

### Get Statistics

```bash
curl http://localhost:3000/api/scheduler/stats
```

### Health Check

```bash
curl http://localhost:3000/health
```

## Platform-Specific Deployment

### Local (Podman/Docker)

```bash
# Using Podman (default)
PLATFORM=podman npm run start:scheduler

# Using Docker
PLATFORM=docker npm run start:scheduler

# Auto-detect
AUTO_DETECT_ENGINE=true npm run start:scheduler
```

### Kubernetes

```bash
PLATFORM=kubernetes \
K8S_NAMESPACE=bot-jobs \
npm run start:scheduler
```

### Azure Functions

1. Install Azure Functions Core Tools
2. Deploy using `src/scheduler/deploy/azure-functions.ts`

```bash
func init --worker-runtime node --language typescript
func deploy --name my-scheduler-app
```

### Cloudflare Workers

1. Install Wrangler CLI
2. Deploy using `src/scheduler/deploy/cloudflare-workers.ts`

```bash
npx wrangler deploy src/scheduler/deploy/cloudflare-workers.ts
```

### GCP Cloud Run

```bash
PLATFORM=gcp \
GCP_PROJECT_ID=my-project \
GCP_JOB_NAME=bot-job \
npm run start:scheduler
```

## Environment Variables

### Server Configuration
```bash
PORT=3000                                  # Server port
PLATFORM=podman                           # Platform to use
```

### Podman/Docker Configuration
```bash
CONTAINER_ENGINE=podman                   # or docker
AUTO_DETECT_ENGINE=true                   # Auto-detect engine
RECORDINGS_PATH=./recordings              # Output directory
SCHEDULER_CONTAINER_IMAGE=meet-teams-bot:latest
```

### Scheduler Configuration
```bash
SCHEDULER_MAX_CONCURRENT_JOBS=10          # Max parallel jobs
SCHEDULER_POLLING_INTERVAL=5000           # Queue poll interval (ms)
SCHEDULER_DEFAULT_CPU=1                   # Default CPU allocation
SCHEDULER_DEFAULT_MEMORY=2Gi              # Default memory allocation
```

### Platform-Specific
```bash
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
CLOUDFLARE_ACCOUNT_ID=account-id
CLOUDFLARE_API_TOKEN=api-token
CLOUDFLARE_QUEUE_NAME=bot-jobs
```

## Deployment Platforms

### ✅ Supported

- **Local**: Podman, Docker
- **Cloud**: Kubernetes, Azure Container Apps, GCP Cloud Run
- **Serverless**: Azure Functions, Cloudflare Workers

### 🎯 Why Hono?

[Hono](https://hono.dev/) is a modern, ultrafast web framework that:
- ✅ Works on **any** JavaScript runtime (Node.js, Deno, Bun, Cloudflare Workers)
- ✅ **Zero dependencies** for core functionality
- ✅ **Fast** - Benchmarks faster than Express, Fastify
- ✅ **TypeScript** first-class support
- ✅ **Middleware** ecosystem (CORS, JWT, logging, etc.)
- ✅ **Serverless-ready** - Deploy to Cloudflare, Azure, AWS Lambda

## File Structure

```
src/
├── scheduler-server.ts                    # Main entry point (NEW)
└── scheduler/
    ├── api/
    │   ├── honoApp.ts                    # Hono app (NEW)
    │   └── schedulerRoutes.ts            # Express routes (old)
    ├── adapters/
    │   ├── PodmanAdapter.ts              # Podman/Docker adapter (NEW)
    │   ├── KubernetesAdapter.ts
    │   ├── AzureContainerJobAdapter.ts
    │   └── GCPCloudRunAdapter.ts
    ├── deploy/
    │   ├── azure-functions.ts            # Azure Functions handler (NEW)
    │   └── cloudflare-workers.ts         # CF Workers handler (NEW)
    ├── queue/
    │   └── JobQueue.ts
    ├── SchedulerService.ts
    └── types.ts

.env.scheduler                             # Scheduler config template (NEW)
```

## Comparison: Bot vs Scheduler

| Feature | Meeting Bot | Bot Scheduler |
|---------|-------------|---------------|
| **Entry Point** | `src/main.ts` | `src/scheduler-server.ts` |
| **Execution** | Direct bot run | API-based scheduling |
| **Use Case** | Single meeting | Multiple meetings queue |
| **Interface** | CLI / run_bot.js | REST API |
| **Scaling** | Manual | Auto-scaling via queue |
| **Deployment** | Container only | Multi-platform (serverless) |

## Running Both Projects

You can run both projects simultaneously:

```bash
# Terminal 1: Start the Meeting Bot (traditional way)
node run_bot.js run bot.config.json

# Terminal 2: Start the Scheduler API
npm run dev:scheduler
```

Or use the Scheduler to manage multiple bots:

```bash
# Start scheduler
npm run start:scheduler

# Submit jobs via API
curl -X POST http://localhost:3000/api/scheduler/jobs \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "https://meet.google.com/abc-def-ghi"}'
```

## Development

### Run in Development Mode

```bash
npm run dev:scheduler
```

This starts the server with hot-reload on code changes.

### Build for Production

```bash
npm run build:scheduler
npm run start:scheduler
```

### Format Code

```bash
npm run format
```

## Testing

Test the API with the included test script:

```bash
./test-scheduler-api.sh
```

Or manually with curl:

```bash
# Health check
curl http://localhost:3000/health

# Submit job
curl -X POST http://localhost:3000/api/scheduler/jobs \
  -H "Content-Type: application/json" \
  -d '{"meetingUrl": "https://meet.google.com/test"}'

# Check status
curl http://localhost:3000/api/scheduler/jobs/{jobId}
```

## Troubleshooting

### Podman/Docker Not Found

If you get "Neither Docker nor Podman is installed":

```bash
# Install Podman
brew install podman  # macOS
sudo apt install podman  # Ubuntu/Debian

# Or install Docker
# Visit: https://docs.docker.com/get-docker/
```

### Port Already in Use

```bash
# Use a different port
PORT=8080 npm run start:scheduler

# Or kill the process using port 3000
lsof -ti:3000 | xargs kill -9
```

### Container Not Starting

Check logs:

```bash
# Podman
podman logs $(podman ps -q --filter "label=job-id=YOUR_JOB_ID")

# Docker
docker logs $(docker ps -q --filter "label=job-id=YOUR_JOB_ID")
```

## Next Steps

1. **Try Local**: Start with Podman adapter locally
2. **Scale Up**: Deploy to Kubernetes for production
3. **Go Serverless**: Deploy to Azure Functions or Cloudflare Workers
4. **Monitor**: Add logging and metrics
5. **Secure**: Add authentication and rate limiting

## Documentation

- `SCHEDULER.md` - Complete scheduler documentation
- `SCHEDULER_QUICKSTART.md` - Quick start guide
- `src/scheduler/README.md` - Technical details
- `.env.scheduler` - Configuration template

## License

Apache 2.0
