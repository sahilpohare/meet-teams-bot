#!/usr/bin/env bash
#
# Start Meeting Bot Scheduler with Podman Compose
# Loads environment variables from ~/.env
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

# Check if ~/.env exists
if [ ! -f ~/.env ]; then
    print_error "~/.env file not found"
    print_info "Please create ~/.env with your Azure credentials"
    print_info "You can use .env.example as a template"
    exit 1
fi

# Load environment variables from ~/.env
print_info "Loading environment variables from ~/.env"
set -a
source ~/.env
set +a

print_success "Environment variables loaded"

# Verify required variables
REQUIRED_VARS=(
    "AZURE_SUBSCRIPTION_ID"
    "AZURE_RESOURCE_GROUP"
    "AZURE_TENANT_ID"
    "AZURE_CLIENT_ID"
    "AZURE_CLIENT_SECRET"
)

MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -gt 0 ]; then
    print_error "Missing required environment variables:"
    for var in "${MISSING_VARS[@]}"; do
        echo "  - $var"
    done
    exit 1
fi

print_success "All required environment variables are set"

# Check if podman-compose is installed
if ! command -v podman compose &> /dev/null; then
    print_error "podman compose not found"
    print_info "Install with: pip install podman compose"
    exit 1
fi

# Check if podman is running
if ! podman ps &> /dev/null; then
    print_error "Podman is not running or not accessible"
    exit 1
fi

print_success "Podman is running"

# Create required directories
mkdir -p data logs

# Check if already running
if podman ps --filter "name=meeting-bot-scheduler" --format "{{.Names}}" | grep -q "meeting-bot-scheduler"; then
    print_warning "Scheduler is already running"
    read -p "Do you want to restart it? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        print_info "Stopping existing scheduler..."
        podman compose down
    else
        print_info "Exiting without changes"
        exit 0
    fi
fi

# Start the scheduler
print_info "Starting meeting bot scheduler..."
podman compose up -d

# Wait for health check (via Nginx)
print_info "Waiting for scheduler to be healthy..."
MAX_WAIT=30
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
    if curl -sf http://localhost/health > /dev/null 2>&1; then
        print_success "Scheduler is healthy!"
        break
    fi
    sleep 1
    WAITED=$((WAITED + 1))
    echo -n "."
done
echo

if [ $WAITED -eq $MAX_WAIT ]; then
    print_warning "Health check timeout - scheduler may still be starting"
    print_info "Check logs with: podman compose logs -f"
else
    print_success "Meeting Bot Scheduler is running!"
    echo
    print_info "API Endpoints (via Nginx on port 80):"
    echo "  - Health:        http://localhost/health"
    echo "  - Documentation: http://localhost/ui"
    echo "  - API Base:      http://localhost/api"
    echo
    print_info "Useful commands:"
    echo "  - View logs:     podman-compose logs -f"
    echo "  - Check status:  podman-compose ps"
    echo "  - Stop:          podman-compose down"
fi
