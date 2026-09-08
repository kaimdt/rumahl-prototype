#!/bin/bash
# ============================================================================
# rumahl-optimize-memory.sh – Dynamic Memory Allocation for rumahl Services
# ============================================================================
# Automatically adjusts memory limits for rumahl services based on available
# system RAM to maximize performance without causing OOM conditions.
#
# Usage: sudo ./rumahl-optimize-memory.sh
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()    { echo -e "${BLUE}[memory-opt]${NC} $*"; }
success(){ echo -e "${GREEN}[memory-opt]${NC} $*"; }
warn()   { echo -e "${YELLOW}[memory-opt]${NC} $*"; }

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: Must run as root: sudo ./rumahl-optimize-memory.sh"
    exit 1
fi

SVC_DIR="/etc/systemd/system"

log "Detecting system memory..."

# Get total RAM in MB
TOTAL_RAM_MB=$(awk '/MemTotal/{printf "%.0f", $2/1024}' /proc/meminfo 2>/dev/null || echo "4096")
TOTAL_RAM_GB=$((TOTAL_RAM_MB / 1024))

log "System RAM: ${TOTAL_RAM_GB}GB (${TOTAL_RAM_MB}MB)"

# ═══════════════════════════════════════════════════════════════════════════════
# Memory Allocation Strategy
# ═══════════════════════════════════════════════════════════════════════════════
#
# Low RAM systems (≤4GB):     Conservative limits, AI gets 512MB-1GB
# Medium RAM systems (6-8GB):  Balanced limits, AI gets 1-1.5GB
# High RAM systems (≥16GB):    Generous limits, AI gets 2-3GB
#
# ═══════════════════════════════════════════════════════════════════════════════

# Default conservative values
ASSIST_MEM_HIGH="512M"
ASSIST_MEM_MAX="1G"
SUPERVISOR_MEM_MAX="512M"
APPSTORE_MEM_MAX="512M"
HOME_MEM_MAX="1G"
CORE_MEM_MAX="512M"

# Adjust based on total RAM
if [ $TOTAL_RAM_GB -ge 16 ]; then
    # High-end systems: generous limits
    ASSIST_MEM_HIGH="1G"
    ASSIST_MEM_MAX="3G"
    SUPERVISOR_MEM_MAX="1G"
    APPSTORE_MEM_MAX="1G"
    HOME_MEM_MAX="2G"
    CORE_MEM_MAX="1G"
    log "Memory profile: HIGH (16GB+ RAM)"
elif [ $TOTAL_RAM_GB -ge 8 ]; then
    # Medium systems: balanced limits
    ASSIST_MEM_HIGH="768M"
    ASSIST_MEM_MAX="1536M"
    SUPERVISOR_MEM_MAX="768M"
    APPSTORE_MEM_MAX="768M"
    HOME_MEM_MAX="1536M"
    CORE_MEM_MAX="768M"
    log "Memory profile: MEDIUM (8-16GB RAM)"
elif [ $TOTAL_RAM_GB -ge 6 ]; then
    # Low-medium systems: conservative balanced
    ASSIST_MEM_HIGH="512M"
    ASSIST_MEM_MAX="1G"
    SUPERVISOR_MEM_MAX="512M"
    APPSTORE_MEM_MAX="512M"
    HOME_MEM_MAX="1G"
    CORE_MEM_MAX="512M"
    log "Memory profile: LOW-MEDIUM (6-8GB RAM)"
else
    # Low RAM systems: very conservative
    ASSIST_MEM_HIGH="384M"
    ASSIST_MEM_MAX="768M"
    SUPERVISOR_MEM_MAX="384M"
    APPSTORE_MEM_MAX="384M"
    HOME_MEM_MAX="768M"
    CORE_MEM_MAX="384M"
    log "Memory profile: LOW (<6GB RAM)"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Apply memory limits to rumahl services
# ═══════════════════════════════════════════════════════════════════════════════

apply_memory_limit() {
    local service="$1"
    local mem_high="$2"
    local mem_max="$3"

    if [ ! -f "${SVC_DIR}/${service}.service" ]; then
        warn "Service $service does not exist, skipping"
        return
    fi

    mkdir -p "${SVC_DIR}/${service}.service.d"
    cat > "${SVC_DIR}/${service}.service.d/memory.conf" <<EOF
# Auto-generated memory limits (optimized for ${TOTAL_RAM_GB}GB system)
[Service]
MemoryHigh=${mem_high}
MemoryMax=${mem_max}
EOF
    success "  ${service}: MemoryHigh=${mem_high}, MemoryMax=${mem_max}"
}

log "Applying optimized memory limits..."

# AI service - most resource intensive
apply_memory_limit "rumahl-assist" "$ASSIST_MEM_HIGH" "$ASSIST_MEM_MAX"

# Core infrastructure services
apply_memory_limit "rumahl-home" "$HOME_MEM_MAX" "$HOME_MEM_MAX"
apply_memory_limit "rumahl-core" "$CORE_MEM_MAX" "$CORE_MEM_MAX"
apply_memory_limit "rumahl-supervisor" "$SUPERVISOR_MEM_MAX" "$SUPERVISOR_MEM_MAX"
apply_memory_limit "rumahl-appstore" "$APPSTORE_MEM_MAX" "$APPSTORE_MEM_MAX"

# Lighter services - use half of core service limits
LIGHT_MEM=$((TOTAL_RAM_MB / 32))  # ~128MB for 4GB, ~256MB for 8GB, ~512MB for 16GB
[ $LIGHT_MEM -lt 128 ] && LIGHT_MEM=128
[ $LIGHT_MEM -gt 512 ] && LIGHT_MEM=512

for service in rumahl-security rumahl-secrets rumahl-watchdog rumahl-gateway rumahl-files \
               rumahl-backup rumahl-connector rumahl-network-monitor rumahl-domain-validator \
               rumahl-resource-manager rumahl-updater rumahl-dev-bridge rumahl-control; do
    if [ -f "${SVC_DIR}/${service}.service" ]; then
        apply_memory_limit "$service" "${LIGHT_MEM}M" "$((LIGHT_MEM * 2))M"
    fi
done

# ═══════════════════════════════════════════════════════════════════════════════
# Create memory monitoring script
# ═══════════════════════════════════════════════════════════════════════════════

log "Creating memory monitoring script..."

cat > /usr/lib/ora/rumahl-memory-monitor <<'MEMMONEOF'
#!/bin/bash
# rumahl Memory Monitor - Tracks memory usage and adjusts if needed

LOG_TAG="rumahl-memory"
LOG_FILE="/var/log/ora/memory.log"

log() {
    logger -t "$LOG_TAG" "$*" 2>/dev/null || true
    echo "[$(date -Iseconds)] $LOG_TAG: $*" >> "$LOG_FILE"
}

# Get system memory info
total_mb=$(awk '/MemTotal/{printf "%.0f", $2/1024}' /proc/meminfo)
avail_mb=$(awk '/MemAvailable/{printf "%.0f", $2/1024}' /proc/meminfo)
used_mb=$((total_mb - avail_mb))
usage_pct=$((used_mb * 100 / total_mb))

log "System memory: ${used_mb}MB / ${total_mb}MB (${usage_pct}% used)"

# Check each rumahl service
for service in rumahl-assist rumahl-home rumahl-core rumahl-supervisor rumahl-appstore; do
    if systemctl is-active --quiet "$service" 2>/dev/null; then
        pid=$(systemctl show -p MainPID "$service" | cut -d= -f2)
        if [ "$pid" != "0" ] && [ -n "$pid" ]; then
            mem_kb=$(awk '/^VmRSS:/{print $2}' /proc/$pid/status 2>/dev/null || echo "0")
            mem_mb=$((mem_kb / 1024))
            log "  $service: ${mem_mb}MB RSS"
        fi
    fi
done

# Warning if memory usage is very high
if [ $usage_pct -gt 85 ]; then
    log "WARNING: High memory usage (${usage_pct}%), consider upgrading RAM or reducing services"
fi

exit 0
MEMMONEOF
chmod 755 /usr/lib/ora/rumahl-memory-monitor

# Memory monitor timer (runs every 5 minutes)
cat > "${SVC_DIR}/rumahl-memory-monitor.timer" <<'EOF'
[Unit]
Description=rumahl Memory Monitor Timer

[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
RandomizedDelaySec=30s

[Install]
WantedBy=timers.target
EOF

cat > "${SVC_DIR}/rumahl-memory-monitor.service" <<'EOF'
[Unit]
Description=rumahl Memory Monitor

[Service]
Type=oneshot
ExecStart=/usr/lib/ora/rumahl-memory-monitor
StandardOutput=journal
StandardError=journal
EOF

ln -sf "${SVC_DIR}/rumahl-memory-monitor.timer" "${SVC_DIR}/timers.target.wants/rumahl-memory-monitor.timer" 2>/dev/null || true
success "Memory monitoring timer created"

# ═══════════════════════════════════════════════════════════════════════════════
# ZRAM - production parity (rumahl OS uses compressed swap at 50% of RAM)
# ═══════════════════════════════════════════════════════════════════════════════
log "Configuring ZRAM (50% RAM, zstd)..."
if ! command -v zramctl >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -qq --no-install-recommends zram-tools 2>&1 | tail -1 || true
fi
if [ -f /etc/default/zramswap ]; then
    grep -q '^ALGO='    /etc/default/zramswap && sed -i 's/^ALGO=.*/ALGO=zstd/'  /etc/default/zramswap || echo 'ALGO=zstd'    >> /etc/default/zramswap
    grep -q '^PERCENT=' /etc/default/zramswap && sed -i 's/^PERCENT=.*/PERCENT=50/' /etc/default/zramswap || echo 'PERCENT=50' >> /etc/default/zramswap
    systemctl enable zramswap 2>/dev/null || true
    systemctl restart zramswap 2>/dev/null || true
    if systemctl is-active --quiet zramswap; then
        zram_info=$(zramctl --raw --output ALGORITHM,DISKSIZE --noheadings 2>/dev/null | head -1)
        success "ZRAM active: ${zram_info:-unknown} (production parity: 50% RAM)"
    else
        warn "zramswap did not start - check: journalctl -u zramswap"
    fi
else
    warn "zram-tools not available - skipping ZRAM"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# Reload systemd
# ═══════════════════════════════════════════════════════════════════════════════

systemctl daemon-reload 2>/dev/null || true

echo ""
log "Memory optimization complete!"
log "  Total RAM: ${TOTAL_RAM_GB}GB"
log "  AI (rumahl-assist): max ${ASSIST_MEM_MAX}"
log "  Core services: max ${HOME_MEM_MAX}"
log "  Light services: max $((LIGHT_MEM * 2))MB each"
echo ""
log "Changes will take effect when services are restarted."
log "To apply now: systemctl restart rumahl-*.service"
echo ""
success "Memory limits optimized for ${TOTAL_RAM_GB}GB system"
