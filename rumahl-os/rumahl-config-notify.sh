#!/bin/bash
# ============================================================================
# rumahl-config-notify.sh – Global Config Change Notification System
# ============================================================================
# Broadcasts configuration changes to all rumahl services so they can
# hot-reload settings without restarting.
#
# Usage:
#   rumahl-config-notify.sh <key> <value>    # Notify of config change
#   rumahl-config-notify.sh --clear          # Clear all notifications
#
# This script is called by rumahl-home when a setting is updated via the API.
# ============================================================================

set -euo pipefail

KEY="${1:-}"
VALUE="${2:-}"

# Notification directory (shared across services)
NOTIFY_DIR="/var/run/ora/config-notify"
mkdir -p "$NOTIFY_DIR"

if [ "$KEY" = "--clear" ]; then
    # Clear all notifications
    rm -f "$NOTIFY_DIR"/*
    echo "Config notifications cleared"
    exit 0
fi

if [ -z "$KEY" ]; then
    echo "Usage: $0 <key> <value>"
    echo "       $0 --clear"
    exit 1
fi

# Create a notification file with timestamp
TIMESTAMP=$(date +%s)
NOTIFY_FILE="$NOTIFY_DIR/${TIMESTAMP}_${KEY//./_}"

# Write the change
cat > "$NOTIFY_FILE" <<EOF
KEY=$KEY
VALUE=$VALUE
TIMESTAMP=$TIMESTAMP
EOF

# Cleanup old notifications (older than 1 hour)
find "$NOTIFY_DIR" -type f -mmin +60 -delete 2>/dev/null || true

# Send SIGHUP to all rumahl services to trigger config reload
# Services can ignore this if they don't need to reload
for service in rumahl-core rumahl-home rumahl-assist rumahl-supervisor \
               rumahl-appstore rumahl-gateway rumahl-security rumahl-watchdog \
               rumahl-files rumahl-backup rumahl-connector rumahl-dev-bridge \
               rumahl-control rumahl-network-monitor rumahl-domain-validator \
               rumahl-resource-manager rumahl-updater; do
    if systemctl is-active --quiet "$service" 2>/dev/null; then
        # Send SIGHUP for graceful reload hint
        systemctl kill -s HUP "$service" 2>/dev/null || true
    fi
done

echo "Config change notified: $KEY"
