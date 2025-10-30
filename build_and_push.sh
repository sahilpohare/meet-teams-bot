#!/bin/bash

# Build, Tag, and Push Docker Image Script for Meeting Bot
# Supports both Docker and Podman

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Detect container runtime (Docker or Podman)
if command -v docker &> /dev/null && docker info &> /dev/null; then
    CONTAINER_CMD="docker"
elif command -v podman &> /dev/null; then
    CONTAINER_CMD="podman"
    echo -e "${YELLOW}⚠${NC} Using Podman as container runtime"
    echo ""
else
    echo -e "${RED}✗${NC} Neither Docker nor Podman is available. Please install one of them."
    exit 1
fi

# Project-specific defaults
DEFAULT_REGISTRY="skyfernaic01.azurecr.io"  # Update this to your ACR name
DEFAULT_IMAGE_NAME="meet-teams-bot"
DEFAULT_TAG="latest"
DEFAULT_DOCKERFILE="Dockerfile"
DEFAULT_PLATFORM="linux/amd64"

# Configuration variables
REGISTRY="${DEFAULT_REGISTRY}"
IMAGE_NAME="${DEFAULT_IMAGE_NAME}"
TAG="${DEFAULT_TAG}"
DOCKERFILE="${DEFAULT_DOCKERFILE}"
PLATFORM="${DEFAULT_PLATFORM}"
BUILD_ONLY=false
NO_CACHE=false
PUSH_LATEST=true

# Print colored output
print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

# Show usage
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Build, tag, and push Docker image for Meeting Bot (Google Meet, Teams, Zoom).

PROJECT DEFAULTS:
    Registry:    ${DEFAULT_REGISTRY}
    Image:       ${DEFAULT_IMAGE_NAME}
    Tag:         ${DEFAULT_TAG}
    Dockerfile:  ${DEFAULT_DOCKERFILE}
    Platform:    ${DEFAULT_PLATFORM}

OPTIONS:
    -r, --registry REGISTRY     Override registry (default: ${DEFAULT_REGISTRY})
    -i, --image IMAGE          Override image name (default: ${DEFAULT_IMAGE_NAME})
    -t, --tag TAG              Image tag (default: ${DEFAULT_TAG})
    --build-only               Only build, don't push to registry
    --no-cache                 Build without using cache
    --no-latest                Don't tag and push as 'latest'
    -h, --help                 Show this help message

EXAMPLES:
    # Build and push with defaults
    $0

    # Build with version tag
    $0 -t v1.2.0

    # Build with custom tag (also pushes as latest)
    $0 -t 2024-01-15

    # Build locally without pushing
    $0 --build-only -t dev

    # Force clean build
    $0 --no-cache -t v1.2.0

    # Override registry
    $0 -r myregistry.azurecr.io -t v1.2.0

    # Build specific version without latest tag
    $0 -t v1.2.0 --no-latest

PREREQUISITES:
    For Azure Container Registry (ACR), login first:
        az acr login --name <registry-name>

    For Docker Hub:
        docker login

    For other registries:
        docker login <registry-url>

EOF
    exit 1
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -r|--registry)
            REGISTRY="$2"
            shift 2
            ;;
        -i|--image)
            IMAGE_NAME="$2"
            shift 2
            ;;
        -t|--tag)
            TAG="$2"
            shift 2
            ;;
        --build-only)
            BUILD_ONLY=true
            shift
            ;;
        --no-cache)
            NO_CACHE=true
            shift
            ;;
        --no-latest)
            PUSH_LATEST=false
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            print_error "Unknown option: $1"
            usage
            ;;
    esac
done

# Construct full image name
FULL_IMAGE_NAME="${REGISTRY}/${IMAGE_NAME}:${TAG}"

print_info "Meeting Bot - Docker Build & Push"
echo ""
echo "Configuration:"
echo "  Container:   ${CONTAINER_CMD}"
echo "  Registry:    ${REGISTRY}"
echo "  Image:       ${IMAGE_NAME}"
echo "  Tag:         ${TAG}"
echo "  Full name:   ${FULL_IMAGE_NAME}"
echo "  Dockerfile:  ${DOCKERFILE}"
echo "  Platform:    ${PLATFORM}"
echo "  Build only:  ${BUILD_ONLY}"
echo "  Push latest: ${PUSH_LATEST}"
echo ""

# Check if Dockerfile exists
if [ ! -f "$DOCKERFILE" ]; then
    print_error "Dockerfile not found: $DOCKERFILE"
    exit 1
fi

# Verify package.json exists
if [ ! -f "package.json" ]; then
    print_error "package.json not found. Are you in the project root directory?"
    exit 1
fi

# Build command
BUILD_CMD="${CONTAINER_CMD} build"

if [ "$NO_CACHE" = true ]; then
    BUILD_CMD="$BUILD_CMD --no-cache"
    print_warning "Building without cache (this will take longer)"
fi

BUILD_CMD="$BUILD_CMD --platform ${PLATFORM} -f ${DOCKERFILE} -t ${FULL_IMAGE_NAME} ."

# Build the image
print_info "Building Docker image..."
echo "Command: $BUILD_CMD"
echo ""

START_TIME=$(date +%s)

if eval $BUILD_CMD; then
    END_TIME=$(date +%s)
    BUILD_TIME=$((END_TIME - START_TIME))
    print_success "Docker image built successfully in ${BUILD_TIME}s!"
else
    print_error "Docker build failed!"
    exit 1
fi

# Get image size
IMAGE_SIZE=$(${CONTAINER_CMD} images ${FULL_IMAGE_NAME} --format "{{.Size}}" 2>/dev/null || echo "unknown")
print_info "Image size: ${IMAGE_SIZE}"
echo ""

# Tag with additional tags if needed
if [ "$TAG" != "latest" ] && [ "$BUILD_ONLY" = false ] && [ "$PUSH_LATEST" = true ]; then
    LATEST_IMAGE="${REGISTRY}/${IMAGE_NAME}:latest"
    print_info "Tagging as latest: ${LATEST_IMAGE}"
    ${CONTAINER_CMD} tag ${FULL_IMAGE_NAME} ${LATEST_IMAGE}
fi

# Push to registry
if [ "$BUILD_ONLY" = false ]; then
    print_info "Pushing image to container registry..."

    # Check if registry is ACR
    if [[ "$REGISTRY" == *".azurecr.io" ]]; then
        REGISTRY_NAME="${REGISTRY%%.*}"
        print_warning "Ensure you're logged in to ACR: az acr login --name ${REGISTRY_NAME}"
        echo ""
    fi

    # Push main tag
    print_info "Pushing ${FULL_IMAGE_NAME}..."

    if ${CONTAINER_CMD} push ${FULL_IMAGE_NAME}; then
        print_success "Image pushed successfully!"

        # Push latest tag if created
        if [ "$TAG" != "latest" ] && [ "$PUSH_LATEST" = true ]; then
            print_info "Pushing latest tag..."
            if ${CONTAINER_CMD} push ${LATEST_IMAGE}; then
                print_success "Latest tag pushed successfully!"
            else
                print_warning "Failed to push latest tag (continuing...)"
            fi
        fi
    else
        print_error "Failed to push image to registry!"
        if [[ "$REGISTRY" == *".azurecr.io" ]]; then
            print_info "Make sure you're logged in: az acr login --name ${REGISTRY_NAME}"
        else
            print_info "Make sure you're logged in: ${CONTAINER_CMD} login ${REGISTRY}"
        fi
        exit 1
    fi
fi

# Summary
echo ""
print_success "=== Build Complete ==="
echo ""
echo "Image Details:"
echo "  Name:     ${FULL_IMAGE_NAME}"
echo "  Size:     ${IMAGE_SIZE}"
echo "  Registry: ${REGISTRY}"
if [ "$BUILD_ONLY" = false ]; then
    echo "  Status:   Pushed to registry ✓"
    if [ "$PUSH_LATEST" = true ] && [ "$TAG" != "latest" ]; then
        echo "  Latest:   Also tagged as latest ✓"
    fi
else
    echo "  Status:   Built locally (not pushed)"
fi
echo ""

# Show next steps
if [ "$BUILD_ONLY" = true ]; then
    print_info "Next steps:"
    echo "  1. Test locally with config file:"
    echo "     ${CONTAINER_CMD} run -i -p 3000:3000 -v \$(pwd)/recordings:/app/data ${FULL_IMAGE_NAME} < bot.config.json"
    echo ""
    echo "  2. Test with debug mode (VNC on port 5900):"
    echo "     DEBUG=true ./run_bot.js run bot.config.json"
    echo ""
    echo "  3. Push when ready:"
    if [[ "$REGISTRY" == *".azurecr.io" ]]; then
        echo "     az acr login --name ${REGISTRY%%.*}"
    fi
    echo "     ${CONTAINER_CMD} push ${FULL_IMAGE_NAME}"
else
    print_info "Deployment options:"
    echo ""
    echo "  1. Azure Container Instances:"
    echo "     az container create \\"
    echo "       --resource-group <resource-group> \\"
    echo "       --name meeting-bot \\"
    echo "       --image ${FULL_IMAGE_NAME} \\"
    echo "       --cpu 2 --memory 4 \\"
    echo "       --ports 3000 5900 \\"
    echo "       --environment-variables RECORDING=true"
    echo ""
    echo "  2. Azure App Service (Web App for Containers):"
    echo "     az webapp create \\"
    echo "       --resource-group <resource-group> \\"
    echo "       --plan <app-service-plan> \\"
    echo "       --name meeting-bot-app \\"
    echo "       --deployment-container-image-name ${FULL_IMAGE_NAME}"
    echo ""
    echo "  3. Azure Container Apps:"
    echo "     az containerapp create \\"
    echo "       --name meeting-bot \\"
    echo "       --resource-group <resource-group> \\"
    echo "       --environment <container-app-env> \\"
    echo "       --image ${FULL_IMAGE_NAME} \\"
    echo "       --target-port 3000 \\"
    echo "       --cpu 2 --memory 4Gi"
    echo ""
    echo "  4. Test locally first:"
    echo "     ./run_bot.js run bot.config.json"
    echo "     # or with Docker directly:"
    echo "     echo '\$(cat bot.config.json)' | ${CONTAINER_CMD} run -i -p 3000:3000 -v \$(pwd)/recordings:/app/data ${FULL_IMAGE_NAME}"
fi
echo ""
print_info "Documentation: See CLAUDE.md for configuration and usage details"
