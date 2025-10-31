#!/bin/bash
set -e

# Azure Scheduler Deployment Script
# Builds and deploys the Meeting Bot Scheduler to Azure Container Apps

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   🚀 Deploy Meeting Bot Scheduler to Azure"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Configuration
ACR_NAME="${ACR_NAME:-yourregistry}"
RESOURCE_GROUP="${RESOURCE_GROUP:-meet-bot-rg}"
LOCATION="${LOCATION:-eastus}"
CONTAINER_APP_NAME="${CONTAINER_APP_NAME:-meet-bot-scheduler}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-meet-bot-env}"
IMAGE_NAME="meet-teams-bot-scheduler"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI not found. Please install: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

# Check if logged in to Azure
echo "🔐 Checking Azure login..."
if ! az account show &> /dev/null; then
    echo "Not logged in to Azure. Running 'az login'..."
    az login
fi

echo "✅ Logged in to Azure"
echo ""

# Build Docker image
echo "🔨 Building Docker image..."
docker build -f Dockerfile.scheduler.azure -t ${IMAGE_NAME}:${IMAGE_TAG} .

if [ $? -ne 0 ]; then
    echo "❌ Docker build failed"
    exit 1
fi

echo "✅ Docker image built successfully"
echo ""

# Log in to Azure Container Registry
echo "🔐 Logging in to Azure Container Registry..."
az acr login --name ${ACR_NAME}

if [ $? -ne 0 ]; then
    echo "❌ ACR login failed. Make sure ACR_NAME is set correctly."
    exit 1
fi

echo "✅ Logged in to ACR"
echo ""

# Tag image for ACR
echo "🏷️  Tagging image for ACR..."
docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${ACR_NAME}.azurecr.io/${IMAGE_NAME}:${IMAGE_TAG}

# Push image to ACR
echo "⬆️  Pushing image to ACR..."
docker push ${ACR_NAME}.azurecr.io/${IMAGE_NAME}:${IMAGE_TAG}

if [ $? -ne 0 ]; then
    echo "❌ Docker push failed"
    exit 1
fi

echo "✅ Image pushed to ACR"
echo ""

# Create Container Apps Environment if it doesn't exist
echo "🌍 Checking Container Apps environment..."
if ! az containerapp env show --name ${ENVIRONMENT_NAME} --resource-group ${RESOURCE_GROUP} &> /dev/null; then
    echo "Creating Container Apps environment..."
    az containerapp env create \
        --name ${ENVIRONMENT_NAME} \
        --resource-group ${RESOURCE_GROUP} \
        --location ${LOCATION}
    echo "✅ Environment created"
else
    echo "✅ Environment exists"
fi

echo ""

# Deploy Container App
echo "🚀 Deploying Container App..."
az containerapp create \
    --name ${CONTAINER_APP_NAME} \
    --resource-group ${RESOURCE_GROUP} \
    --environment ${ENVIRONMENT_NAME} \
    --image ${ACR_NAME}.azurecr.io/${IMAGE_NAME}:${IMAGE_TAG} \
    --target-port 8080 \
    --ingress external \
    --registry-server ${ACR_NAME}.azurecr.io \
    --cpu 0.5 \
    --memory 1.0Gi \
    --min-replicas 1 \
    --max-replicas 10 \
    --env-vars \
        NODE_ENV=production \
        PLATFORM=azure \
        PORT=8080 \
        SCHEDULER_MAX_CONCURRENT_JOBS=100 \
        SCHEDULER_CONTAINER_IMAGE=${ACR_NAME}.azurecr.io/meet-teams-bot:latest \
        AZURE_RESOURCE_GROUP=${RESOURCE_GROUP}

if [ $? -ne 0 ]; then
    echo "❌ Deployment failed"
    exit 1
fi

echo ""
echo "✅ Deployment successful!"
echo ""

# Get the app URL
APP_URL=$(az containerapp show \
    --name ${CONTAINER_APP_NAME} \
    --resource-group ${RESOURCE_GROUP} \
    --query properties.configuration.ingress.fqdn \
    -o tsv)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   🎉 Scheduler Deployed Successfully!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📍 URL: https://${APP_URL}"
echo "📊 Swagger UI: https://${APP_URL}/ui"
echo "🔍 Health Check: https://${APP_URL}/health"
echo "📖 OpenAPI Spec: https://${APP_URL}/doc"
echo ""
echo "API Endpoints:"
echo "  POST https://${APP_URL}/api/scheduler/meetings"
echo "  POST https://${APP_URL}/api/scheduler/jobs"
echo "  GET  https://${APP_URL}/api/scheduler/jobs/:jobId"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
