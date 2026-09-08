#!/usr/bin/env bash
#
# build-fast-iso.sh – Optimised rumahl bootable-installer-ISO build
#
# Uses:
#   • ccache        – Compiler cache (90%+ speedup on repeat builds)
#   • Persistent DL  – Source tarballs cached in ~/.rumahl-cache/dl
#   • fast-iso defconfig – Minimal rootfs, no Docker/TPM/Python/plymouth
#   • --minimal-artifacts – Only raw image + boot ISO (skip OVA/QCow2/…)
#   • Overridable --jobs (default: nproc)
#
# Prerequisites:
#   sudo apt-get install -y ccache   (or: ./setup.sh)
#
# Usage:
#   ./build-fast-iso.sh                        # first build
#   ./build-fast-iso.sh --resume               # resume after failure
#   ./build-fast-iso.sh --resume --progress    # resume with live progress
#   ./build-fast-iso.sh --jobs 16              # force 16 parallel make jobs
#   ./build-fast-iso.sh --clean                # wipe build dir, keep caches

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_DIR="${HOME}/.rumahl-cache"
BUILDROOT_DIR="${SCRIPT_DIR}/buildroot-2024.02"

# ── Ensure speed tools are available ───────────────────────────────────
_install_if_missing() {
    local name="$1" pkg="$2"
    if command -v "${name}" &>/dev/null; then return 0; fi
    echo "[WARN] ${name} not found — installing ${pkg}..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get update -qq && sudo apt-get install -y "${pkg}" && return 0
    elif command -v dnf &>/dev/null; then
        sudo dnf install -y "${pkg}" && return 0
    elif command -v pacman &>/dev/null; then
        sudo pacman -Sy --noconfirm "${pkg}" && return 0
    fi
    echo "[WARN] Cannot auto-install ${pkg}. Build will work but be slower."
    return 1
}
_install_if_missing ccache   ccache
_install_if_missing sccache  sccache
_install_if_missing mold     mold

# ── Ensure persistent cache directories exist ──────────────────────────
mkdir -p "${CACHE_DIR}/dl"          # Buildroot source downloads
mkdir -p "${CACHE_DIR}/ccache"      # C/C++ compiler cache
mkdir -p "${CACHE_DIR}/sccache"     # Rust compiler cache
mkdir -p "${CACHE_DIR}/cargo-target" # Persistent cargo target dir

# ── Parse arguments ────────────────────────────────────────────────────
MODE="full"
JOBS="$(nproc)"
RUMAHL_OS_DEV="${RUMAHL_OS_DEV:-0}"
FORWARD_ARGS=()
FAST_DEFCONFIG="rumahl_defconfig_fast_iso"

while [ $# -gt 0 ]; do
    case "$1" in
        --resume)
            MODE="resume"
            ;;
        --clean)
            echo "[INFO] Removing Buildroot build directory (caches preserved)..."
            rm -rf "${BUILDROOT_DIR}"
            echo "[ OK ] Clean done. Caches at ${CACHE_DIR} are untouched."
            exit 0
            ;;
        --jobs)
            shift
            JOBS="${1:-$(nproc)}"
            ;;
        --jobs=*)
            JOBS="${1#*=}"
            ;;
        --dev)
            RUMAHL_OS_DEV=1
            ;;
        --no-dev)
            RUMAHL_OS_DEV=0
            ;;
        --progress|--unattended|--non-interactive|--force-full-image|--require-all-artifacts)
            FORWARD_ARGS+=("$1")
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--resume] [--clean] [--dev] [--jobs N] [--progress] [--unattended]"
            exit 1
            ;;
    esac
    shift
done

echo "============================================"
echo " rumahl OS – Fast Boot ISO Build"
echo "============================================"
echo " Defconfig:    ${FAST_DEFCONFIG}"
echo " Jobs:         ${JOBS}"
echo " Mode:         ${MODE}"
echo " DL cache:     ${CACHE_DIR}/dl"
echo " ccache dir:   ${CACHE_DIR}/ccache"
echo " Rootfs size:  4G (vs 8G full build)"
echo " Rust profile: release-fast  (lto=off, codegen-units=16)"
echo " Rust cache:   sccache → ${CACHE_DIR}/sccache"
echo " Rust linker:  mold (2-5× faster linking)"
echo " Skipped pkgs: Docker, Python, TPM, RAUC, plymouth, vim, tmux, …"
if [ "${RUMAHL_OS_DEV}" = "1" ]; then
    echo " ***** DEV BUILD (rumahl-dev-bridge enabled) *****"
fi
echo "============================================"
echo ""

# ── Export environment for build-all-images.sh ─────────────────────────
export RUMAHL_DEFCONFIG="${FAST_DEFCONFIG}"
export RUMAHL_CCACHE_DIR="${CACHE_DIR}/ccache"
export BR2_DL_DIR="${CACHE_DIR}/dl"
export RUMAHL_FAST_BUILD=1
export RUMAHL_SCCACHE=1
export RUMAHL_MOLD=1
export RUMAHL_OS_DEV

if [ "${MODE}" = "resume" ]; then
    echo "[INFO] Resuming previous Buildroot build..."
    exec "${SCRIPT_DIR}/build.sh" resume \
        --jobs "${JOBS}" \
        "${FORWARD_ARGS[@]}"
else
    echo "[INFO] Starting full build with fast-iso defconfig..."
    exec "${SCRIPT_DIR}/build.sh" quick \
        --jobs "${JOBS}" \
        "${FORWARD_ARGS[@]}"
fi
