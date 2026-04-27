#!/bin/bash
# Build RAUC update bundle for IORA OS

set -e

if [ $# -ne 2 ]; then
    echo "Usage: $0 <rootfs.squashfs> <output.raucb>"
    exit 1
fi

ROOTFS=$1
OUTPUT=$2
BUNDLE_DIR=$(mktemp -d)

echo "Creating RAUC bundle..."

# Copy files
cp "${ROOTFS}" "${BUNDLE_DIR}/rootfs.squashfs"
cp manifest.raucm "${BUNDLE_DIR}/manifest.raucm"
cp hook.sh "${BUNDLE_DIR}/hook.sh"
chmod +x "${BUNDLE_DIR}/hook.sh"

# Update SHA256 in manifest
SHA256=$(sha256sum "${ROOTFS}" | awk '{print $1}')
sed -i "s/sha256=auto/sha256=${SHA256}/" "${BUNDLE_DIR}/manifest.raucm"

# Create bundle (requires RAUC signing key)
rauc bundle \
    --cert=/path/to/cert.pem \
    --key=/path/to/key.pem \
    "${BUNDLE_DIR}" \
    "${OUTPUT}"

# Cleanup
rm -rf "${BUNDLE_DIR}"

echo "RAUC bundle created: ${OUTPUT}"
echo "Deploy with: rauc install ${OUTPUT}"
