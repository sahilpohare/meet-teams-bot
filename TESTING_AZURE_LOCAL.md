# Testing Scheduler Locally with Azure Container Jobs

This guide shows how to run the scheduler locally on your machine while it triggers actual meeting bots on Azure Container Jobs.

## Architecture

```
┌──────────────────────┐
│  Your Local Machine  │
│                      │
│  ┌────────────────┐  │         ┌─────────────────────┐
│  │  Bot Scheduler │──┼────────▶│  Azure Container    │
│  │  (port 8080)   │  │  API    │  Jobs               │
│  └────────────────┘  │  Calls  │                     │
└──────────────────────┘         │  ┌───────────────┐  │
                                 │  │ meet-teams-bot│  │
                                 │  │  (container)  │  │
                                 │  └───────────────┘  │
                                 └─────────────────────┘
```

The scheduler runs on your laptop and makes API calls to Azure to trigger bot containers.

## Prerequisites

1. **Azure CLI installed**
   ```bash
   # macOS
   brew install azure-cli

   # Or download from: https://docs.microsoft.com/cli/azure/install-azure-cli
   ```

2. **Azure login**
   ```bash
   az login
   ```

3. **Azure Container Apps Job created**
   - You need a Container Apps Job already set up in Azure
   - The job should use the `meet-teams-bot` image
   - Note your: Resource Group, Job Name, Subscription ID

4. **Meeting bot image in Azure Container Registry**
   - Build and push `meet-teams-bot` to your ACR
   - Example: `yourregistry.azurecr.io/meet-teams-bot:latest`

## Setup

1. **Copy environment file**
   ```bash
   cp .env.scheduler.example .env.scheduler
   ```

2. **Configure Azure settings in `.env.scheduler`**
   ```bash
   # Platform
   PLATFORM=azure

   # Azure Configuration
   AZURE_SUBSCRIPTION_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
   AZURE_RESOURCE_GROUP=meet-bot-rg
   AZURE_JOB_NAME=meet-teams-bot-job
   AZURE_LOCATION=eastus

   # Bot image (in your ACR)
   SCHEDULER_CONTAINER_IMAGE=yourregistry.azurecr.io/meet-teams-bot:latest
   ```

3. **Build the scheduler**
   ```bash
   bun run build
   ```

## Running

### Option 1: Using the test script
```bash
./test-azure-local.sh
```

### Option 2: Manual start
```bash
# Load env vars
export $(cat .env.scheduler | grep -v '^#' | xargs)

# Start scheduler
bun run build/src/scheduler-server.js
```

The scheduler will start on `http://localhost:8080`

## Testing

### 1. Check health
```bash
curl http://localhost:8080/health
```

### 2. Create a meeting bot
```bash
curl -X POST http://localhost:8080/api/scheduler/meetings \
  -H "Content-Type: application/json" \
  -d '{
    "meeting_url": "https://meet.google.com/your-meeting-url",
    "bot_name": "Test Bot",
    "email": "bot@example.com",
    "recording_mode": "speaker_view"
  }'
```

### 3. Check the response
You should get:
```json
{
  "success": true,
  "meeting": {
    "id": "uuid-here",
    "containerId": "exec-uuid-timestamp",
    "meetingUrl": "https://meet.google.com/your-meeting-url",
    "status": "running",
    "createdAt": "2025-10-30T...",
    "botConfig": {...}
  }
}
```

### 4. Verify in Azure
```bash
# List job executions
az containerapp job execution list \
  --name meet-teams-bot-job \
  --resource-group meet-bot-rg \
  --output table

# Check logs
az containerapp job logs show \
  --name meet-teams-bot-job \
  --resource-group meet-bot-rg
```

## What Happens

1. **API Call**: You POST to the local scheduler
2. **Azure SDK**: Scheduler calls Azure Container Apps Jobs API
3. **Job Execution**: Azure creates a new container job execution
4. **Bot Runs**: The `meet-teams-bot` container starts in Azure
5. **Bot Joins**: Bot joins the meeting, records, uploads to storage

## Swagger UI

Access the API documentation at: http://localhost:8080/ui

## Troubleshooting

### "AZURE_SUBSCRIPTION_ID environment variable is required"
- Make sure `.env.scheduler` is loaded
- Verify `AZURE_SUBSCRIPTION_ID` is set

### "Failed to provision container"
- Check Azure CLI login: `az account show`
- Verify Resource Group and Job Name exist
- Check IAM permissions (need Contributor role)

### "Job not found"
- Create the Container Apps Job first
- Use `az containerapp job create` or Azure Portal

## Next Steps

Once local testing works, deploy the scheduler to Azure:
```bash
./deploy-scheduler-container-apps.sh
```

This will deploy the scheduler as a serverless Azure Function on Container Apps.
