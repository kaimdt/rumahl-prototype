#!/usr/bin/env bash
# IORA Home Setup - Standalone Runner
# Use this to run the setup wizard on any Linux system (without IORA OS).
#
# Usage:
#   curl -sSL https://get.iora.home/setup.sh | bash
#   -- or --
#   ./run-setup.sh
#
# Requirements: Python 3.6+, Docker, Docker Compose

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check Python
if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: Python 3 is required. Install it first."
    exit 1
fi

# Check Docker
if ! command -v docker >/dev/null 2>&1; then
    echo "WARNING: Docker is not installed."
    echo "  The setup wizard will run, but services cannot be started"
    echo "  until Docker and Docker Compose are installed."
    echo ""
fi

# Create data directory
DATA_DIR="/mnt/data/iora"
if [ ! -d "$DATA_DIR" ]; then
    echo "Creating data directory: $DATA_DIR"
    mkdir -p "$DATA_DIR" 2>/dev/null || sudo mkdir -p "$DATA_DIR"
fi

echo ""
echo "  Starting IORA Home Setup Wizard..."
echo "  Open http://$(hostname -I 2>/dev/null | awk '{print $1}'):8080 in your browser"
echo ""

exec python3 "${SCRIPT_DIR}/setup-server.py"
