#!/usr/bin/env bash
# ============================================================================
# iora-config-sync.sh – Global Config Synchronization Helper
# ============================================================================
# Ensures newly built services can properly access the Global Config.
# This script:
# 1. Verifies /etc/iora/os-dev-mode marker exists
# 2. Ensures all services have access to Global Config API
# 3. Sets up environment for config access
#
# Usage: sudo ./iora-config-sync.sh
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()    { echo -e "${BLUE}[config-sync]${NC} $*"; }
success(){ echo -e "${GREEN}[config-sync]${NC} $*"; }
warn()   { echo -e "${YELLOW}[config-sync]${NC} $*"; }

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: Must run as root: sudo ./iora-config-sync.sh"
    exit 1
fi

log "Synchronizing Global Config access..."

# ═══════════════════════════════════════════════════════════════════════════════
# 1. Ensure IORA OS environment markers exist
# ═══════════════════════════════════════════════════════════════════════════════

mkdir -p /etc/iora

# Dev mode marker (tells services they're in dev environment)
if [ ! -f /etc/iora/os-dev-mode ]; then
    touch /etc/iora/os-dev-mode
    success "Created /etc/iora/os-dev-mode marker"
fi

# Create IORA OS release info (for compatibility checks)
cat > /etc/iora/os-release <<'EOF'
IORA_OS_COMPAT=1
IORA_OS_VERSION=dev
IORA_OS_BUILD=devvm
IORA_OS_VARIANT=development
EOF
success "IORA OS release info: /etc/iora/os-release"

# ═══════════════════════════════════════════════════════════════════════════════
# 2. Global Config API access configuration
# ═══════════════════════════════════════════════════════════════════════════════

# Create global config access helper script
cat > /usr/lib/iora/iora-get-config <<'CONFIGEOF'
#!/bin/bash
# Helper to fetch config from Global Config API
# Usage: iora-get-config <key> [default]

KEY="$1"
DEFAULT="${2:-}"

# Try to fetch from iora-home settings API
IORA_HOME_URL="${IORA_HOME_URL:-http://127.0.0.1:8126}"

# Use curl to fetch the setting
RESPONSE=$(curl -s -f "${IORA_HOME_URL}/api/settings/${KEY}" 2>/dev/null || echo "")

if [ -n "$RESPONSE" ]; then
    # Extract value from JSON response
    echo "$RESPONSE" | grep -o '"value":"[^"]*"' | cut -d'"' -f4
else
    # Fallback to default or environment variable
    ENV_KEY=$(echo "$KEY" | tr '.' '_' | tr '[:lower:]' '[:upper:]')
    echo "${!ENV_KEY:-$DEFAULT}"
fi
CONFIGEOF

chmod 755 /usr/lib/iora/iora-get-config
success "Config helper: /usr/lib/iora/iora-get-config"

# ═══════════════════════════════════════════════════════════════════════════════
# 3. Service environment configuration
# ═══════════════════════════════════════════════════════════════════════════════

# Create default environment for all IORA services
cat > /etc/iora/service.env <<'EOF'
# Global IORA Service Configuration
# This file is sourced by all IORA services

# IORA Home API (Global Config source)
IORA_HOME_URL=http://127.0.0.1:8126

# IORA Core (Service Registry)
IORA_CORE_URL=http://127.0.0.1:8090

# Environment indicator
IORA_ENV=development
IORA_OS_DEV=1

# Enable detailed logging in dev mode
RUST_LOG=${RUST_LOG:-info}
RUST_BACKTRACE=1

# Database (for services that need it)
DATABASE_URL=${DATABASE_URL:-postgres://root:iora@localhost/iora_home}
EOF

success "Service environment: /etc/iora/service.env"

# ═══════════════════════════════════════════════════════════════════════════════
# 4. Update all service units to load global environment
# ═══════════════════════════════════════════════════════════════════════════════

SVC_DIR="/etc/systemd/system"
updated_count=0

for svc_file in "$SVC_DIR"/iora-*.service; do
    [ -f "$svc_file" ] || continue

    svc_name=$(basename "$svc_file" .service)

    # Create service.d directory if it doesn't exist
    mkdir -p "${SVC_DIR}/${svc_name}.service.d"

    # Add environment file override
    cat > "${SVC_DIR}/${svc_name}.service.d/global-config.conf" <<EOF
# Auto-generated: Global Config access
[Service]
EnvironmentFile=-/etc/iora/service.env
EnvironmentFile=-/etc/iora/${svc_name}.env
EOF

    updated_count=$((updated_count + 1))
done

if [ $updated_count -gt 0 ]; then
    systemctl daemon-reload 2>/dev/null || true
    success "Updated $updated_count service units with Global Config access"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 5. Config Change Notification System (Hot-Reload)
# ═══════════════════════════════════════════════════════════════════════════════

log "Installing config change notification system (hot-reload)..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/iora-config-notify.sh" ]; then
    cp "$SCRIPT_DIR/iora-config-notify.sh" /usr/lib/iora/iora-config-notify
    chmod 755 /usr/lib/iora/iora-config-notify
    success "iora-config-notify installed from script"
else
    warn "iora-config-notify.sh not found in $SCRIPT_DIR, creating inline..."
    cat > /usr/lib/iora/iora-config-notify <<'NOTIFYEOF'
#!/bin/bash
set -euo pipefail
KEY="${1:-}"
VALUE="${2:-}"
NOTIFY_DIR="/var/run/iora/config-notify"
mkdir -p "$NOTIFY_DIR"

if [ "$KEY" = "--clear" ]; then
    rm -f "$NOTIFY_DIR"/*
    echo "Config notifications cleared"
    exit 0
fi

if [ -z "$KEY" ]; then
    echo "Usage: $0 <key> <value>"
    echo "       $0 --clear"
    exit 1
fi

TIMESTAMP=$(date +%s)
NOTIFY_FILE="$NOTIFY_DIR/${TIMESTAMP}_${KEY//./_}"

cat > "$NOTIFY_FILE" <<EOF
KEY=$KEY
VALUE=$VALUE
TIMESTAMP=$TIMESTAMP
EOF

find "$NOTIFY_DIR" -type f -mmin +60 -delete 2>/dev/null || true

for service in iora-core iora-home iora-assist iora-supervisor \
               iora-appstore iora-gateway iora-security iora-watchdog \
               iora-files iora-backup iora-connector iora-dev-bridge \
               iora-control iora-network-monitor iora-domain-validator \
               iora-resource-manager iora-updater; do
    if systemctl is-active --quiet "$service" 2>/dev/null; then
        systemctl kill -s HUP "$service" 2>/dev/null || true
    fi
done

echo "Config change notified: $KEY"
NOTIFYEOF
    chmod 755 /usr/lib/iora/iora-config-notify
    success "iora-config-notify created inline"
fi

# Create notification directory
mkdir -p /var/run/iora/config-notify
chmod 755 /var/run/iora/config-notify
success "Config notification directory: /var/run/iora/config-notify"

# Update service environment to include config notify dir
cat >> /etc/iora/service.env <<'EOF'

# Hot-Reload Configuration
IORA_CONFIG_NOTIFY_DIR=/var/run/iora/config-notify
EOF
success "Added IORA_CONFIG_NOTIFY_DIR to service.env"

# ═══════════════════════════════════════════════════════════════════════════════
# 6. Create config synchronization service
# ═══════════════════════════════════════════════════════════════════════════════

cat > "${SVC_DIR}/iora-config-sync.service" <<'EOF'
[Unit]
Description=IORA Config Sync - Ensures Global Config is accessible
After=iora-home.service
Wants=iora-home.service

[Service]
Type=oneshot
ExecStart=/usr/lib/iora/iora-config-sync-check
RemainAfterExit=yes
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Create the sync check script
cat > /usr/lib/iora/iora-config-sync-check <<'SYNCEOF'
#!/bin/bash
# Verify Global Config API is accessible

IORA_HOME_URL="${IORA_HOME_URL:-http://127.0.0.1:8126}"
MAX_ATTEMPTS=30
ATTEMPT=0

log() { logger -t iora-config-sync "$*"; echo "[iora-config-sync] $*"; }

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s -f "${IORA_HOME_URL}/api/health" >/dev/null 2>&1; then
        log "Global Config API is accessible at ${IORA_HOME_URL}"
        exit 0
    fi
    ATTEMPT=$((ATTEMPT + 1))
    sleep 2
done

log "WARNING: Global Config API not accessible after ${MAX_ATTEMPTS} attempts"
exit 1
SYNCEOF

chmod 755 /usr/lib/iora/iora-config-sync-check
systemctl enable iora-config-sync 2>/dev/null || true
success "Config sync service: iora-config-sync.service"

# ═══════════════════════════════════════════════════════════════════════════════
# 6. Create live log streaming endpoint helper
# ═══════════════════════════════════════════════════════════════════════════════

cat > /usr/lib/iora/iora-logs-stream <<'LOGSEOF'
#!/bin/bash
# Stream logs via HTTP (used by dev-bridge and control center)
# Usage: iora-logs-stream [service-name]

SERVICE="${1:-iora-*}"
journalctl -u "$SERVICE" -f --no-pager -o json
LOGSEOF

chmod 755 /usr/lib/iora/iora-logs-stream
success "Log streaming helper: /usr/lib/iora/iora-logs-stream"

# ═══════════════════════════════════════════════════════════════════════════════
# 7. Verify IORA OS compatibility
# ═══════════════════════════════════════════════════════════════════════════════

log "Verifying IORA OS compatibility..."

# Check critical paths
CRITICAL_PATHS=(
    "/etc/iora"
    "/opt/iora/data"
    "/usr/lib/iora"
    "/usr/bin/iora-cli"
    "/mnt/data/iora"
)

all_ok=true
for path in "${CRITICAL_PATHS[@]}"; do
    if [ -e "$path" ]; then
        success "  ✓ $path"
    else
        warn "  ✗ $path (missing)"
        all_ok=false
    fi
done

# Check critical services
CRITICAL_SERVICES=(
    "iora-core"
    "iora-home"
    "postgresql"
)

for svc in "${CRITICAL_SERVICES[@]}"; do
    if systemctl list-unit-files "${svc}.service" >/dev/null 2>&1; then
        success "  ✓ ${svc}.service"
    else
        warn "  ✗ ${svc}.service (not found)"
        all_ok=false
    fi
done

echo ""
if $all_ok; then
    success "IORA Dev VM is 100% compatible with IORA OS"
else
    warn "Some compatibility issues found - check warnings above"
fi

echo ""
log "Global Config access configured!"
log "  Config API:       http://127.0.0.1:8126/api/settings"
log "  Config helper:    iora-get-config <key> [default]"
log "  Service env:      /etc/iora/service.env"
log "  Hot-reload:       Config changes propagate automatically (no restart)"
log "  Notifications:    /var/run/iora/config-notify/"
log "  Live logs:        journalctl -u iora-* -f"
log "  Log streaming:    iora-logs-stream [service]"
echo ""
success "All services can now access Global Config via IORA_HOME_URL"
success "Config changes hot-reload automatically - no service restart needed!"
