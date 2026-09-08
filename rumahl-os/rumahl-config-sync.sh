#!/usr/bin/env bash
# ============================================================================
# rumahl-config-sync.sh – Global Config Synchronization Helper
# ============================================================================
# Ensures newly built services can properly access the Global Config.
# This script:
# 1. Verifies /etc/ora/os-dev-mode marker exists
# 2. Ensures all services have access to Global Config API
# 3. Sets up environment for config access
#
# Usage: sudo ./rumahl-config-sync.sh
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()    { echo -e "${BLUE}[config-sync]${NC} $*"; }
success(){ echo -e "${GREEN}[config-sync]${NC} $*"; }
warn()   { echo -e "${YELLOW}[config-sync]${NC} $*"; }

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: Must run as root: sudo ./rumahl-config-sync.sh"
    exit 1
fi

log "Synchronizing Global Config access..."
log "JWT synchronization revision: 3 (self-healing canonical secret)"

# ═══════════════════════════════════════════════════════════════════════════════
# 1. Ensure rumahl OS environment markers exist
# ═══════════════════════════════════════════════════════════════════════════════

mkdir -p /etc/ora

# Dev mode marker (tells services they're in dev environment)
if [ ! -f /etc/ora/os-dev-mode ]; then
    touch /etc/ora/os-dev-mode
    success "Created /etc/ora/os-dev-mode marker"
fi

# Create rumahl OS release info (for compatibility checks)
cat > /etc/ora/os-release <<'EOF'
RUMAHL_OS_COMPAT=1
RUMAHL_OS_VERSION=dev
RUMAHL_OS_BUILD=devvm
RUMAHL_OS_VARIANT=development
EOF
success "rumahl OS release info: /etc/ora/os-release"

# ═══════════════════════════════════════════════════════════════════════════════
# 2. Global Config API access configuration
# ═══════════════════════════════════════════════════════════════════════════════

# Create global config access helper script
cat > /usr/lib/ora/rumahl-get-config <<'CONFIGEOF'
#!/bin/bash
# Helper to fetch config from Global Config API
# Usage: rumahl-get-config <key> [default]

KEY="$1"
DEFAULT="${2:-}"

# Try to fetch from rumahl-home settings API
RUMAHL_HOME_URL="${RUMAHL_HOME_URL:-http://127.0.0.1:8126}"

# Use curl to fetch the setting
RESPONSE=$(curl -s -f "${RUMAHL_HOME_URL}/api/settings/${KEY}" 2>/dev/null || echo "")

if [ -n "$RESPONSE" ]; then
    # Extract value from JSON response
    echo "$RESPONSE" | grep -o '"value":"[^"]*"' | cut -d'"' -f4
else
    # Fallback to default or environment variable
    ENV_KEY=$(echo "$KEY" | tr '.' '_' | tr '[:lower:]' '[:upper:]')
    echo "${!ENV_KEY:-$DEFAULT}"
fi
CONFIGEOF

chmod 755 /usr/lib/ora/rumahl-get-config
success "Config helper: /usr/lib/ora/rumahl-get-config"

# ═══════════════════════════════════════════════════════════════════════════════
# 3. Service environment configuration
# ═══════════════════════════════════════════════════════════════════════════════

# Preserve the previous shared value before service.env is regenerated. This
# is an important recovery source when PostgreSQL is temporarily unavailable
# or an older image has not persisted jwt_secret yet.
PREVIOUS_ENV_SECRET=$(sed -n 's/^RUMAHL_JWT_SECRET=//p' /etc/ora/service.env 2>/dev/null | tail -1 || true)

# Create default environment for all rumahl services
cat > /etc/ora/service.env <<'EOF'
# Global rumahl Service Configuration
# This file is sourced by all rumahl services

# rumahl Home API (Global Config source)
RUMAHL_HOME_URL=http://127.0.0.1:8126

# rumahl Core (Service Registry)
RUMAHL_CORE_URL=http://127.0.0.1:8090

# Environment indicator
RUMAHL_ENV=development
RUMAHL_OS_DEV=1

# Enable detailed logging in dev mode (concrete value – systemd does NOT
# expand ${...} substitutions in EnvironmentFile, the literal string would
# break every service that reads RUST_LOG).
RUST_LOG=info
RUST_BACKTRACE=1
EOF

success "Service environment: /etc/ora/service.env"

# ── JWT secret distribution ──────────────────────────────────────────────
# rumahl-home persists a JWT secret in the system_preferences table (and uses
# it to sign login tokens). Microservices that validate those tokens
# (rumahl-control, rumahl-files, rumahl-api, ...) must use the SAME secret, but
# their process-local settings cache is empty. Without a shared value they
# fall back to a random per-process UUID and every proxied request ends in
# 401. Publish the DB secret into the global service.env (this script runs
# as root AFTER rumahl-home, see rumahl-config-sync.service) so all services
# resolve the same RUMAHL_JWT_SECRET.
normalize_secret() {
    printf '%s' "${1:-}" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//"
}

DB_SECRET=$(su - postgres -c "psql -d rumahl_home -tAc \"SELECT preference_value FROM system_preferences WHERE preference_key='jwt_secret'\"" 2>/dev/null || true)
DB_SECRET=$(normalize_secret "$DB_SECRET")
FILE_SECRET=$(normalize_secret "$(cat /etc/ora/jwt-secret 2>/dev/null || true)")
FALLBACK_FILE_SECRET=$(normalize_secret "$(cat /var/lib/ora/jwt-secret 2>/dev/null || true)")
PREVIOUS_ENV_SECRET=$(normalize_secret "$PREVIOUS_ENV_SECRET")

JWT_SECRET_SOURCE="database"
JWT_SECRET="$DB_SECRET"
if [ "${#JWT_SECRET}" -lt 32 ]; then
    JWT_SECRET_SOURCE="canonical file"
    JWT_SECRET="$FILE_SECRET"
fi
if [ "${#JWT_SECRET}" -lt 32 ]; then
    JWT_SECRET_SOURCE="fallback file"
    JWT_SECRET="$FALLBACK_FILE_SECRET"
fi
if [ "${#JWT_SECRET}" -lt 32 ]; then
    JWT_SECRET_SOURCE="previous service environment"
    JWT_SECRET="$PREVIOUS_ENV_SECRET"
fi
if [ "${#JWT_SECRET}" -lt 32 ]; then
    JWT_SECRET_SOURCE="new cryptographic value"
    JWT_SECRET=$(openssl rand -base64 64 | tr -d '\r\n')
fi
if [ "${#JWT_SECRET}" -lt 32 ]; then
    echo "ERROR: Unable to establish a JWT secret of at least 32 characters" >&2
    exit 1
fi

echo "RUMAHL_JWT_SECRET=$JWT_SECRET" >> /etc/ora/service.env
success "Published shared JWT secret from $JWT_SECRET_SOURCE (${#JWT_SECRET} chars)"

# Repair a missing or malformed database preference whenever PostgreSQL is
# reachable. The JSON string representation is required by rumahl-home's
# SystemPreference model.
if [ "$DB_SECRET" != "$JWT_SECRET" ]; then
    JWT_ROW_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || openssl rand -hex 16)
    if runuser -u postgres -- psql -d rumahl_home -v ON_ERROR_STOP=1 \
        --set=row_id="$JWT_ROW_ID" --set=jwt_secret="$JWT_SECRET" >/dev/null 2>&1 <<'SQLEOF'
INSERT INTO system_preferences (id, preference_key, preference_value, created_at, updated_at)
VALUES (:'row_id', 'jwt_secret', to_json(:'jwt_secret'::text)::text, NOW(), NOW())
ON CONFLICT (preference_key) DO UPDATE
SET preference_value = EXCLUDED.preference_value, updated_at = NOW();
SQLEOF
    then
        success "Persisted shared JWT secret to system_preferences"
    else
        warn "Could not persist JWT secret to PostgreSQL; file and environment recovery remain active"
    fi
fi

# Materialize the canonical cross-service secret file on every sync, even if
# service.env was already current. rumahl-home runs unprivileged and therefore
# cannot reliably create /etc/ora/jwt-secret itself on hardened images.
if [ -n "$JWT_SECRET" ] && [ "${#JWT_SECRET}" -ge 32 ]; then
    install -d -m 0750 /etc/ora
    JWT_SECRET_TMP=$(mktemp /etc/ora/.jwt-secret.XXXXXX)
    printf '%s' "$JWT_SECRET" > "$JWT_SECRET_TMP"
    if getent group ora >/dev/null 2>&1; then
        chown root:ora "$JWT_SECRET_TMP"
        chmod 0640 "$JWT_SECRET_TMP"
    else
        # Development images may run services under the invoking user and not
        # create the ora group. Keep the canonical file readable there.
        chown root:root "$JWT_SECRET_TMP"
        chmod 0644 "$JWT_SECRET_TMP"
    fi
    mv -f "$JWT_SECRET_TMP" /etc/ora/jwt-secret
    if [ ! -s /etc/ora/jwt-secret ]; then
        echo "ERROR: canonical JWT secret was not created" >&2
        exit 1
    fi
    success "Synchronized canonical JWT secret: /etc/ora/jwt-secret"
fi

# Keep a root-owned executable copy so Dev Manager recovery does not depend on
# the checkout path or executable bit remaining available inside the guest.
if [ "$(readlink -f "$0")" != "/usr/lib/ora/rumahl-config-sync" ]; then
    install -m 0755 "$0" /usr/lib/ora/rumahl-config-sync
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 4. Update all service units to load global environment
# ═══════════════════════════════════════════════════════════════════════════════

SVC_DIR="/etc/systemd/system"
updated_count=0

for svc_file in "$SVC_DIR"/rumahl-*.service; do
    [ -f "$svc_file" ] || continue

    svc_name=$(basename "$svc_file" .service)

    # Create service.d directory if it doesn't exist
    mkdir -p "${SVC_DIR}/${svc_name}.service.d"

    # Add environment file override
    cat > "${SVC_DIR}/${svc_name}.service.d/global-config.conf" <<EOF
# Auto-generated: Global Config access
[Service]
EnvironmentFile=-/etc/ora/service.env
EnvironmentFile=-/etc/ora/${svc_name}.env
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
if [ -f "$SCRIPT_DIR/rumahl-config-notify.sh" ]; then
    cp "$SCRIPT_DIR/rumahl-config-notify.sh" /usr/lib/ora/rumahl-config-notify
    chmod 755 /usr/lib/ora/rumahl-config-notify
    success "rumahl-config-notify installed from script"
else
    warn "rumahl-config-notify.sh not found in $SCRIPT_DIR, creating inline..."
    cat > /usr/lib/ora/rumahl-config-notify <<'NOTIFYEOF'
#!/bin/bash
set -euo pipefail
KEY="${1:-}"
VALUE="${2:-}"
NOTIFY_DIR="/var/run/ora/config-notify"
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

for service in rumahl-core rumahl-home rumahl-assist rumahl-supervisor \
               rumahl-appstore rumahl-gateway rumahl-security rumahl-watchdog \
               rumahl-files rumahl-backup rumahl-connector rumahl-dev-bridge \
               rumahl-control rumahl-network-monitor rumahl-domain-validator \
               rumahl-resource-manager rumahl-updater; do
    if systemctl is-active --quiet "$service" 2>/dev/null; then
        systemctl kill -s HUP "$service" 2>/dev/null || true
    fi
done

echo "Config change notified: $KEY"
NOTIFYEOF
    chmod 755 /usr/lib/ora/rumahl-config-notify
    success "rumahl-config-notify created inline"
fi

# Create notification directory
mkdir -p /var/run/ora/config-notify
chmod 755 /var/run/ora/config-notify
success "Config notification directory: /var/run/ora/config-notify"

# Update service environment to include config notify dir
cat >> /etc/ora/service.env <<'EOF'

# Hot-Reload Configuration
RUMAHL_CONFIG_NOTIFY_DIR=/var/run/ora/config-notify
EOF
success "Added RUMAHL_CONFIG_NOTIFY_DIR to service.env"

# ═══════════════════════════════════════════════════════════════════════════════
# 6. Create config synchronization service
# ═══════════════════════════════════════════════════════════════════════════════

cat > "${SVC_DIR}/rumahl-config-sync.service" <<'EOF'
[Unit]
Description=rumahl Config Sync - Ensures Global Config is accessible
After=rumahl-home.service
Wants=rumahl-home.service

[Service]
Type=oneshot
ExecStart=/usr/lib/ora/rumahl-config-sync-check
RemainAfterExit=yes
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

# Create the sync check script
cat > /usr/lib/ora/rumahl-config-sync-check <<'SYNCEOF'
#!/bin/bash
# Verify Global Config API is accessible

RUMAHL_HOME_URL="${RUMAHL_HOME_URL:-http://127.0.0.1:8126}"
MAX_ATTEMPTS=30
ATTEMPT=0

log() { logger -t rumahl-config-sync "$*"; echo "[rumahl-config-sync] $*"; }

while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    if curl -s -f "${RUMAHL_HOME_URL}/api/health" >/dev/null 2>&1; then
        log "Global Config API is accessible at ${RUMAHL_HOME_URL}"
        exit 0
    fi
    ATTEMPT=$((ATTEMPT + 1))
    sleep 2
done

log "WARNING: Global Config API not accessible after ${MAX_ATTEMPTS} attempts"
exit 1
SYNCEOF

chmod 755 /usr/lib/ora/rumahl-config-sync-check
systemctl enable rumahl-config-sync 2>/dev/null || true
success "Config sync service: rumahl-config-sync.service"

# ═══════════════════════════════════════════════════════════════════════════════
# 6. Create live log streaming endpoint helper
# ═══════════════════════════════════════════════════════════════════════════════

cat > /usr/lib/ora/rumahl-logs-stream <<'LOGSEOF'
#!/bin/bash
# Stream logs via HTTP (used by dev-bridge and control center)
# Usage: rumahl-logs-stream [service-name]

SERVICE="${1:-rumahl-*}"
journalctl -u "$SERVICE" -f --no-pager -o json
LOGSEOF

chmod 755 /usr/lib/ora/rumahl-logs-stream
success "Log streaming helper: /usr/lib/ora/rumahl-logs-stream"

# ═══════════════════════════════════════════════════════════════════════════════
# 7. Verify rumahl OS compatibility
# ═══════════════════════════════════════════════════════════════════════════════

log "Verifying rumahl OS compatibility..."

# Check critical paths
CRITICAL_PATHS=(
    "/etc/ora"
    "/etc/ora/jwt-secret"
    "/opt/rumahl/data"
    "/usr/lib/ora"
    "/usr/bin/rumahl-cli"
    "/mnt/data/ora"
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
    "rumahl-core"
    "rumahl-home"
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
    success "rumahl Dev VM is 100% compatible with rumahl OS"
else
    warn "Some compatibility issues found - check warnings above"
fi

echo ""
log "Global Config access configured!"
log "  Config API:       http://127.0.0.1:8126/api/settings"
log "  Config helper:    rumahl-get-config <key> [default]"
log "  Service env:      /etc/ora/service.env"
log "  Hot-reload:       Config changes propagate automatically (no restart)"
log "  Notifications:    /var/run/ora/config-notify/"
log "  Live logs:        journalctl -u rumahl-* -f"
log "  Log streaming:    rumahl-logs-stream [service]"
echo ""
success "All services can now access Global Config via RUMAHL_HOME_URL"
success "Config changes hot-reload automatically - no service restart needed!"
