#!/usr/bin/env bash
#
# Start Meeting Bot Scheduler with Podman Compose
# Loads environment variables from ~/.env
#

set -e

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

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
export $(grep -v '^#' ~/.env | xargs)

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

# Check if compose file exists
if [ ! -f "podman-compose.yml" ]; then
    print_error "podman-compose.yml not found in current directory"
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
        if command -v podman-compose &> /dev/null; then
            podman-compose -f podman-compose.yml down
        else
            podman compose -f podman-compose.yml down
        fi
    else
        print_info "Exiting without changes"
        exit 0
    fi
fi

# Start the scheduler
print_info "Starting meeting bot scheduler..."

# Use podman-compose if available, otherwise try podman compose
if command -v podman-compose &> /dev/null; then
    podman-compose -f podman-compose.yml up -d
else
    podman compose -f podman-compose.yml up -d
fi

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
    if command -v podman-compose &> /dev/null; then
        print_info "Check logs with: podman-compose -f podman-compose.yml logs -f"
    else
        print_info "Check logs with: podman compose -f podman-compose.yml logs -f"
    fi
else
    print_success "Meeting Bot Scheduler is running!"
    echo
    print_info "API Endpoints (via Nginx on port 80):"
    echo "  - Health:        http://localhost/meeting-bot/health"
    echo "  - Documentation: http://localhost/meeting-bot/ui"
    echo "  - API Base:      http://localhost/meeting-bot/api"
    echo
    print_info "Useful commands:"
    if command -v podman-compose &> /dev/null; then
        echo "  - View logs:     podman-compose -f podman-compose.yml logs -f"
        echo "  - Check status:  podman-compose -f podman-compose.yml ps"
        echo "  - Stop:          podman-compose -f podman-compose.yml down"
    else
        echo "  - View logs:     podman compose -f podman-compose.yml logs -f"
        echo "  - Check status:  podman compose -f podman-compose.yml ps"
        echo "  - Stop:          podman compose -f podman-compose.yml down"
    fi
fi
