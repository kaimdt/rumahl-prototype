#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[INFO] Discarding local changes..."
git checkout .

echo "[INFO] Pulling latest changes..."
git pull

echo "[INFO] Setting executable permissions on all .sh files..."
chmod +x "$SCRIPT_DIR"/*.sh

echo "[ OK ] Update complete. You can now run: ./setup.sh or ./build.sh"
