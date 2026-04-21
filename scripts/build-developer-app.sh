#!/bin/bash
# Build IORA Developer App locally
# This script is used during IORA system updates to ensure the Developer App
# is built with the same toolchain and security parameters as other services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$REPO_ROOT/backend"

echo "=================================="
echo "Building IORA Developer App"
echo "=================================="
echo ""

# Check if we're in the right directory
if [ ! -f "$BACKEND_DIR/Dockerfile" ]; then
    echo "Error: backend/Dockerfile not found"
    echo "Please run this script from the IORA repository root"
    exit 1
fi

# Build the Developer App image from the main backend Dockerfile
# This ensures the Developer App is built with the same toolchain as other services
echo "Building Developer App from main backend Dockerfile..."
echo "Build context: $BACKEND_DIR"
echo "Target: iora-developer-app"
echo ""

cd "$REPO_ROOT"

docker build \
    -f backend/Dockerfile \
    -t iora-developer-app:local \
    --target iora-developer-app \
    --build-arg IORA_DEVELOPER_APP_OFFICIAL=true \
    backend/

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Developer App image built successfully!"
    echo "  Image: iora-developer-app:local"
    echo ""
    echo "The Developer App will be automatically installed when Developer Mode is enabled."
else
    echo ""
    echo "✗ Failed to build Developer App image"
    exit 1
fi

# Optionally tag with version
if [ ! -z "$1" ]; then
    VERSION="$1"
    echo "Tagging with version: $VERSION"
    docker tag iora-developer-app:local iora-developer-app:$VERSION
    echo "✓ Tagged as iora-developer-app:$VERSION"
fi

echo ""
echo "Done!"
