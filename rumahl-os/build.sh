#!/bin/bash
#
# Quick build script for rumahl OS
# Simpler wrapper around build-all-images.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

normalize_shell_scripts() {
    # Keep all project shell scripts executable and with LF endings.
    find "${SCRIPT_DIR}" \
        -path "${SCRIPT_DIR}/buildroot-*" -prune -o \
        -type f -name "*.sh" -print0 | while IFS= read -r -d '' file; do
        sed -i 's/\r$//' "${file}" || true
        chmod +x "${file}" || true
    done
}

usage() {
    cat <<EOF
rumahl OS Image Builder

Usage: $(basename $0) [OPTIONS]

Commands:
    quick           Fast default: Buildroot + install artifacts only (raw + boot ISO)
    all             Full workflow (Buildroot + release artifacts)
    resume          Resume Buildroot compilation; optional artifact generation via --with-images
    images          Generate release artifacts from existing output/images only
    iso             Alias of 'all' (kept for compatibility)
    clean           Remove build outputs and releases
    help            Show this help message

OPTIONS:
    all/images options (forwarded to build-all-images.sh):
        --progress
        --images-only
        --minimal-artifacts | --quick
        --artifacts raw,boot-iso,qcow2,...
        --jobs N
        --xz-preset N
        --force-full-image
        --allow-fallback
        --force-fallback-image
        --require-all-artifacts
        --unattended | --non-interactive | --unattachment

    RAM build options (forwarded to build-all-images.sh / resume-build.sh):
        --ram               Build with output directory in RAM (tmpfs) to reduce SSD wear
        --ram-size SIZE     tmpfs size limit (e.g. 32G, 16G; default: 80% of available RAM)
        --ram-keep          Keep output in tmpfs after build (don't copy back to disk)
        --ram-aggressive    Also put dl/ (downloads) in tmpfs — maximum disk protection

    resume options (forwarded to resume-build.sh):
        --progress
        --clean-glibc
        --clean-linux
        --reconfigure
        --force-full-image
        --allow-fallback
        --force-fallback-image
        --with-images
        --unattended | --non-interactive | --unattachment
        --jobs N
        --log FILE
        --ram               RAM-based resume (requires existing tmpfs or re-mounts it)
        --ram-size SIZE     tmpfs size for resume

EXAMPLES:
    $(basename $0)
    $(basename $0) quick --progress
    $(basename $0) all --progress --require-all-artifacts
    $(basename $0) all --force-full-image --progress
    $(basename $0) resume --progress
    $(basename $0) resume --progress --with-images --unattended
    $(basename $0) images --unattended
    $(basename $0) clean

REQUIREMENTS:
    - Debian/Ubuntu Linux
    - 20GB+ free disk space
    - 4GB+ RAM
    - Build dependencies (script will check)

For detailed documentation, see rumahl-os/README.md
EOF
}

normalize_shell_scripts

# ── Target selection (pc / rpi3 / rpi4 / rpi5 / generic-arm64) ──────────────
#
# The selected target drives which Buildroot defconfig / board overlay is
# used.  Users normally don't need to think about this — setup.sh persists
# the detected target in .setup-target, and any --target flag on the command
# line wins.  Non-PC targets export `RUMAHL_TARGET` so the downstream scripts
# (build-all-images.sh / resume-build.sh) can pick up the right configuration.

TARGET_FILE="${SCRIPT_DIR}/.setup-target"
TARGET_DEFAULT="pc"
if [ -r "${TARGET_FILE}" ]; then
    TARGET_DEFAULT=$(tr -d '\n' < "${TARGET_FILE}" || echo pc)
fi
RUMAHL_TARGET="${RUMAHL_TARGET:-${TARGET_DEFAULT}}"

# Pull --target / --dev / --ram* out of the argument list early so they apply to
# every subcommand below.  Any other flags pass through unchanged.
RUMAHL_OS_DEV="${RUMAHL_OS_DEV:-0}"
RUMAHL_RAM_BUILD="${RUMAHL_RAM_BUILD:-0}"
RUMAHL_RAM_SIZE="${RUMAHL_RAM_SIZE:-}"
RUMAHL_RAM_KEEP="${RUMAHL_RAM_KEEP:-0}"
RUMAHL_RAM_AGGRESSIVE="${RUMAHL_RAM_AGGRESSIVE:-0}"
FILTERED_ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --target|-t)
            RUMAHL_TARGET="${2:-pc}"
            shift 2 || true
            ;;
        --target=*)
            RUMAHL_TARGET="${1#*=}"
            shift
            ;;
        --dev)
            RUMAHL_OS_DEV=1
            shift
            ;;
        --no-dev)
            RUMAHL_OS_DEV=0
            shift
            ;;
        --ram)
            RUMAHL_RAM_BUILD=1
            FILTERED_ARGS+=("$1")
            shift
            ;;
        --ram-size)
            RUMAHL_RAM_SIZE="${2:-}"
            FILTERED_ARGS+=("$1" "${2:-}")
            shift 2 || true
            ;;
        --ram-size=*)
            RUMAHL_RAM_SIZE="${1#*=}"
            FILTERED_ARGS+=("$1")
            shift
            ;;
        --ram-keep)
            RUMAHL_RAM_KEEP=1
            FILTERED_ARGS+=("$1")
            shift
            ;;
        --ram-aggressive)
            RUMAHL_RAM_AGGRESSIVE=1
            FILTERED_ARGS+=("$1")
            shift
            ;;
        *)
            FILTERED_ARGS+=("$1")
            shift
            ;;
    esac
done
# Restore positional args minus the consumed --target/-t options.
if [ ${#FILTERED_ARGS[@]} -gt 0 ]; then
    set -- "${FILTERED_ARGS[@]}"
else
    set --
fi

export RUMAHL_TARGET
export RUMAHL_RAM_BUILD
export RUMAHL_RAM_SIZE
export RUMAHL_RAM_KEEP
export RUMAHL_RAM_AGGRESSIVE

# ── RAM build notice ────────────────────────────────────────────────────────
if [ "${RUMAHL_RAM_BUILD}" = "1" ]; then
    echo "[rumahl] RAM BUILD ENABLED – output will be mounted on tmpfs"
    if [ -n "${RUMAHL_RAM_SIZE}" ]; then
        echo "[rumahl]   tmpfs size limit: ${RUMAHL_RAM_SIZE}"
    else
        echo "[rumahl]   tmpfs size: 80% of available RAM (override with --ram-size)"
    fi
    if [ "${RUMAHL_RAM_KEEP}" = "1" ]; then
        echo "[rumahl]   --ram-keep: output remains in tmpfs after build"
    fi
    if [ "${RUMAHL_RAM_AGGRESSIVE}" = "1" ]; then
        echo "[rumahl]   --ram-aggressive: dl/ + all caches also in tmpfs (max disk protection)"
    fi
fi

case "${RUMAHL_TARGET}" in
    pc)
        export RUMAHL_DEFCONFIG="rumahl_defconfig"
        export RUMAHL_ARCH="x86_64"
        ;;
    rpi3)
        export RUMAHL_DEFCONFIG="rumahl_rpi3_64_defconfig"
        export RUMAHL_ARCH="aarch64"
        ;;
    rpi4)
        export RUMAHL_DEFCONFIG="rumahl_rpi4_64_defconfig"
        export RUMAHL_ARCH="aarch64"
        ;;
    rpi5)
        export RUMAHL_DEFCONFIG="rumahl_rpi5_defconfig"
        export RUMAHL_ARCH="aarch64"
        ;;
    generic-arm64)
        export RUMAHL_DEFCONFIG="rumahl_generic_arm64_defconfig"
        export RUMAHL_ARCH="aarch64"
        ;;
    *)
        echo "Unknown --target: ${RUMAHL_TARGET} (expected pc|rpi3|rpi4|rpi5|generic-arm64)"
        exit 1
        ;;
esac
echo "[rumahl] Build target: ${RUMAHL_TARGET} (arch=${RUMAHL_ARCH}, defconfig=${RUMAHL_DEFCONFIG})"

# ----------------------------------------------------------------------------
# Dev-mode flag (--dev).  This is DELIBERATELY only settable at build time:
# it gates whether the rumahl-dev-bridge binary + its systemd unit + the
# /etc/ora/dev-mode marker get baked into the image.  A production image
# does not carry the binary, so the marker cannot be faked into granting
# elevated capabilities at runtime.  Never honour an environment override
# here — we want this visible in build logs.
# ----------------------------------------------------------------------------
export RUMAHL_OS_DEV
if [ "${RUMAHL_OS_DEV}" = "1" ]; then
    echo "[rumahl] ***** DEV BUILD *****"
    echo "[rumahl] Integrity verification will be installed but NOT enabled."
    echo "[rumahl] rumahl-dev-bridge will be installed and listens on 0.0.0.0:8101 (LAN-reachable)."
    echo "[rumahl] Do not distribute this image."
fi


case "${1:-quick}" in
    quick|fast)
        [ $# -gt 0 ] && shift
        "${SCRIPT_DIR}/build-all-images.sh" --minimal-artifacts "$@"
        ;;
    all)
        shift
        "${SCRIPT_DIR}/build-all-images.sh" "$@"
        ;;
    iso)
        shift
        "${SCRIPT_DIR}/build-all-images.sh" "$@"
        ;;
    images)
        shift
        "${SCRIPT_DIR}/build-all-images.sh" --images-only "$@"
        ;;
    resume)
        shift
        "${SCRIPT_DIR}/resume-build.sh" "$@"
        ;;
    raw|qcow2|vdi|vmdk|ova|rauc)
        echo "Building specific format not yet implemented"
        echo "Use './build-all-images.sh' to build all formats"
        exit 1
        ;;
    clean)
        echo "Cleaning build artifacts..."
        rm -rf "${SCRIPT_DIR}/buildroot-"*
        rm -rf "${SCRIPT_DIR}/releases"
        echo "Clean complete"
        ;;
    help|--help|-h)
        usage
        ;;
    *)
        echo "Unknown option: $1"
        usage
        exit 1
        ;;
esac
