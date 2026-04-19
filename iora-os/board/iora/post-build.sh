#!/bin/bash
# Post-build script for IORA OS
# Runs after root filesystem is built but before image creation

set -e

TARGET_DIR=$1

echo "IORA OS: Running post-build script..."

# Create necessary directories
mkdir -p "${TARGET_DIR}/mnt/data"
mkdir -p "${TARGET_DIR}/var/lib/docker"
mkdir -p "${TARGET_DIR}/etc/docker"
mkdir -p "${TARGET_DIR}/etc/systemd/system"
mkdir -p "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants"
mkdir -p "${TARGET_DIR}/etc/systemd/system/local-fs.target.wants"
mkdir -p "${TARGET_DIR}/etc/apparmor.d"

# Configure Docker daemon
cat > "${TARGET_DIR}/etc/docker/daemon.json" <<EOF
{
  "storage-driver": "overlay2",
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "live-restore": true,
  "userland-proxy": false,
  "ipv6": false
}
EOF

# Auto-mount data partition at /mnt/data
cat > "${TARGET_DIR}/etc/systemd/system/mnt-data.mount" <<'EOF'
[Unit]
Description=IORA Data Partition
DefaultDependencies=no
After=systemd-fsck@dev-disk-by\x2dlabel-iora\x2ddata.service
Before=local-fs.target

[Mount]
What=/dev/disk/by-label/iora-data
Where=/mnt/data
Type=ext4
Options=defaults,noatime

[Install]
WantedBy=local-fs.target
EOF

ln -sf /etc/systemd/system/mnt-data.mount \
    "${TARGET_DIR}/etc/systemd/system/local-fs.target.wants/mnt-data.mount"

# Install systemd service for Docker Compose
cat > "${TARGET_DIR}/etc/systemd/system/iora-stack.service" <<'EOF'
[Unit]
Description=IORA Docker Stack
Requires=docker.service mnt-data.mount
After=docker.service network-online.target mnt-data.mount
Wants=network-online.target
ConditionPathIsDirectory=/mnt/data/iora

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/mnt/data/iora
ExecStartPre=/usr/bin/docker compose pull
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

# Enable IORA stack service
ln -sf /etc/systemd/system/iora-stack.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-stack.service"

# Configure ZRAM for /tmp and /var
cat > "${TARGET_DIR}/etc/systemd/system/zram.service" <<'EOF'
[Unit]
Description=Setup ZRAM for /tmp and /var
Before=local-fs.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/modprobe zram num_devices=2
ExecStart=/bin/sh -c 'echo lz4 > /sys/block/zram0/comp_algorithm'
ExecStart=/bin/sh -c 'echo 2G > /sys/block/zram0/disksize'
ExecStart=/usr/sbin/mkfs.ext4 -q /dev/zram0
ExecStart=/bin/mount -o noatime /dev/zram0 /tmp
ExecStart=/bin/sh -c 'echo lz4 > /sys/block/zram1/comp_algorithm'
ExecStart=/bin/sh -c 'echo 4G > /sys/block/zram1/disksize'
ExecStart=/usr/sbin/mkfs.ext4 -q /dev/zram1
ExecStart=/bin/mount -o noatime /dev/zram1 /var
ExecStop=/bin/umount /tmp
ExecStop=/bin/umount /var

[Install]
WantedBy=local-fs.target
EOF

ln -sf /etc/systemd/system/zram.service \
    "${TARGET_DIR}/etc/systemd/system/local-fs.target.wants/zram.service"

# Configure RAUC
mkdir -p "${TARGET_DIR}/etc/rauc"
cat > "${TARGET_DIR}/etc/rauc/system.conf" <<'EOF'
[system]
compatible=iora-os
bootloader=grub
bundle-formats=-plain

[keyring]
path=/etc/rauc/keyring.pem

[slot.rootfs.0]
device=/dev/sda3
type=ext4
bootname=A

[slot.rootfs.1]
device=/dev/sda4
type=ext4
bootname=B
EOF

# Install AppArmor profiles for IORA services
cat > "${TARGET_DIR}/etc/apparmor.d/iora-supervisor" <<'EOF'
#include <tunables/global>

/app/iora-supervisor {
  #include <abstractions/base>

  # Docker socket access
  /var/run/docker.sock rw,

  # Binary execution
  /app/iora-supervisor r,

  # Network
  network inet stream,
  network inet6 stream,
}
EOF

cat > "${TARGET_DIR}/etc/apparmor.d/iora-security" <<'EOF'
#include <tunables/global>

/app/iora-security {
  #include <abstractions/base>

  # Binary execution
  /app/iora-security r,

  # Security database
  /var/lib/iora/security.db rwk,

  # Network
  network inet stream,
  network inet6 stream,

  # PostgreSQL client
  /usr/lib/** rm,
}
EOF

cat > "${TARGET_DIR}/etc/apparmor.d/iora-secrets" <<'EOF'
#include <tunables/global>

/app/iora-secrets {
  #include <abstractions/base>

  # Binary execution
  /app/iora-secrets r,

  # Network
  network inet stream,
  network inet6 stream,

  # PostgreSQL client
  /usr/lib/** rm,
}
EOF

cat > "${TARGET_DIR}/etc/apparmor.d/iora-gateway" <<'EOF'
#include <tunables/global>

/app/iora-gateway {
  #include <abstractions/base>

  # Binary execution
  /app/iora-gateway r,

  # Gateway database
  /var/lib/iora/gateway.db rwk,

  # Network (restricted)
  network inet stream,
  network inet6 stream,

  # Deny certain capabilities
  deny capability sys_admin,
  deny capability sys_module,
}
EOF

# Set up read-only root filesystem marker
touch "${TARGET_DIR}/etc/.readonly"

# Install IORA Setup Wizard (first-boot web setup)
echo "IORA OS: Installing setup wizard..."
SETUP_SRC="${BR2_EXTERNAL_IORA_PATH}/board/iora/iora-setup"
SETUP_DST="${TARGET_DIR}/opt/iora/setup"
mkdir -p "${SETUP_DST}"
if [ -d "${SETUP_SRC}" ]; then
    cp "${SETUP_SRC}/setup-server.py" "${SETUP_DST}/setup-server.py"
    chmod 755 "${SETUP_DST}/setup-server.py"
fi

# Create iora-setup.service (first-boot setup wizard)
cat > "${TARGET_DIR}/etc/systemd/system/iora-setup.service" <<'EOF'
[Unit]
Description=IORA Home First-Boot Setup Wizard
After=network-online.target mnt-data.mount docker.service
Wants=network-online.target
ConditionPathExists=!/mnt/data/iora/.setup-complete

[Service]
Type=simple
ExecStart=/usr/bin/python3 /opt/iora/setup/setup-server.py
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Enable iora-setup service
ln -sf /etc/systemd/system/iora-setup.service \
    "${TARGET_DIR}/etc/systemd/system/multi-user.target.wants/iora-setup.service"

# Install IORA OS Update Client
echo "IORA OS: Installing update client..."
mkdir -p "${TARGET_DIR}/opt/iora/update"

cat > "${TARGET_DIR}/opt/iora/update/check-update.sh" <<'UPDATESCRIPT'
#!/bin/bash
# IORA OS Update Client - checks update.kaimdt.com for OS updates
# and installs RAUC bundles for atomic A/B updates.

set -euo pipefail

UPDATE_SERVER="https://update.kaimdt.com"
DOWNLOAD_SERVER="https://dist.kaimdt.com"
CHANNEL="stable"
TMPDIR="/tmp/iora-update"
LOGFILE="/var/log/iora-update.log"

log() { echo "[$(date -Iseconds)] $*" | tee -a "$LOGFILE"; }

# Read current version
CURRENT_VERSION=$(cat /etc/iora-version 2>/dev/null | awk '{print $NF}' || echo "unknown")

# Check for update
log "Checking for update (current: ${CURRENT_VERSION}, channel: ${CHANNEL})"

DEVICE_ID=$(cat /etc/machine-id 2>/dev/null || hostname)
RESPONSE=$(curl -sSf "${UPDATE_SERVER}/v1/iora/os/check?version=${CURRENT_VERSION}&channel=${CHANNEL}&arch=x86_64&device_id=${DEVICE_ID}" 2>/dev/null) || {
    log "ERROR: Failed to contact update server"
    exit 1
}

# Parse response
if command -v jq >/dev/null 2>&1; then
    UPDATE_AVAILABLE=$(echo "$RESPONSE" | jq -r '.update_available')
    LATEST_VERSION=$(echo "$RESPONSE" | jq -r '.latest_version // empty')
    DOWNLOAD_URL=$(echo "$RESPONSE" | jq -r '.release.download_url // empty')
    SHA256=$(echo "$RESPONSE" | jq -r '.release.sha256_checksum // empty')
else
    UPDATE_AVAILABLE=$(echo "$RESPONSE" | grep -o '"update_available":true' | head -1)
    [ -n "$UPDATE_AVAILABLE" ] && UPDATE_AVAILABLE="true" || UPDATE_AVAILABLE="false"
fi

if [ "$UPDATE_AVAILABLE" != "true" ]; then
    log "No update available. System is up to date."
    exit 0
fi

log "Update available: ${LATEST_VERSION}"

# Download RAUC bundle
mkdir -p "$TMPDIR"
BUNDLE_FILE="${TMPDIR}/iora-update-${LATEST_VERSION}.raucb"

if [ -f "$BUNDLE_FILE" ]; then
    EXISTING_SHA=$(sha256sum "$BUNDLE_FILE" | awk '{print $1}')
    if [ "$EXISTING_SHA" = "$SHA256" ]; then
        log "Using cached bundle"
    else
        rm -f "$BUNDLE_FILE"
    fi
fi

if [ ! -f "$BUNDLE_FILE" ]; then
    log "Downloading update bundle..."
    curl -fL -o "$BUNDLE_FILE" "$DOWNLOAD_URL" || {
        log "ERROR: Download failed"
        rm -f "$BUNDLE_FILE"
        exit 1
    }

    # Verify checksum
    DL_SHA=$(sha256sum "$BUNDLE_FILE" | awk '{print $1}')
    if [ -n "$SHA256" ] && [ "$DL_SHA" != "$SHA256" ]; then
        log "ERROR: Checksum mismatch!"
        rm -f "$BUNDLE_FILE"
        exit 1
    fi
    log "Download verified: OK"
fi

# Install via RAUC
if command -v rauc >/dev/null 2>&1; then
    log "Installing RAUC bundle..."
    if rauc install "$BUNDLE_FILE" 2>&1 | tee -a "$LOGFILE"; then
        log "Update installed successfully! Reboot to apply."
        # Report success to update server
        curl -sSf -X POST "${UPDATE_SERVER}/v1/iora/os/report" \
            -H "Content-Type: application/json" \
            -d "{\"device_id\":\"${DEVICE_ID}\",\"version\":\"${LATEST_VERSION}\",\"status\":\"completed\"}" \
            2>/dev/null || true
        rm -f "$BUNDLE_FILE"
    else
        log "ERROR: RAUC install failed"
        curl -sSf -X POST "${UPDATE_SERVER}/v1/iora/os/report" \
            -H "Content-Type: application/json" \
            -d "{\"device_id\":\"${DEVICE_ID}\",\"version\":\"${LATEST_VERSION}\",\"status\":\"failed\"}" \
            2>/dev/null || true
        exit 1
    fi
else
    log "RAUC not found - cannot install update"
    exit 1
fi
UPDATESCRIPT
chmod 755 "${TARGET_DIR}/opt/iora/update/check-update.sh"

# Create iora-update.timer (check for updates periodically)
cat > "${TARGET_DIR}/etc/systemd/system/iora-update-check.service" <<'EOF'
[Unit]
Description=IORA OS Update Check
After=network-online.target
Wants=network-online.target
ConditionPathExists=/mnt/data/iora/.setup-complete

[Service]
Type=oneshot
ExecStart=/opt/iora/update/check-update.sh
StandardOutput=journal
StandardError=journal
EOF

cat > "${TARGET_DIR}/etc/systemd/system/iora-update-check.timer" <<'EOF'
[Unit]
Description=IORA OS Update Check Timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=6h
RandomizedDelaySec=30min
Persistent=true

[Install]
WantedBy=timers.target
EOF

mkdir -p "${TARGET_DIR}/etc/systemd/system/timers.target.wants"
ln -sf /etc/systemd/system/iora-update-check.timer \
    "${TARGET_DIR}/etc/systemd/system/timers.target.wants/iora-update-check.timer"

# Create version file
echo "IORA OS $(date +%Y%m%d)" > "${TARGET_DIR}/etc/iora-version"

# Install welcome message
cat > "${TARGET_DIR}/etc/motd" <<'EOF'

  ██╗ ██████╗ ██████╗  █████╗     ██████╗ ███████╗
  ██║██╔═══██╗██╔══██╗██╔══██╗   ██╔═══██╗██╔════╝
  ██║██║   ██║██████╔╝███████║   ██║   ██║███████╗
  ██║██║   ██║██╔══██╗██╔══██║   ██║   ██║╚════██║
  ██║╚██████╔╝██║  ██║██║  ██║   ╚██████╔╝███████║
  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝    ╚═════╝ ╚══════╝

  Interface for Optimized Residential Autonomy

  Documentation: /opt/iora/docs
  Web Interface: http://[this-device-ip]:8080
  First Boot:    http://[this-device-ip]:8080/setup

EOF

echo "IORA OS: Post-build script completed successfully"
