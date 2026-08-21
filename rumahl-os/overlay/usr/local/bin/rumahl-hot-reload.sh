#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# rumahl OS – VM Hot-Reload Daemon
# ═══════════════════════════════════════════════════════════════════
# Runs inside the QEMU VM. Mounts the 9p host share and watches for
# new binaries. When .trigger changes, copies binaries and restarts
# the corresponding systemd services.
#
# This script should be placed in the Buildroot overlay:
#   rumahl-os/overlay/usr/local/bin/rumahl-hot-reload.sh
#
# And started by a systemd oneshot or init script:
#   [Unit]
#   Description=ORA Hot Reload Monitor
#   After=network.target
#   [Service]
#   Type=simple
#   ExecStart=/usr/local/bin/rumahl-hot-reload.sh
#   Restart=always
#   [Install]
#   WantedBy=multi-user.target
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

SHARE_TAG="oradev"
MOUNT_POINT="/mnt/oradev"
TRIGGER_FILE="$MOUNT_POINT/binaries/.trigger"
BIN_SRC="$MOUNT_POINT/binaries"
BIN_DST="/usr/bin"
LOG_TAG="rumahl-hot-reload"
MAX_WAIT=30   # seconds to wait for mount at boot

# ── Known ORA services (binary name = service name) ─────────────
# Add/remove based on your actual rumahl OS service names
KNOWN_SERVICES=(
    rumahl-home
    rumahl-core
    rumahl-appstore
    rumahl-supervisor
    rumahl-files
    rumahl-secrets
    rumahl-security
    rumahl-gateway
    rumahl-assist
    rumahl-control
    rumahl-watchdog
    rumahl-connector
    rumahl-network-monitor
    rumahl-domain-validator
    rumahl-resource-manager
    rumahl-updater
    rumahl-backup
    rumahl-nginx
)

log() { echo "[$(date '+%H:%M:%S')] $*" | systemd-cat -t "$LOG_TAG" 2>/dev/null || echo "[$(date '+%H:%M:%S')] $*"; }

# ── Wait for 9p mount ─────────────────────────────────────────────
wait_for_mount() {
    local waited=0
    log "Waiting for 9p mount at $MOUNT_POINT (tag=$SHARE_TAG)..."
    while [ $waited -lt $MAX_WAIT ]; do
        if mountpoint -q "$MOUNT_POINT" 2>/dev/null; then
            log "Mount OK after ${waited}s"
            return 0
        fi
        sleep 1
        waited=$((waited + 1))
    done
    log "WARNING: Mount not available after ${MAX_WAIT}s – will keep retrying"
    return 1
}

# ── Mount the 9p share ────────────────────────────────────────────
mount_share() {
    if mountpoint -q "$MOUNT_POINT" 2>/dev/null; then
        return 0
    fi
    mkdir -p "$MOUNT_POINT"
    # Try virtio-9p
    if mount -t 9p -o trans=virtio,version=9p2000.L,msize=262144 "$SHARE_TAG" "$MOUNT_POINT" 2>/dev/null; then
        log "Mounted $SHARE_TAG → $MOUNT_POINT (9p virtio)"
        return 0
    fi
    # Fallback: mmio 9p
    if mount -t 9p -o trans=mmio,version=9p2000.L,msize=262144 "$SHARE_TAG" "$MOUNT_POINT" 2>/dev/null; then
        log "Mounted $SHARE_TAG → $MOUNT_POINT (9p mmio)"
        return 0
    fi
    log "ERROR: Failed to mount 9p share"
    return 1
}

# ── Restart a service if the binary changed ───────────────────────
restart_if_changed() {
    local svc="$1"
    local src="$BIN_SRC/$svc"
    local dst="$BIN_DST/$svc"

    if [ ! -f "$src" ]; then
        return 0  # not in this build, skip
    fi

    # Compare: only restart if binary actually changed
    if [ -f "$dst" ] && cmp -s "$src" "$dst" 2>/dev/null; then
        return 0  # unchanged
    fi

    log "  → Updating $svc..."
    cp "$src" "$dst"
    chmod +x "$dst"

    # Restart if the service exists
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        systemctl restart "$svc"
        log "    $svc restarted"
    elif systemctl is-enabled --quiet "$svc" 2>/dev/null; then
        systemctl start "$svc"
        log "    $svc started"
    else
        log "    $svc updated (no matching systemd unit, skipped restart)"
    fi
}

# ── Main loop ──────────────────────────────────────────────────────
log "═══ rumahl OS Hot-Reload Daemon starting ═══"

# Initial mount
while ! mount_share; do
    sleep 2
done

LAST_TRIGGER=""
log "Watching $TRIGGER_FILE for changes..."

while true; do
    # Check if mount is still alive
    if ! mountpoint -q "$MOUNT_POINT" 2>/dev/null; then
        log "Mount lost, re-mounting..."
        mount_share
        sleep 1
        continue
    fi

    if [ -f "$TRIGGER_FILE" ]; then
        NEW_TRIGGER=$(cat "$TRIGGER_FILE" 2>/dev/null || echo "")
        if [ -n "$NEW_TRIGGER" ] && [ "$NEW_TRIGGER" != "$LAST_TRIGGER" ]; then
            log "─────────────────────────────────────────────────"
            log "New build detected! Deploying binaries..."
            log "─────────────────────────────────────────────────"

            for svc in "${KNOWN_SERVICES[@]}"; do
                restart_if_changed "$svc"
            done

            LAST_TRIGGER="$NEW_TRIGGER"
            log "Deploy complete. Watching..."
        fi
    fi

    sleep 1
done
