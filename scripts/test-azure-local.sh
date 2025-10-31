#!/bin/bash
set -e

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   🧪 Test Scheduler Locally with Azure Container Jobs"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Check if .env.scheduler exists
if [ ! -f ".env.scheduler" ]; then
    echo "❌ .env.scheduler not found!"
    echo ""
    echo "Please create .env.scheduler with your Azure configuration:"
    echo "  cp .env.scheduler.example .env.scheduler"
    echo ""
    echo "Then edit .env.scheduler and fill in:"
    echo "  - AZURE_SUBSCRIPTION_ID"
    echo "  - AZURE_RESOURCE_GROUP"
    echo "  - AZURE_JOB_NAME"
    echo "  - SCHEDULER_CONTAINER_IMAGE"
    echo ""
    exit 1
fi

# Load environment variables
export $(cat .env.scheduler | grep -v '^#' | xargs)

echo "Configuration:"
echo "  Platform: ${PLATFORM}"
echo "  Azure Subscription: ${AZURE_SUBSCRIPTION_ID:0:8}..."
echo "  Resource Group: ${AZURE_RESOURCE_GROUP}"
echo "  Job Name: ${AZURE_JOB_NAME}"
echo "  Bot Image: ${SCHEDULER_CONTAINER_IMAGE}"
echo ""

# Check if logged into Azure
echo "🔐 Checking Azure login..."
if ! az account show &> /dev/null; then
    echo "Not logged in to Azure. Please run: az login"
    exit 1
fi
echo "✅ Logged in to Azure"
echo ""

# Start scheduler
echo "🚀 Starting scheduler on port ${PORT:-8080}..."
echo ""

bun run build/src/scheduler-server.js
