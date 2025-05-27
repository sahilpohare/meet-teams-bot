#!/bin/bash

# Meet Teams Bot - Serverless Runner
# This script provides an easy way to run the bot in serverless mode

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Generate UUID
generate_uuid() {
    if command -v uuidgen &> /dev/null; then
        uuidgen | tr '[:lower:]' '[:upper:]'
    elif command -v python3 &> /dev/null; then
        python3 -c "import uuid; print(str(uuid.uuid4()).upper())"
    elif command -v node &> /dev/null; then
        node -e "console.log(require('crypto').randomUUID().toUpperCase())"
    else
        # Fallback: generate a pseudo-UUID using date and random
        date +%s | sha256sum | head -c 8 | tr '[:lower:]' '[:upper:]'
        echo "-$(date +%N | head -c 4 | tr '[:lower:]' '[:upper:]')-$(date +%N | tail -c 4 | tr '[:lower:]' '[:upper:]')-$(shuf -i 1000-9999 -n 1)-$(shuf -i 100000000000-999999999999 -n 1)"
    fi
}

# Check if Docker is available
check_docker() {
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed or not in PATH"
        print_info "Please install Docker: https://docs.docker.com/get-docker/"
        exit 1
    fi
}

# Build Docker image
build_image() {
    print_info "Building Meet Teams Bot Docker image..."
    docker build -t meet-teams-bot .
    print_success "Docker image built successfully"
}

# Create output directory
create_output_dir() {
    local output_dir="./recordings"
    mkdir -p "$output_dir"
    echo "$output_dir"
}

# Process JSON configuration to add UUID if missing
process_config() {
    local config_json=$1
    local bot_uuid=$(generate_uuid)
    
    print_info "Generated new bot_uuid: $bot_uuid" >&2
    
    # Check if bot_uuid already exists in the config
    if echo "$config_json" | grep -q '"bot_uuid"[[:space:]]*:[[:space:]]*"[^"]*"'; then
        # Replace existing bot_uuid
        print_info "Replacing existing bot_uuid with new one" >&2
        local result=$(echo "$config_json" | sed 's/"bot_uuid"[[:space:]]*:[[:space:]]*"[^"]*"/"bot_uuid": "'$bot_uuid'"/g')
        echo "$result"
    else
        # Add new bot_uuid to JSON
        print_info "Adding new bot_uuid to configuration" >&2
        local clean_json=$(echo "$config_json" | tr -d '\n' | sed 's/[[:space:]]*$//')
        # Remove the last } and add our field with proper formatting
        local result=$(echo "$clean_json" | sed 's/\(.*\)}$/\1, "bot_uuid": "'$bot_uuid'"}/')
        echo "$result"
    fi
}

# Run bot with configuration file
run_with_config() {
    local config_file=$1
    
    if [ ! -f "$config_file" ]; then
        print_error "Configuration file '$config_file' not found"
        print_info "Please create a JSON configuration file. See params.json for example format."
        exit 1
    fi
    
    local output_dir=$(create_output_dir)
    local config_json=$(cat "$config_file")
    local processed_config=$(process_config "$config_json")
    
    print_info "Running Meet Teams Bot with configuration: $config_file"
    print_info "Output directory: $output_dir"
    
    # Debug: Show what we're sending to Docker (first 200 chars)
    local preview=$(echo "$processed_config" | head -c 200)
    print_info "Config preview: ${preview}..."
    
    # Validate JSON is not empty
    if [ -z "$processed_config" ] || [ "$processed_config" = "{}" ]; then
        print_error "Processed configuration is empty or invalid"
        print_info "Original config: $config_json"
        exit 1
    fi
    
    echo "$processed_config" | docker run -i \
        -v "$(pwd)/$output_dir:/app/recording_server/data" \
        meet-teams-bot
    
    print_success "Bot execution completed"
    print_info "Recordings saved to: $output_dir"
    
    # List generated files
    if [ -d "$output_dir" ] && [ "$(ls -A $output_dir)" ]; then
        print_success "Generated files:"
        find "$output_dir" -type f -name "*.mp4" -o -name "*.wav" | while read -r file; do
            size=$(du -h "$file" | cut -f1)
            echo -e "  ${GREEN}📁 $file${NC} (${size})"
        done
    fi
}

# Run bot with JSON input
run_with_json() {
    local json_input=$1
    local output_dir=$(create_output_dir)
    local processed_config=$(process_config "$json_input")
    
    print_info "Running Meet Teams Bot with provided JSON configuration"
    print_info "Output directory: $output_dir"
    
    # Debug: Show what we're sending to Docker (first 200 chars)
    local preview=$(echo "$processed_config" | head -c 200)
    print_info "Config preview: ${preview}..."
    
    # Validate JSON is not empty
    if [ -z "$processed_config" ] || [ "$processed_config" = "{}" ]; then
        print_error "Processed configuration is empty or invalid"
        print_info "Original config: $json_input"
        exit 1
    fi
    
    echo "$processed_config" | docker run -i \
        -v "$(pwd)/$output_dir:/app/recording_server/data" \
        meet-teams-bot
    
    print_success "Bot execution completed"
    print_info "Recordings saved to: $output_dir"
    
    # List generated files
    if [ -d "$output_dir" ] && [ "$(ls -A $output_dir)" ]; then
        print_success "Generated files:"
        find "$output_dir" -type f -name "*.mp4" -o -name "*.wav" | while read -r file; do
            size=$(du -h "$file" | cut -f1)
            echo -e "  ${GREEN}📁 $file${NC} (${size})"
        done
    fi
}

# Clean recordings directory
clean_recordings() {
    local output_dir="./recordings"
    if [ -d "$output_dir" ]; then
        print_warning "This will delete all files in $output_dir"
        read -p "Are you sure? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            rm -rf "$output_dir"/*
            print_success "Recordings directory cleaned"
        else
            print_info "Operation cancelled"
        fi
    else
        print_info "No recordings directory to clean"
    fi
}

# Show help
show_help() {
    echo "Meet Teams Bot - Serverless Runner"
    echo
    echo "Usage:"
    echo "  $0 build                     - Build the Docker image"
    echo "  $0 run <config_file>         - Run bot with configuration file"
    echo "  $0 run-json '<json>'         - Run bot with JSON configuration"
    echo "  $0 clean                     - Clean recordings directory"
    echo "  $0 help                      - Show this help message"
    echo
    echo "Examples:"
    echo "  $0 build"
    echo "  $0 run params.json"
    echo "  $0 run-json '{\"meeting_url\":\"https://meet.google.com/abc-def-ghi\", \"bot_name\":\"RecordingBot\"}'"
    echo "  $0 clean"
    echo
    echo "Features:"
    echo "  • Automatically generates bot_uuid if not provided"
    echo "  • Saves recordings to ./recordings directory"
    echo "  • Lists generated files after completion"
    echo
    echo "Configuration file should contain JSON with meeting parameters."
    echo "See params.json for example format."
}

# Main script logic
main() {
    case "${1:-}" in
        "build")
            check_docker
            build_image
            ;;
        "run")
            if [ -z "${2:-}" ]; then
                print_error "Please specify a configuration file"
                print_info "Usage: $0 run <config_file>"
                exit 1
            fi
            check_docker
            run_with_config "$2"
            ;;
        "run-json")
            if [ -z "${2:-}" ]; then
                print_error "Please provide JSON configuration"
                print_info "Usage: $0 run-json '<json_config>'"
                exit 1
            fi
            check_docker
            run_with_json "$2"
            ;;
        "clean")
            clean_recordings
            ;;
        "help"|"-h"|"--help"|"")
            show_help
            ;;
        *)
            print_error "Unknown command: $1"
            show_help
            exit 1
            ;;
    esac
}

main "$@" 