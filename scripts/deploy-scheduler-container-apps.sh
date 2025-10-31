#!/bin/bash
set -e

# Azure Functions on Container Apps Deployment Script
# Deploys the Meeting Bot Scheduler as a containerized function

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   🚀 Deploy Bot Scheduler to Azure Functions on Container Apps"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# Configuration
RESOURCE_GROUP="${RESOURCE_GROUP:-meet-bot-rg}"
LOCATION="${LOCATION:-eastus}"
STORAGE_ACCOUNT="${STORAGE_ACCOUNT:-meetbotstore$(openssl rand -hex 4)}"
FUNCTION_APP_NAME="${FUNCTION_APP_NAME:-bot-scheduler}"
ENVIRONMENT_NAME="${ENVIRONMENT_NAME:-bot-scheduler-env}"
ACR_NAME="${ACR_NAME:-botscheduleracr$(openssl rand -hex 4)}"
IMAGE_NAME="bot-scheduler"
IMAGE_TAG="${IMAGE_TAG:-latest}"

# Check Azure CLI
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI not found. Install from: https://docs.microsoft.com/cli/azure/install-azure-cli"
    exit 1
fi

# Login check
echo "🔐 Checking Azure login..."
if ! az account show &> /dev/null; then
    az login
fi
echo "✅ Logged in to Azure"
echo ""

# Create resource group
echo "📦 Creating resource group..."
az group create --name ${RESOURCE_GROUP} --location ${LOCATION} --output none
echo "✅ Resource group ready"
echo ""

# Create Azure Container Registry
echo "📦 Creating Azure Container Registry..."
az acr create \
    --resource-group ${RESOURCE_GROUP} \
    --name ${ACR_NAME} \
    --sku Basic \
    --admin-enabled true \
    --output none
echo "✅ ACR created"
echo ""

# Build and push image
echo "🔨 Building Docker image..."
az acr build \
    --registry ${ACR_NAME} \
    --image ${IMAGE_NAME}:${IMAGE_TAG} \
    --file Dockerfile.scheduler.functions \
    .

if [ $? -ne 0 ]; then
    echo "❌ Build failed"
    exit 1
fi
echo "✅ Image built and pushed"
echo ""

# Create Container Apps environment with workload profiles
echo "🌍 Creating Container Apps environment..."
az containerapp env create \
    --name ${ENVIRONMENT_NAME} \
    --resource-group ${RESOURCE_GROUP} \
    --location ${LOCATION} \
    --enable-workload-profiles \
    --output none
echo "✅ Environment created"
echo ""

# Create storage account
echo "💾 Creating storage account..."
az storage account create \
    --name ${STORAGE_ACCOUNT} \
    --location ${LOCATION} \
    --resource-group ${RESOURCE_GROUP} \
    --sku Standard_LRS \
    --allow-blob-public-access false \
    --allow-shared-key-access false \
    --output none
echo "✅ Storage account created"
echo ""

# Get ACR credentials
ACR_LOGIN_SERVER=$(az acr show --name ${ACR_NAME} --query loginServer --output tsv)
ACR_USERNAME=$(az acr credential show --name ${ACR_NAME} --query username --output tsv)
ACR_PASSWORD=$(az acr credential show --name ${ACR_NAME} --query passwords[0].value --output tsv)

# Deploy Function App to Container Apps
echo "🚀 Deploying Function App..."
az functionapp create \
    --name ${FUNCTION_APP_NAME} \
    --storage-account ${STORAGE_ACCOUNT} \
    --environment ${ENVIRONMENT_NAME} \
    --workload-profile-name "Consumption" \
    --resource-group ${RESOURCE_GROUP} \
    --image ${ACR_LOGIN_SERVER}/${IMAGE_NAME}:${IMAGE_TAG} \
    --registry-server ${ACR_LOGIN_SERVER} \
    --registry-username ${ACR_USERNAME} \
    --registry-password ${ACR_PASSWORD} \
    --functions-version 4 \
    --runtime node \
    --runtime-version 20

if [ $? -ne 0 ]; then
    echo "❌ Deployment failed"
    exit 1
fi
echo "✅ Function App deployed"
echo ""

# Configure app settings
echo "⚙️  Configuring application settings..."
az functionapp config appsettings set \
    --name ${FUNCTION_APP_NAME} \
    --resource-group ${RESOURCE_GROUP} \
    --settings \
        PLATFORM=azure \
        SCHEDULER_MAX_CONCURRENT_JOBS=100 \
        SCHEDULER_CONTAINER_IMAGE="${SCHEDULER_CONTAINER_IMAGE}" \
        AZURE_RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-${RESOURCE_GROUP}}" \
        AZURE_JOB_NAME="${AZURE_JOB_NAME}" \
        AZURE_LOCATION="${AZURE_LOCATION:-${LOCATION}}" \
    --output none

echo "✅ Settings configured"
echo ""

# Get function app URL
FUNCTION_URL=$(az functionapp show \
    --name ${FUNCTION_APP_NAME} \
    --resource-group ${RESOURCE_GROUP} \
    --query defaultHostName \
    --output tsv)

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "   🎉 Deployment Successful!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📍 Function App: https://${FUNCTION_URL}"
echo "📊 Swagger UI: https://${FUNCTION_URL}/ui"
echo "🔍 Health Check: https://${FUNCTION_URL}/health"
echo ""
echo "API Endpoints:"
echo "  POST https://${FUNCTION_URL}/api/scheduler/meetings"
echo "  POST https://${FUNCTION_URL}/api/scheduler/jobs"
echo "  GET  https://${FUNCTION_URL}/api/scheduler/jobs/:jobId"
echo ""
echo "⚠️  Note: Remember to set these environment variables:"
echo "  - AZURE_RESOURCE_GROUP"
echo "  - AZURE_JOB_NAME"
echo "  - SCHEDULER_CONTAINER_IMAGE"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
