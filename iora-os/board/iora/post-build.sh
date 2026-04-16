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

# Install systemd service for Docker Compose
cat > "${TARGET_DIR}/etc/systemd/system/iora-stack.service" <<'EOF'
[Unit]
Description=IORA Docker Stack
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

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
device=/dev/sda2
type=ext4
bootname=A

[slot.rootfs.1]
device=/dev/sda3
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

EOF

echo "IORA OS: Post-build script completed successfully"
