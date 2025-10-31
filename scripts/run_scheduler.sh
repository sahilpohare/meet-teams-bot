#!/bin/bash

# Meeting Bot Scheduler Runner
# Manages the scheduler service for bot orchestration

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Emoji icons
ICON_INFO="ℹ️"
ICON_SUCCESS="✅"
ICON_WARNING="⚠️"
ICON_ERROR="❌"
ICON_BOT="🤖"

print_info()    { echo -e "${BLUE}${ICON_INFO}  $1${NC}" >&2; }
print_success() { echo -e "${GREEN}${ICON_SUCCESS} $1${NC}" >&2; }
print_warning() { echo -e "${YELLOW}${ICON_WARNING}  $1${NC}" >&2; }
print_error()   { echo -e "${RED}${ICON_ERROR} $1${NC}" >&2; }

# Detect container runtime
get_container_engine() {
    if command -v docker &> /dev/null && docker info &> /dev/null; then
        echo "docker"
    elif command -v podman &> /dev/null; then
        echo "podman"
    else
        echo ""
    fi
}

CONTAINER_CMD=$(get_container_engine)

if [ -z "$CONTAINER_CMD" ]; then
    print_error "Neither Docker nor Podman is available"
    print_info "Please install Docker: https://docs.docker.com/get-docker/"
    print_info "Or install Podman: https://podman.io/getting-started/installation"
    exit 1
fi

# Configuration
IMAGE_NAME="${DOCKER_IMAGE_NAME:-meet-teams-bot-scheduler:latest}"
PORT="${PORT:-3001}"
PLATFORM="${PLATFORM:-$CONTAINER_CMD}"

# Build image
build_image() {
    local date_tag=$(date +%Y%m%d-%H%M)
    local full_tag="meet-teams-bot-scheduler:${date_tag}"

    print_info "Building scheduler container image using ${CONTAINER_CMD}..."
    print_info "Tagging as: ${full_tag}"

    if ${CONTAINER_CMD} build -f Dockerfile.scheduler -t "${full_tag}" .; then
        print_success "Container image built successfully: ${full_tag}"

        # Also tag as latest
        ${CONTAINER_CMD} tag "${full_tag}" "meet-teams-bot-scheduler:latest"
        print_info "Also tagged as: meet-teams-bot-scheduler:latest"

        export DOCKER_IMAGE_NAME="${full_tag}"
    else
        print_error "Failed to build container image with ${CONTAINER_CMD}"
        exit 1
    fi
}

# Run scheduler
run_scheduler() {
    local env_file="${1:-.env.scheduler}"

    if [ ! -f "$env_file" ]; then
        print_warning "Environment file not found: $env_file"
        print_info "Using default configuration"
    fi

    print_info "Starting Meeting Bot Scheduler"
    print_info "Platform: ${PLATFORM}"
    print_info "Port: ${PORT}"
    print_info "Container Engine: ${CONTAINER_CMD}"
    echo ""

    local docker_args=(
        "-p" "${PORT}:3000"
        "-e" "PLATFORM=${PLATFORM}"
        "-e" "CONTAINER_ENGINE=${CONTAINER_CMD}"
        "-v" "$(pwd)/recordings:/app/recordings"
    )

    # Mount Docker/Podman socket for local container management
    if [ "${PLATFORM}" = "podman" ] || [ "${PLATFORM}" = "docker" ]; then
        if [ -S "/var/run/docker.sock" ]; then
            docker_args+=("-v" "/var/run/docker.sock:/var/run/docker.sock")
            print_info "Mounting Docker socket for container management"
        else
            print_warning "Docker socket not found at /var/run/docker.sock"
            print_warning "Scheduler may not be able to manage containers"
        fi
    fi

    # Load environment file if exists
    if [ -f "$env_file" ]; then
        docker_args+=("--env-file" "$env_file")
    fi

    # Run the scheduler
    ${CONTAINER_CMD} run -i --rm "${docker_args[@]}" "${IMAGE_NAME}"
}

# Run in background
run_detached() {
    local env_file="${1:-.env.scheduler}"
    local container_name="meet-teams-bot-scheduler"

    # Stop existing container if running
    if ${CONTAINER_CMD} ps -a --format '{{.Names}}' | grep -q "^${container_name}$"; then
        print_info "Stopping existing scheduler container..."
        ${CONTAINER_CMD} stop "${container_name}" >/dev/null 2>&1 || true
        ${CONTAINER_CMD} rm "${container_name}" >/dev/null 2>&1 || true
    fi

    print_info "Starting Meeting Bot Scheduler in background"
    print_info "Platform: ${PLATFORM}"
    print_info "Port: ${PORT}"
    echo ""

    local docker_args=(
        "-d"
        "--name" "${container_name}"
        "-p" "${PORT}:3000"
        "-e" "PLATFORM=${PLATFORM}"
        "-e" "CONTAINER_ENGINE=${CONTAINER_CMD}"
        "-v" "$(pwd)/recordings:/app/recordings"
        "--restart" "unless-stopped"
    )

    # Mount Docker/Podman socket
    if [ "${PLATFORM}" = "podman" ] || [ "${PLATFORM}" = "docker" ]; then
        if [ -S "/var/run/docker.sock" ]; then
            docker_args+=("-v" "/var/run/docker.sock:/var/run/docker.sock")
        fi
    fi

    # Load environment file if exists
    if [ -f "$env_file" ]; then
        docker_args+=("--env-file" "$env_file")
    fi

    # Run the scheduler
    if ${CONTAINER_CMD} run "${docker_args[@]}" "${IMAGE_NAME}"; then
        print_success "Scheduler started successfully"
        print_info "Container name: ${container_name}"
        print_info "API available at: http://localhost:${PORT}"
        echo ""
        print_info "Useful commands:"
        echo "  View logs:  ${CONTAINER_CMD} logs -f ${container_name}"
        echo "  Stop:       ${CONTAINER_CMD} stop ${container_name}"
        echo "  Restart:    ${CONTAINER_CMD} restart ${container_name}"
    else
        print_error "Failed to start scheduler"
        exit 1
    fi
}

# Stop scheduler
stop_scheduler() {
    local container_name="meet-teams-bot-scheduler"

    if ${CONTAINER_CMD} ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
        print_info "Stopping scheduler..."
        ${CONTAINER_CMD} stop "${container_name}"
        ${CONTAINER_CMD} rm "${container_name}"
        print_success "Scheduler stopped"
    else
        print_info "Scheduler is not running"
    fi
}

# Show logs
show_logs() {
    local container_name="meet-teams-bot-scheduler"

    if ${CONTAINER_CMD} ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
        ${CONTAINER_CMD} logs -f "${container_name}"
    else
        print_error "Scheduler is not running"
        exit 1
    fi
}

# Show status
show_status() {
    local container_name="meet-teams-bot-scheduler"

    print_info "Scheduler Status"
    echo ""

    if ${CONTAINER_CMD} ps --format '{{.Names}}' | grep -q "^${container_name}$"; then
        print_success "Status: Running"
        ${CONTAINER_CMD} ps --filter "name=${container_name}" --format "table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
        echo ""
        print_info "API: http://localhost:${PORT}"
        print_info "Health: http://localhost:${PORT}/health"
    else
        print_warning "Status: Not running"
    fi
}

# Show help
show_help() {
    cat << EOF
${BLUE}Meeting Bot Scheduler Runner${NC}

Usage:
  $0 build              - Build the scheduler container image
  $0 run [env-file]     - Run scheduler (default: .env.scheduler)
  $0 start [env-file]   - Start scheduler in background
  $0 stop               - Stop scheduler
  $0 restart [env-file] - Restart scheduler
  $0 logs               - Show scheduler logs
  $0 status             - Show scheduler status
  $0 help               - Show this help message

Environment Variables:
  PORT=3001                              - API port (default: 3001)
  PLATFORM=podman|docker|kubernetes|...  - Container platform
  DOCKER_IMAGE_NAME                      - Override image name

Examples:
  # Build scheduler image
  $0 build

  # Run scheduler with default config
  $0 run

  # Run with custom environment file
  $0 run .env.production

  # Start in background
  $0 start

  # View logs
  $0 logs

  # Check status
  $0 status

  # Stop scheduler
  $0 stop

Configuration:
  Create .env.scheduler file with your settings:
    PORT=3000
    PLATFORM=podman
    SCHEDULER_MAX_CONCURRENT_JOBS=10
    SCHEDULER_CONTAINER_IMAGE=meet-teams-bot:latest

See .env.scheduler for all available options.

EOF
}

# Main
case "${1:-}" in
    "build")
        build_image
        ;;
    "run")
        run_scheduler "${2:-.env.scheduler}"
        ;;
    "start")
        run_detached "${2:-.env.scheduler}"
        ;;
    "stop")
        stop_scheduler
        ;;
    "restart")
        stop_scheduler
        run_detached "${2:-.env.scheduler}"
        ;;
    "logs")
        show_logs
        ;;
    "status")
        show_status
        ;;
    "help"|"-h"|"--help")
        show_help
        ;;
    *)
        print_error "Unknown command: ${1:-}"
        echo ""
        show_help
        exit 1
        ;;
esac
