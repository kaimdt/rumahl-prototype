#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="auto"

usage() {
    cat <<EOF
Usage: $(basename "$0") [--auto|--linux|--wsl]

Options:
  --auto   Detect environment automatically (default)
  --linux  Force native Linux dependency set
  --wsl    Force WSL dependency set
  -h, --help
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --auto)
            MODE="auto"
            ;;
        --linux)
            MODE="linux"
            ;;
        --wsl)
            MODE="wsl"
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "[ERROR] Unknown option: $1"
            usage
            exit 1
            ;;
    esac
    shift
done

is_wsl=false
if grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
    is_wsl=true
fi

if [ "${MODE}" = "auto" ]; then
    if [ "${is_wsl}" = true ]; then
        MODE="wsl"
    else
        MODE="linux"
    fi
fi

case "${MODE}" in
    linux)
        echo "[INFO] Installing dependencies for native Linux VM/host..."
        exec "${SCRIPT_DIR}/install-requirements-linux.sh"
        ;;
    wsl)
        echo "[INFO] Installing dependencies for WSL..."
        exec "${SCRIPT_DIR}/install-requirements-wsl.sh"
        ;;
    *)
        echo "[ERROR] Invalid mode: ${MODE}"
        exit 1
        ;;
esac
