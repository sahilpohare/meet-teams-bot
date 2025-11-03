#!/usr/bin/env bash
#
# Setup script for VM deployment
# Installs podman-compose and configures the environment
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

print_info "Setting up Meeting Bot Scheduler on VM..."

# Check if running on Linux
if [[ "$OSTYPE" != "linux-gnu"* ]]; then
    print_error "This script is intended for Linux VMs"
    exit 1
fi

# Install podman-compose using pip
print_info "Installing podman-compose..."

# Check if pip3 is installed
if ! command -v pip3 &> /dev/null; then
    print_info "Installing pip3..."
    sudo apt-get update
    sudo apt-get install -y python3-pip
fi

# Install podman-compose
if ! command -v podman-compose &> /dev/null; then
    print_info "Installing podman-compose via pip..."
    pip3 install --user podman-compose

    # Add to PATH if not already there
    if ! command -v podman-compose &> /dev/null; then
        export PATH="$HOME/.local/bin:$PATH"
        echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
    fi
fi

print_success "podman-compose installed"

# Verify podman is installed
if ! command -v podman &> /dev/null; then
    print_error "Podman is not installed. Please install podman first."
    print_info "Install with: sudo apt-get install -y podman"
    exit 1
fi

print_success "Podman is installed"

# Enable and start podman socket (for rootless)
print_info "Configuring podman socket..."
systemctl --user enable podman.socket || true
systemctl --user start podman.socket || true

print_success "Podman socket configured"

# Check if ~/.env exists
if [ ! -f ~/.env ]; then
    print_warning "~/.env file not found"
    print_info "Please create ~/.env with your Azure credentials"
    print_info "You can use .env.example as a template"
fi

print_success "VM setup complete!"
echo
print_info "Next steps:"
echo "  1. Ensure ~/.env is populated with Azure credentials"
echo "  2. Run: ./start.sh"
