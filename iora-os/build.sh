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
