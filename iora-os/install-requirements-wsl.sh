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
    xorriso
    grub-common
    grub-pc-bin
    grub-efi-amd64-bin
    mtools
)

echo "[INFO] Updating package index..."
${SUDO} apt-get update

echo "[INFO] Installing required packages for WSL build workflow..."
${SUDO} DEBIAN_FRONTEND=noninteractive apt-get install -y "${REQUIRED_PACKAGES[@]}"

echo "[INFO] Skipping virtualbox and rauc by default in WSL."
echo "[INFO] Build script can still produce core images; OVA export and RAUC bundle may be skipped."

# ── Docker Engine ─────────────────────────────────────────────────────────────
# Docker is required on the build host to pre-compile IORA service binaries
# via build-all-images.sh (it runs `docker build` to produce statically-linked
# Go/Rust binaries that are embedded into the IORA OS image).
# In WSL, Docker Desktop (installed on the Windows side) is preferred, but the
# native Linux Docker Engine also works when WSL2 integration is enabled.
if command -v docker >/dev/null 2>&1; then
    echo "[INFO] Docker already available: $(docker --version)"
else
    echo "[INFO] Installing Docker Engine (native WSL2) via the official convenience script..."
    echo "[INFO] Alternatively, install Docker Desktop for Windows with WSL2 integration."
    curl -fsSL https://get.docker.com | ${SUDO} sh
    if [ -n "${SUDO_USER:-}" ]; then
        ${SUDO} usermod -aG docker "${SUDO_USER}"
        echo "[INFO] Added ${SUDO_USER} to the docker group."
        echo "[WARN] You may need to run 'newgrp docker' or restart your WSL session."
    fi
    echo "[INFO] Docker installed: $(docker --version 2>/dev/null || true)"
fi

echo "[SUCCESS] WSL requirements installation completed."
