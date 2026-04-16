#!/bin/bash
#
# Quick build script for IORA OS
# Simpler wrapper around build-all-images.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
    cat <<EOF
IORA OS Image Builder

Usage: $(basename $0) [OPTIONS]

OPTIONS:
    all             Build all image formats (default)
    resume          Resume interrupted build (passes extra args)
    raw             Build only raw disk image (.img.xz)
    qcow2           Build QEMU/KVM image (.qcow2.xz)
    vdi             Build VirtualBox image (.vdi.zip)
    vmdk            Build VMware image (.vmdk.zip)
    ova             Build OVA image (.ova)
    rauc            Build RAUC update bundle (.raucb)
    clean           Clean build artifacts
    help            Show this help message

EXAMPLES:
    $(basename $0)              # Build all images
    $(basename $0) all          # Build all images
    $(basename $0) resume --progress  # Resume with progress bar
    $(basename $0) raw          # Build only raw disk image
    $(basename $0) clean        # Clean build artifacts

REQUIREMENTS:
    - Debian/Ubuntu Linux
    - 20GB+ free disk space
    - 4GB+ RAM
    - Build dependencies (script will check)

For detailed documentation, see iora-os/README.md
EOF
}

case "${1:-all}" in
    all)
        "${SCRIPT_DIR}/build-all-images.sh"
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
