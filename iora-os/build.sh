#!/bin/bash
#
# Quick build script for IORA OS
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
IORA OS Image Builder

Usage: $(basename $0) [OPTIONS]

Commands:
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
        --force-full-image
        --allow-fallback
        --force-fallback-image
        --require-all-artifacts
        --unattended | --non-interactive | --unattachment

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

EXAMPLES:
    $(basename $0)
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

For detailed documentation, see iora-os/README.md
EOF
}

normalize_shell_scripts

# ── Target selection (pc / rpi3 / rpi4 / rpi5 / generic-arm64) ──────────────
#
# The selected target drives which Buildroot defconfig / board overlay is
# used.  Users normally don't need to think about this — setup.sh persists
# the detected target in .setup-target, and any --target flag on the command
# line wins.  Non-PC targets export `IORA_TARGET` so the downstream scripts
# (build-all-images.sh / resume-build.sh) can pick up the right configuration.

TARGET_FILE="${SCRIPT_DIR}/.setup-target"
TARGET_DEFAULT="pc"
if [ -r "${TARGET_FILE}" ]; then
    TARGET_DEFAULT=$(tr -d '\n' < "${TARGET_FILE}" || echo pc)
fi
IORA_TARGET="${IORA_TARGET:-${TARGET_DEFAULT}}"

# Pull --target / --dev out of the argument list early so they apply to
# every subcommand below.  Any other flags pass through unchanged.
IORA_OS_DEV="${IORA_OS_DEV:-0}"
FILTERED_ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        --target|-t)
            IORA_TARGET="${2:-pc}"
            shift 2 || true
            ;;
        --target=*)
            IORA_TARGET="${1#*=}"
            shift
            ;;
        --dev)
            IORA_OS_DEV=1
            shift
            ;;
        --no-dev)
            IORA_OS_DEV=0
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

export IORA_TARGET
case "${IORA_TARGET}" in
    pc)
        export IORA_DEFCONFIG="iora_defconfig"
        export IORA_ARCH="x86_64"
        ;;
    rpi3)
        export IORA_DEFCONFIG="raspberrypi3_64_defconfig"
        export IORA_ARCH="aarch64"
        ;;
    rpi4)
        export IORA_DEFCONFIG="raspberrypi4_64_defconfig"
        export IORA_ARCH="aarch64"
        ;;
    rpi5)
        export IORA_DEFCONFIG="raspberrypi5_defconfig"
        export IORA_ARCH="aarch64"
        ;;
    generic-arm64)
        export IORA_DEFCONFIG="generic_arm64_defconfig"
        export IORA_ARCH="aarch64"
        ;;
    *)
        echo "Unknown --target: ${IORA_TARGET} (expected pc|rpi3|rpi4|rpi5|generic-arm64)"
        exit 1
        ;;
esac
echo "[IORA] Build target: ${IORA_TARGET} (arch=${IORA_ARCH}, defconfig=${IORA_DEFCONFIG})"

# ----------------------------------------------------------------------------
# Dev-mode flag (--dev).  This is DELIBERATELY only settable at build time:
# it gates whether the iora-dev-bridge binary + its systemd unit + the
# /etc/iora/dev-mode marker get baked into the image.  A production image
# does not carry the binary, so the marker cannot be faked into granting
# elevated capabilities at runtime.  Never honour an environment override
# here — we want this visible in build logs.
# ----------------------------------------------------------------------------
export IORA_OS_DEV
if [ "${IORA_OS_DEV}" = "1" ]; then
    echo "[IORA] ***** DEV BUILD *****"
    echo "[IORA] Integrity verification will be installed but NOT enabled."
    echo "[IORA] iora-dev-bridge will be installed and listens on 0.0.0.0:8101 (LAN-reachable)."
    echo "[IORA] Do not distribute this image."
fi


case "${1:-all}" in
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
