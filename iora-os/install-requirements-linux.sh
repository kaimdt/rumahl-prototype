#!/usr/bin/env bash
set -euo pipefail

if ! command -v apt-get >/dev/null 2>&1; then
    echo "[ERROR] This script supports Debian/Ubuntu systems with apt-get."
    exit 1
fi

if grep -qiE "(microsoft|wsl)" /proc/version 2>/dev/null; then
    echo "[WARN] WSL environment detected. For WSL, prefer ./install-requirements-wsl.sh"
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

OPTIONAL_PACKAGES=(
    virtualbox
    rauc
)

echo "[INFO] Updating package index..."
${SUDO} apt-get update

echo "[INFO] Installing required packages..."
${SUDO} DEBIAN_FRONTEND=noninteractive apt-get install -y "${REQUIRED_PACKAGES[@]}"

echo "[INFO] Attempting to install optional packages (VirtualBox, RAUC)..."
if ${SUDO} DEBIAN_FRONTEND=noninteractive apt-get install -y "${OPTIONAL_PACKAGES[@]}"; then
    echo "[INFO] Optional packages installed."
else
    echo "[WARN] Optional packages could not be installed automatically."
    echo "[WARN] OVA export (VBoxManage) and/or RAUC bundle creation may be skipped."
fi

echo "[SUCCESS] Linux requirements installation completed."
