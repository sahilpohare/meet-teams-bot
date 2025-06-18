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

# Emoji icons
ICON_INFO="ℹ️"
ICON_SUCCESS="✅"
ICON_WARNING="⚠️"
ICON_ERROR="❌"
ICON_FILE="📁"
ICON_BOT="🤖"
ICON_DISPLAY="🖥️"

print_info()    { echo -e "${BLUE}${ICON_INFO}  $1${NC}" >&2; }
print_success() { echo -e "${GREEN}${ICON_SUCCESS} $1${NC}" >&2; }
print_warning() { echo -e "${YELLOW}${ICON_WARNING}  $1${NC}" >&2; }
print_error()   { echo -e "${RED}${ICON_ERROR} $1${NC}" >&2; }

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

# Mask sensitive information in JSON
mask_sensitive_json() {
    local json=$1
    # Mask API keys, tokens, and other sensitive fields
    echo "$json" | sed -E 's/("(api_key|token|secret|password|webhook|key)"[[:space:]]*:[[:space:]]*")[^"]*/\1********/g'
}

# Process JSON configuration to add UUID if missing
process_config() {
    local config_json="$1"
    local bot_uuid
    bot_uuid=$(generate_uuid)
    print_info "${ICON_BOT} Generated bot session ID: ${bot_uuid:0:8}..."
    if command -v jq &> /dev/null; then
        echo "$config_json" | jq --arg bot_uuid "$bot_uuid" '.bot_uuid = $bot_uuid'
    else
        print_warning "jq not found, falling back to sed for bot_uuid (may be fragile)"
        if echo "$config_json" | grep -q '"bot_uuid"[[:space:]]*:[[:space:]]*"[^\"]*"'; then
            echo "$config_json" | sed 's/"bot_uuid"[[:space:]]*:[[:space:]]*"[^\"]*"/"bot_uuid": "'$bot_uuid'"/g'
        else
            local clean_json=$(echo "$config_json" | tr -d '\n' | sed 's/[[:space:]]*$//')
            echo "$clean_json" | sed 's/\(.*\)}$/\1, "bot_uuid": "'$bot_uuid'"}/'
        fi
    fi
}

<<<<<<< HEAD
# Helper: parse CLI key=value overrides and apply to JSON (robust, KISS)
apply_overrides() {
    local json="$1"
    shift
    local overrides=("$@")
    for kv in "${overrides[@]}"; do
        if [[ "$kv" =~ ^([a-zA-Z0-9_]+)=(.*)$ ]]; then
            key="${BASH_REMATCH[1]}"
            value="${BASH_REMATCH[2]}"
            if [[ "$value" =~ ^[0-9]+$ ]] || [[ "$value" == "true" ]] || [[ "$value" == "false" ]]; then
                json_out=$(echo "$json" | jq --arg key "$key" --argjson value "$value" '.[$key] = $value' 2>&1)
            else
                json_out=$(echo "$json" | jq --arg key "$key" --arg value "$value" '.[$key] = $value' 2>&1)
            fi
            if [ $? -ne 0 ]; then
                print_error "Failed to apply override: $kv"
                print_error "jq error: $json_out"
                print_error "Key: $key, Value: $value"
                print_error "Current JSON: $(echo "$json" | head -c 300)"
                exit 1
            fi
            json="$json_out"
=======
# Run bot with configuration file
run_with_config() {
    local config_file=$1
    local override_meeting_url=$2
    local recording_mode=${RECORDING:-true}  # Par défaut true
    
    if [ ! -f "$config_file" ]; then
        print_error "Configuration file '$config_file' not found"
        print_info "Please create a JSON configuration file. See params.json for example format."
        exit 1
    fi
    
    local output_dir=$(create_output_dir)
    local config_json=$(cat "$config_file")
    
    # Override meeting URL if provided as argument
    if [ -n "$override_meeting_url" ]; then
        print_info "Overriding meeting URL with: $override_meeting_url"
        # Use jq if available, otherwise use sed
        if command -v jq &> /dev/null; then
            config_json=$(echo "$config_json" | jq --arg url "$override_meeting_url" '.meeting_url = $url')
>>>>>>> 4502dfd (recordong mode true or false)
        else
            print_error "Invalid argument: $kv (must be key=value)"
            exit 1
        fi
    done
    echo "$json"
}

# Run bot with configuration file and CLI overrides
run_with_config_and_overrides() {
    local config_file=$1
    shift
    local overrides=("$@")
    local config_json
    config_json=$(cat "$config_file")
    if [ ${#overrides[@]} -gt 0 ]; then
        config_json=$(apply_overrides "$config_json" "${overrides[@]}")
        print_info "Applied CLI overrides: ${overrides[*]}"
    fi
    local output_dir=$(create_output_dir)
    local processed_config=$(process_config "$config_json")
<<<<<<< HEAD
    print_info "Initializing bot session..."
=======
    
    print_info "Running Meet Teams Bot with configuration: $config_file"
    print_info "Recording mode: $recording_mode"
    if [ -n "$override_meeting_url" ]; then
        print_info "Meeting URL: $override_meeting_url"
    fi
>>>>>>> 4502dfd (recordong mode true or false)
    print_info "Output directory: $output_dir"
    # Show masked config preview (only non-sensitive fields)
    local preview
    preview=$(echo "$processed_config" | jq 'del(.bots_api_key, .bots_webhook, .speech_to_text_api_key) | tostring' 2>&1 | head -c 100)
    if [ $? -ne 0 ]; then
        print_error "jq error while generating config preview: $preview"
        print_error "Processed config: $processed_config"
    else
        print_info "Configuration loaded successfully"
    fi
    # Validate JSON
    if [ -z "$processed_config" ] || [ "$processed_config" = "{}" ]; then
        print_error "Invalid configuration format after processing."
        print_error "Original config_json: $config_json"
        print_error "Processed config: $processed_config"
        exit 1
    fi
    # Extract bot_uuid for summary message
    local bot_uuid
    bot_uuid=$(echo "$processed_config" | jq -r '.bot_uuid // empty')
    # Run the bot
    echo "$processed_config" | docker run -i \
        -e RECORDING="$recording_mode" \
        -v "$(pwd)/$output_dir:/app/data" \
        meet-teams-bot 2>&1 | while IFS= read -r line; do
            if [[ $line == *"Starting virtual display"* ]]; then
                print_info "${ICON_DISPLAY} $line"
            elif [[ $line == *"Virtual display started"* ]]; then
                print_success "$line"
            else
                echo "$line"
            fi
        done
    # Check if the last command was successful
    if [ ${PIPESTATUS[0]} -eq 0 ]; then
        print_success "Bot session completed successfully"
        # List generated files with better formatting
        if [ -d "$output_dir" ] && [ "$(ls -A $output_dir)" ]; then
            echo
            print_success "Generated recordings:"
            find "$output_dir" -type f \( -name "*.mp4" -o -name "*.wav" \) -print0 | while IFS= read -r -d '' file; do
                size=$(du -h "$file" | cut -f1)
                filename=$(basename "$file")
                echo -e "  ${GREEN}${ICON_FILE} $filename${NC} (${size})"
            done
        fi
        if [ -n "$bot_uuid" ]; then
            echo -e "\n${GREEN}done, check out your recording and metadata for bot UUID in $bot_uuid${NC}"
            echo
            echo "./recordings/$bot_uuid/output.mp4"
            echo "./recordings/$bot_uuid/"  # folder for metadata and all files
        fi
    else
        print_error "Bot session failed"
        exit 1
    fi
}

# Run bot with JSON input
run_with_json() {
    local json_input=$1
    local recording_mode=${RECORDING:-true}  # Par défaut true
    local output_dir=$(create_output_dir)
    local processed_config=$(process_config "$json_input")
    
    print_info "Running Meet Teams Bot with provided JSON configuration"
    print_info "Recording mode: $recording_mode"
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
        -e RECORDING="$recording_mode" \
        -v "$(pwd)/$output_dir:/app/data" \
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
    echo -e "${BLUE}Meet Teams Bot - Serverless Runner${NC}"
    echo
    echo "Usage:"
    echo "  $0 build                        - Build the Docker image"
    echo "  $0 run [config_file] [key=value ...]   - Run bot with config file (default: bot.config.json), override any config param"
    echo "  $0 run-json '<json>'            - Run bot with JSON configuration"
    echo "  $0 clean                        - Clean recordings directory"
    echo "  $0 help                         - Show this help message"
    echo
    echo "Environment Variables:"
    echo "  RECORDING=true|false         - Enable/disable video recording (default: true)"
    echo
    echo "Examples:"
    echo "  $0 build"
<<<<<<< HEAD
    echo "  $0 run" 
    echo "  $0 run bot.config.json"
    echo "  $0 run meeting_url=https://meet.google.com/abc-defg-hij bot_name='My Bot'"
    echo "  $0 run bot.config.json bot_name='My Bot' bots_api_key=123"
    echo "  $0 clean"
    echo
    echo -e "${YELLOW}Features:${NC}"
    echo "  • Secure configuration handling"
    echo "  • Automatic session ID generation"
    echo "  • Meeting URL and all config params override support via CLI"
    echo "  • Organized recording storage"
    echo "  • Defaults to bot.config.json if no config file is specified"
=======
    echo "  $0 run params.json"
    echo "  $0 run params.json 'https://meet.google.com/new-meeting-url'"
    echo "  RECORDING=false $0 run params.json  # Run without video recording"
    echo "  $0 run-json '{\"meeting_url\":\"https://meet.google.com/abc-def-ghi\", \"bot_name\":\"RecordingBot\"}'"
    echo "  RECORDING=false $0 run-json '{...}'  # Run JSON config without recording"
    echo "  $0 clean"
    echo
    echo "Features:"
    echo "  • Automatically generates bot_uuid if not provided"
    echo "  • Override meeting URL by passing it as last argument"
    echo "  • Control video recording with RECORDING environment variable"
    echo "  • Saves recordings to ./recordings directory (when recording enabled)"
    echo "  • Lists generated files after completion"
>>>>>>> 4502dfd (recordong mode true or false)
    echo
    echo "For configuration format, see bot.config.json"
}

# Main script logic
main() {
    case "${1:-}" in
        "build")
            check_docker
            build_image
            ;;
        "run")
            local default_config="bot.config.json"
            shift # remove 'run'
            # If first arg is a file, use it as config, else use default
            local config_file="$default_config"
            local overrides=()
            if [ -n "${1:-}" ] && [ -f "${1}" ]; then
                config_file="$1"
                shift
            fi
            # All remaining args are key=value overrides
            while [ -n "${1:-}" ]; do
                overrides+=("$1")
                shift
            done
            if [ ! -f "$config_file" ]; then
                print_error "Configuration file not found: $config_file"
                print_info "Please create $config_file or specify a config file."
                exit 1
            fi
            print_info "Using config file: $config_file"
            run_with_config_and_overrides "$config_file" "${overrides[@]}"
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