#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
    echo "[ERROR] This script supports Debian/Ubuntu systems with apt-get."
    exit 1
fi

if ! grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
    echo "[WARN] No WSL environment detected. For native Linux, prefer ./install-requirements-linux.sh"
fi

if [ "${EUID}" -eq 0 ]; then
    SUDO=""
else
    SUDO="sudo"
fi

REQUIRED_PACKAGES=(
    build-essential
    git
    wget
    tar
    gzip
    xz-utils
    cpio
    unzip
    rsync
    bc
    libncurses-dev
    libssl-dev
    libelf-dev
    python3
    python3-pip
    qemu-utils
    zip
)

echo "[INFO] Updating package index..."
${SUDO} apt-get update

echo "[INFO] Installing required packages for WSL build workflow..."
${SUDO} DEBIAN_FRONTEND=noninteractive apt-get install -y "${REQUIRED_PACKAGES[@]}"

echo "[INFO] Skipping virtualbox and rauc by default in WSL."
echo "[INFO] Build script can still produce core images; OVA export and RAUC bundle may be skipped."

echo "[SUCCESS] WSL requirements installation completed."
