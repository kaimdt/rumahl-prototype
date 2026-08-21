#!/bin/bash
# Build rumahl Developer App locally
# This script is used during rumahl system updates to ensure the Developer App
# is built with the same toolchain and security parameters as other services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
BACKEND_DIR="$REPO_ROOT/backend"

echo "=================================="
echo "Building rumahl Developer App"
echo "=================================="
echo ""

# Check if we're in the right directory
if [ ! -f "$BACKEND_DIR/Dockerfile" ]; then
    echo "Error: backend/Dockerfile not found"
    echo "Please run this script from the rumahl repository root"
    exit 1
fi

# Build the Developer App image from the main backend Dockerfile
# This ensures the Developer App is built with the same toolchain as other services
echo "Building Developer App from main backend Dockerfile..."
echo "Build context: $BACKEND_DIR"
echo "Target: rumahl-developer-app"
echo ""

# Generate unique security token for this build
echo "Generating security token..."
RUMAHL_DEVELOPER_APP_TOKEN=$(openssl rand -hex 32)
echo "Token generated: ${RUMAHL_DEVELOPER_APP_TOKEN:0:16}... (truncated for security)"
echo ""

cd "$REPO_ROOT"

docker build \
    -f backend/Dockerfile \
    -t rumahl-developer-app:local \
    --target rumahl-developer-app \
    --build-arg RUMAHL_DEVELOPER_APP_OFFICIAL=true \
    --build-arg RUMAHL_DEVELOPER_APP_TOKEN="$RUMAHL_DEVELOPER_APP_TOKEN" \
    backend/

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Developer App image built successfully!"
    echo "  Image: rumahl-developer-app:local"
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
    docker tag rumahl-developer-app:local rumahl-developer-app:$VERSION
    echo "✓ Tagged as rumahl-developer-app:$VERSION"
fi

echo ""
echo "Done!"
