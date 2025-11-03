#!/usr/bin/env bash
#
# Scheduler Docker Build & Push Script
# Builds and pushes the scheduler Docker image to Azure Container Registry
#

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

# Configuration
CONTAINER_RUNTIME="${CONTAINER_RUNTIME:-podman}"
REGISTRY="${REGISTRY:-skyfernaic01.azurecr.io}"
IMAGE_NAME="${IMAGE_NAME:-meeting-bot-scheduler}"
TAG="${TAG:-latest}"
PLATFORM="${PLATFORM:-linux/amd64}"
BUILD_ONLY="${BUILD_ONLY:-false}"
PUSH_LATEST="${PUSH_LATEST:-true}"

# Default build context and dockerfile
DEFAULT_BUILD_CONTEXT="apps/scheduler"
BUILD_CONTEXT="${BUILD_CONTEXT:-$DEFAULT_BUILD_CONTEXT}"
DOCKERFILE="${DOCKERFILE:-Dockerfile}"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--tag)
            TAG="$2"
            shift 2
            ;;
        --build-only)
            BUILD_ONLY=true
            shift
            ;;
        --no-latest)
            PUSH_LATEST=false
            shift
            ;;
        --platform)
            PLATFORM="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  -t, --tag TAG          Image tag (default: latest)"
            echo "  --build-only           Build but don't push to registry"
            echo "  --no-latest            Don't tag/push as latest"
            echo "  --platform PLATFORM    Target platform (default: linux/amd64)"
            echo "  -h, --help             Show this help message"
            exit 0
            ;;
        *)
            print_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Detect container runtime
if command -v podman &> /dev/null; then
    CONTAINER_RUNTIME="podman"
elif command -v docker &> /dev/null; then
    CONTAINER_RUNTIME="docker"
else
    print_error "Neither podman nor docker found. Please install one of them."
    exit 1
fi

print_warning "Using ${CONTAINER_RUNTIME} as container runtime"

# Full image name
FULL_IMAGE_NAME="${REGISTRY}/${IMAGE_NAME}:${TAG}"

# Print configuration
print_info "Scheduler - Docker Build & Push"
echo ""
echo "Configuration:"
echo "  Container:     ${CONTAINER_RUNTIME}"
echo "  Registry:      ${REGISTRY}"
echo "  Image:         ${IMAGE_NAME}"
echo "  Tag:           ${TAG}"
echo "  Full name:     ${FULL_IMAGE_NAME}"
echo "  Build context: ${BUILD_CONTEXT}"
echo "  Dockerfile:    ${BUILD_CONTEXT}/${DOCKERFILE}"
echo "  Platform:      ${PLATFORM}"
echo "  Build only:    ${BUILD_ONLY}"
echo "  Push latest:   ${PUSH_LATEST}"
echo ""

# Check if build context exists
if [ ! -d "$BUILD_CONTEXT" ]; then
    print_error "Build context directory not found: $BUILD_CONTEXT"
    exit 1
fi

# Check if Dockerfile exists
if [ ! -f "${BUILD_CONTEXT}/${DOCKERFILE}" ]; then
    print_error "Dockerfile not found: ${BUILD_CONTEXT}/${DOCKERFILE}"
    exit 1
fi

# Check if dist directory exists
if [ ! -d "${BUILD_CONTEXT}/dist" ]; then
    print_error "dist directory not found. Please run 'bun run build' first."
    exit 1
fi

# Build the image
print_info "Building Docker image..."
START_TIME=$(date +%s)

BUILD_CMD="${CONTAINER_RUNTIME} build"
BUILD_CMD="$BUILD_CMD --platform ${PLATFORM}"
BUILD_CMD="$BUILD_CMD -f ${BUILD_CONTEXT}/${DOCKERFILE}"
BUILD_CMD="$BUILD_CMD -t ${FULL_IMAGE_NAME}"
BUILD_CMD="$BUILD_CMD ${BUILD_CONTEXT}"

echo "Command: ${BUILD_CMD}"
echo ""

if eval "$BUILD_CMD"; then
    END_TIME=$(date +%s)
    DURATION=$((END_TIME - START_TIME))
    print_success "Docker image built successfully in ${DURATION}s!"

    # Get image size
    IMAGE_SIZE=$(${CONTAINER_RUNTIME} images ${FULL_IMAGE_NAME} --format "{{.Size}}")
    print_info "Image size: ${IMAGE_SIZE}"
else
    print_error "Docker build failed!"
    exit 1
fi

# Tag as latest if requested
if [ "$PUSH_LATEST" = true ] && [ "$TAG" != "latest" ]; then
    print_info "Tagging as latest: ${REGISTRY}/${IMAGE_NAME}:latest"
    ${CONTAINER_RUNTIME} tag ${FULL_IMAGE_NAME} ${REGISTRY}/${IMAGE_NAME}:latest
fi

# Exit if build-only mode
if [ "$BUILD_ONLY" = true ]; then
    print_success "Build complete (build-only mode)"
    exit 0
fi

# Push to registry
print_info "Pushing image to container registry..."
print_warning "Ensure you're logged in to ACR: az acr login --name skyfernaic01"
echo ""

# Push the tagged image
print_info "Pushing ${FULL_IMAGE_NAME}..."
if ${CONTAINER_RUNTIME} push ${FULL_IMAGE_NAME}; then
    print_success "Image pushed successfully!"
else
    print_error "Failed to push image"
    exit 1
fi

# Push latest tag if requested
if [ "$PUSH_LATEST" = true ] && [ "$TAG" != "latest" ]; then
    print_info "Pushing latest tag..."
    if ${CONTAINER_RUNTIME} push ${REGISTRY}/${IMAGE_NAME}:latest; then
        print_success "Latest tag pushed successfully!"
    else
        print_warning "Failed to push latest tag"
    fi
fi

# Print summary
echo ""
print_success "=== Build Complete ==="
echo ""
echo "Image Details:"
echo "  Name:     ${FULL_IMAGE_NAME}"
echo "  Size:     ${IMAGE_SIZE}"
echo "  Registry: ${REGISTRY}"
echo "  Status:   Pushed to registry ✓"
if [ "$PUSH_LATEST" = true ]; then
    echo "  Latest:   Also tagged as latest ✓"
fi
echo ""

print_info "Deployment options:"
echo ""
echo "  1. Docker Compose:"
echo "     docker run -p 3000:3000 \\"
echo "       -e CONTAINER_ADAPTER=podman \\"
echo "       -e CONTAINER_IMAGE=skyfernaic01.azurecr.io/meet-teams-bot:latest \\"
echo "       -v /var/run/podman/podman.sock:/var/run/podman/podman.sock \\"
echo "       ${FULL_IMAGE_NAME}"
echo ""
echo "  2. Azure Container Instances:"
echo "     az container create \\"
echo "       --resource-group <resource-group> \\"
echo "       --name scheduler \\"
echo "       --image ${FULL_IMAGE_NAME} \\"
echo "       --cpu 1 --memory 2 \\"
echo "       --ports 3000 \\"
echo "       --environment-variables CONTAINER_ADAPTER=azure"
echo ""
echo "  3. Kubernetes:"
echo "     kubectl run scheduler --image=${FULL_IMAGE_NAME} --port=3000"
echo ""

print_info "API will be available at http://localhost:3000"
print_info "Documentation at http://localhost:3000/ui"
