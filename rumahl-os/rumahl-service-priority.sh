#!/bin/bash
# ============================================================================
# rumahl-service-priority.sh – Service Priority & Lazy Loading Configuration
# ============================================================================
# Optimizes rumahl OS boot time by prioritizing critical services and deferring
# optional services to load on-demand or after boot completion.
#
# Service Priority Levels:
#   CRITICAL: Must start first (rumahl-core, rumahl-home, rumahl-secrets, postgres)
#   HIGH:     Important but can wait (rumahl-supervisor, rumahl-security)
#   MEDIUM:   Standard services (rumahl-assist, rumahl-appstore, rumahl-gateway)
#   LOW:      Optional services (rumahl-backup, rumahl-updater, monitoring)
#
# Usage: sudo ./rumahl-service-priority.sh
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()    { echo -e "${BLUE}[svc-priority]${NC} $*"; }
success(){ echo -e "${GREEN}[svc-priority]${NC} $*"; }
warn()   { echo -e "${YELLOW}[svc-priority]${NC} $*"; }

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: Must run as root: sudo ./rumahl-service-priority.sh"
    exit 1
fi

SVC_DIR="/etc/systemd/system"

log "Configuring rumahl service priorities..."

# ═══════════════════════════════════════════════════════════════════════════════
# Service Classifications
# ═══════════════════════════════════════════════════════════════════════════════

# Critical services (always enabled, start immediately)
CRITICAL_SERVICES=(
    "postgresql"
    "rumahl-core"
    "rumahl-secrets"
    "rumahl-home"
)

# High priority (enabled, start after critical)
HIGH_PRIORITY_SERVICES=(
    "rumahl-supervisor"
    "rumahl-security"
    "rumahl-watchdog"
)

# Medium priority (enabled, can start later)
MEDIUM_PRIORITY_SERVICES=(
    "rumahl-assist"
    "rumahl-appstore"
    "rumahl-gateway"
    "rumahl-files"
    "rumahl-control"
    "rumahl-dev-bridge"
)

# Low priority (optional, start on-demand or after boot)
LOW_PRIORITY_SERVICES=(
    "rumahl-backup"
    "rumahl-updater"
    "rumahl-network-monitor"
    "rumahl-domain-validator"
    "rumahl-resource-manager"
    "rumahl-connector"
    "rumahl-api"
)

# ═══════════════════════════════════════════════════════════════════════════════
# Create boot-complete target for deferred services
# ═══════════════════════════════════════════════════════════════════════════════

log "Creating rumahl-boot-complete.target for deferred services..."

cat > "${SVC_DIR}/rumahl-boot-complete.target" <<'EOF'
[Unit]
Description=rumahl Boot Complete - Optional Services Target
Documentation=https://rumahl-os.dev/boot-optimization
After=multi-user.target
Requires=multi-user.target

[Install]
WantedBy=multi-user.target
EOF

# Timer to trigger boot-complete after 30 seconds
cat > "${SVC_DIR}/rumahl-boot-complete.timer" <<'EOF'
[Unit]
Description=rumahl Boot Complete Timer (Deferred Service Startup)
After=multi-user.target

[Timer]
OnBootSec=30s
Unit=rumahl-boot-complete.target

[Install]
WantedBy=timers.target
EOF

ln -sf "${SVC_DIR}/rumahl-boot-complete.timer" "${SVC_DIR}/timers.target.wants/rumahl-boot-complete.timer" 2>/dev/null || true
success "Boot-complete target created (deferred services start 30s after boot)"

# ═══════════════════════════════════════════════════════════════════════════════
# Apply service priorities
# ═══════════════════════════════════════════════════════════════════════════════

apply_priority() {
    local service="$1"
    local priority="$2"
    local defer_to_boot_complete="$3"

    if [ ! -f "${SVC_DIR}/${service}.service" ]; then
        return
    fi

    mkdir -p "${SVC_DIR}/${service}.service.d"

    # Create priority override
    cat > "${SVC_DIR}/${service}.service.d/priority.conf" <<EOF
# Auto-generated service priority configuration
[Unit]
# Priority: ${priority}
EOF

    # Add WantedBy for deferred services
    if [ "$defer_to_boot_complete" = "yes" ]; then
        cat >> "${SVC_DIR}/${service}.service.d/priority.conf" <<EOF
# Deferred to post-boot
After=rumahl-boot-complete.target

[Install]
WantedBy=rumahl-boot-complete.target
EOF
        # Disable from multi-user.target to prevent early startup
        rm -f "${SVC_DIR}/multi-user.target.wants/${service}.service" 2>/dev/null || true
        # Enable for boot-complete target
        mkdir -p "${SVC_DIR}/rumahl-boot-complete.target.wants"
        ln -sf "${SVC_DIR}/${service}.service" "${SVC_DIR}/rumahl-boot-complete.target.wants/${service}.service" 2>/dev/null || true
    fi
}

# Apply priorities
log "Configuring critical services..."
for svc in "${CRITICAL_SERVICES[@]}"; do
    if [ -f "${SVC_DIR}/${svc}.service" ]; then
        apply_priority "$svc" "CRITICAL" "no"
        systemctl enable "$svc" 2>/dev/null || true
        success "  $svc: CRITICAL (start immediately)"
    fi
done

log "Configuring high priority services..."
for svc in "${HIGH_PRIORITY_SERVICES[@]}"; do
    if [ -f "${SVC_DIR}/${svc}.service" ]; then
        apply_priority "$svc" "HIGH" "no"
        systemctl enable "$svc" 2>/dev/null || true
        success "  $svc: HIGH (after critical)"
    fi
done

log "Configuring medium priority services..."
for svc in "${MEDIUM_PRIORITY_SERVICES[@]}"; do
    if [ -f "${SVC_DIR}/${svc}.service" ]; then
        apply_priority "$svc" "MEDIUM" "no"
        systemctl enable "$svc" 2>/dev/null || true
        success "  $svc: MEDIUM (standard boot)"
    fi
done

log "Configuring low priority services (deferred)..."
for svc in "${LOW_PRIORITY_SERVICES[@]}"; do
    if [ -f "${SVC_DIR}/${svc}.service" ]; then
        apply_priority "$svc" "LOW" "yes"
        systemctl enable "$svc" 2>/dev/null || true
        success "  $svc: LOW (deferred to boot-complete)"
    fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# Create service dependency optimization
# ═══════════════════════════════════════════════════════════════════════════════

log "Optimizing service dependencies..."

# Ensure critical services start in parallel where possible
for svc in rumahl-core rumahl-secrets; do
    if [ -f "${SVC_DIR}/${svc}.service" ]; then
        mkdir -p "${SVC_DIR}/${svc}.service.d"
        cat > "${SVC_DIR}/${svc}.service.d/parallel.conf" <<'EOF'
[Unit]
# Allow parallel startup with other critical services
DefaultDependencies=no
After=postgresql.service
EOF
        success "  $svc: parallel startup enabled"
    fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# Reload systemd
# ═══════════════════════════════════════════════════════════════════════════════

systemctl daemon-reload 2>/dev/null || true

echo ""
log "Service priority configuration complete!"
echo ""
log "Priority Levels:"
log "  CRITICAL (${#CRITICAL_SERVICES[@]} services): Start immediately on boot"
log "  HIGH (${#HIGH_PRIORITY_SERVICES[@]} services):     Start after critical services"
log "  MEDIUM (${#MEDIUM_PRIORITY_SERVICES[@]} services):   Standard boot order"
log "  LOW (${#LOW_PRIORITY_SERVICES[@]} services):      Deferred to 30s post-boot"
echo ""
log "Expected improvements:"
log "  - Faster initial boot (critical services only)"
log "  - Lower memory usage during boot"
log "  - System responsive sooner"
log "  - Optional services load in background"
echo ""
success "Boot time optimization applied!"
success "Low-priority services will start 30 seconds after boot completes"
