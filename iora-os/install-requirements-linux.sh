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
    xorriso
    grub-common
    grub-pc-bin
    grub-efi-amd64-bin
    mtools
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

# ── Docker Engine ─────────────────────────────────────────────────────────────
# Docker is required on the build host to pre-compile IORA service binaries
# via build-all-images.sh (it runs `docker build` to produce statically-linked
# Go/Rust binaries that are embedded into the IORA OS image).
if command -v docker >/dev/null 2>&1; then
    echo "[INFO] Docker already installed: $(docker --version)"
else
    echo "[INFO] Installing Docker Engine via the official convenience script..."
    curl -fsSL https://get.docker.com | ${SUDO} sh
    # Allow the current user to use Docker without sudo.
    if [ -n "${SUDO_USER:-}" ]; then
        ${SUDO} usermod -aG docker "${SUDO_USER}"
        echo "[INFO] Added ${SUDO_USER} to the docker group."
        echo "[WARN] You may need to log out and back in (or run 'newgrp docker') for the group to take effect."
    fi
    echo "[INFO] Docker installed: $(docker --version 2>/dev/null || true)"
fi

echo "[SUCCESS] Linux requirements installation completed."
