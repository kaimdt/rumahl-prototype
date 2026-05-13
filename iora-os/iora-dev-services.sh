#!/usr/bin/env bash
# ============================================================================
# iora-dev-services.sh – IORA OS Service-Äquivalente für die Dev-VM
# ============================================================================
# Erstellt systemd-Service-Units die 1:1 den IORA OS Services entsprechen.
# Teilt sich in drei Kategorien:
#   - FULL:    Voll funktionsfähig (Netzwerk, Docker, DB, Watchdog)
#   - STUB:    Platzhalter (existiert, aber no-op – für Code der sie erwartet)
#   - SKIP:    Nicht nötig in Dev (Recovery, Integrity, TPM)
#
# Usage: sudo ./iora-dev-services.sh
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()    { echo -e "${BLUE}[svc]${NC} $*"; }
success(){ echo -e "${GREEN}[svc]${NC} $*"; }
warn()   { echo -e "${YELLOW}[svc]${NC} $*"; }

[ "$(id -u)" -eq 0 ] || { echo "ERROR: Must run as root"; exit 1; }

SVC_DIR="/etc/systemd/system"
mkdir -p "$SVC_DIR" "$SVC_DIR/multi-user.target.wants" "$SVC_DIR/timers.target.wants"
mkdir -p /usr/lib/iora /var/log

# ═══════════════════════════════════════════════════════════════════════════════
# HELPER: service unit templates
# ═══════════════════════════════════════════════════════════════════════════════

# FULL service: actually does something useful
_full_service() {
    local name="$1" desc="$2" after="${3:-}" exec="${4:-/bin/true}"
    cat > "${SVC_DIR}/${name}.service" <<EOF
[Unit]
Description=${desc}
${after:+After=${after}}
${after:+Wants=${after}}

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=${exec}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
}

# STUB service: exists but does nothing (satisfies ConditionPathExists/After= deps)
_stub_service() {
    local name="$1" desc="$2"
    cat > "${SVC_DIR}/${name}.service" <<EOF
[Unit]
Description=${desc} (Dev-VM stub – IORA OS compatibility)

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/true
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
}

# iora-* app service template (matches what post-build.sh generates)
_iora_service() {
    local name="$1" port="${2:-}" after="${3:-}"
    local workdir="/opt/iora/build/${name}"
    mkdir -p "$workdir/data" 2>/dev/null || true
    cat > "${SVC_DIR}/${name}.service" <<EOF
[Unit]
Description=IORA ${name} Service
Documentation=https://iora-os.dev/services/${name}
${after:+After=${after}}
ConditionPathExists=/opt/iora/build/${name}/bin/${name}

[Service]
Type=simple
User=root
WorkingDirectory=${workdir}
ExecStart=/opt/iora/build/${name}/bin/${name}
Restart=always
RestartSec=5
${port:+Environment=PORT=${port}}
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
}

# Enable a service
_enable() { ln -sf "${SVC_DIR}/${1}.service" "${SVC_DIR}/multi-user.target.wants/${1}.service" 2>/dev/null || true; }

# ═══════════════════════════════════════════════════════════════════════════════
# 1. OS-LEVEL SERVICES – FULL
# ═══════════════════════════════════════════════════════════════════════════════

log "Creating OS-level services..."

# ── ZRAM swap ───────────────────────────────────────────────────────────
if command -v zramctl >/dev/null 2>&1; then
    cat > "${SVC_DIR}/zram.service" <<'EOF'
[Unit]
Description=ZRAM Swap (IORA OS)
DefaultDependencies=no
Before=local-fs.target

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c '\
  modprobe zram 2>/dev/null || true; \
  total_mb=$(awk "/MemTotal/{printf \"%.0f\", \$2/1024}" /proc/meminfo); \
  zram_mb=$(( total_mb / 2 )); \
  echo zstd > /sys/block/zram0/comp_algorithm 2>/dev/null || true; \
  echo ${zram_mb}M > /sys/block/zram0/disksize 2>/dev/null || true; \
  mkswap /dev/zram0 2>/dev/null || true; \
  swapon -p 100 /dev/zram0 2>/dev/null || true'
ExecStop=/sbin/swapoff /dev/zram0

[Install]
WantedBy=multi-user.target
EOF
    _enable zram
    success "zram.service (50% RAM as compressed swap)"
fi

# ── Chrony / Time Sync ───────────────────────────────────────────────────
if command -v chronyd >/dev/null 2>&1; then
    systemctl enable chrony 2>/dev/null || true
    success "chrony.service (time sync)"
else
    systemctl enable systemd-timesyncd 2>/dev/null || true
    success "systemd-timesyncd (time sync, equivalent to chrony)"
fi

# ── PostgreSQL ──────────────────────────────────────────────────────────
if command -v psql >/dev/null 2>&1; then
    systemctl enable postgresql 2>/dev/null || true
    systemctl start postgresql 2>/dev/null || true
    success "postgresql.service"
    
    # iora-db-init: Creates IORA databases
    _full_service iora-db-init "IORA Database Initialisation" "postgresql.service" \
        "/bin/sh -c 'su - postgres -c \"psql -c \\\"CREATE DATABASE iora_home OWNER iora\\\" \" 2>/dev/null || true; su - postgres -c \"psql -c \\\"CREATE DATABASE iora_core OWNER iora\\\" \" 2>/dev/null || true; su - postgres -c \"psql -c \\\"CREATE DATABASE iora_security OWNER iora\\\" \" 2>/dev/null || true; su - postgres -c \"psql -c \\\"CREATE DATABASE iora_secrets OWNER iora\\\" \" 2>/dev/null || true; su - postgres -c \"psql -c \\\"CREATE DATABASE iora_appstore OWNER iora\\\" \" 2>/dev/null || true'"
    _enable iora-db-init
    success "iora-db-init.service (creates IORA databases)"
else
    _stub_service iora-db-init "IORA DB Init (PostgreSQL not installed)"
    success "iora-db-init.service (stub – no PostgreSQL)"
fi

# ── iora-init-data ──────────────────────────────────────────────────────
_full_service iora-init-data "IORA Data Directory Init" "mnt-data.mount" \
    "/bin/sh -c 'mkdir -p /mnt/data/iora /mnt/data/rauc /mnt/data/backups && chmod 755 /mnt/data/iora /mnt/data/rauc /mnt/data/backups'"
_enable iora-init-data
success "iora-init-data.service"

# ── iora-stack (Docker user-apps) ────────────────────────────────────────
_full_service iora-stack "IORA User-Apps Docker Stack" "docker.service iora-init-data.service" \
    "/bin/sh -c 'if [ -f /mnt/data/iora/docker-compose.yml ]; then docker compose -f /mnt/data/iora/docker-compose.yml up -d --remove-orphans 2>/dev/null || true; fi'"
success "iora-stack.service (user-apps Docker compose)"

# ── iora-stack-watchdog ──────────────────────────────────────────────────
cat > "${SVC_DIR}/iora-stack-watchdog.service" <<'WATCHDOG'
[Unit]
Description=IORA Stack Watchdog (Dev VM)
After=docker.service iora-stack.service

[Service]
Type=oneshot
ExecStart=/usr/lib/iora/iora-watchdog-check
SuccessExitStatus=0 1
StandardOutput=journal
StandardError=journal
WATCHDOG

cat > "${SVC_DIR}/iora-stack-watchdog.timer" <<'WATCHDOGTIMER'
[Unit]
Description=IORA Stack Watchdog Timer

[Timer]
OnBootSec=3min
OnUnitActiveSec=2min
RandomizedDelaySec=30s

[Install]
WantedBy=timers.target
WATCHDOGTIMER
ln -sf "${SVC_DIR}/iora-stack-watchdog.timer" "${SVC_DIR}/timers.target.wants/iora-stack-watchdog.timer" 2>/dev/null || true
success "iora-stack-watchdog.timer (every 2 min)"

# ── watchdog-check script (gleiche Logik wie IORA OS) ───────────────────
cat > /usr/lib/iora/iora-watchdog-check <<'WDSH'
#!/bin/sh
LOG_TAG="iora-watchdog"
log() { logger -t "$LOG_TAG" "$*"; echo "[$(date -Iseconds)] $LOG_TAG: $*"; }

# Restart stopped native IORA services
for svc in iora-core iora-home iora-control iora-assist \
            iora-secrets iora-watchdog iora-security iora-gateway \
            iora-supervisor iora-api iora-appstore iora-backup iora-connector \
            iora-dev-bridge iora-files iora-network-monitor iora-nginx \
            iora-resource-manager iora-updater; do
    if ! systemctl is-active --quiet "${svc}.service" 2>/dev/null; then
        if systemctl is-enabled --quiet "${svc}.service" 2>/dev/null; then
            log "restarting stopped native service: ${svc}"
            systemctl start "${svc}.service" 2>/dev/null || true
        fi
    fi
done

# Restart stopped Docker user-app containers
if [ -f /mnt/data/iora/docker-compose.yml ]; then
    STOPPED=$(docker compose -f /mnt/data/iora/docker-compose.yml ps --status exited --services 2>/dev/null | wc -l)
    if [ "$STOPPED" -gt 0 ]; then
        log "restarting $STOPPED stopped user-app container(s)"
        docker compose -f /mnt/data/iora/docker-compose.yml up -d --remove-orphans 2>/dev/null || true
    fi
fi
exit 0
WDSH
chmod 755 /usr/lib/iora/iora-watchdog-check
success "iora-watchdog-check script"

# ── iora-setup ──────────────────────────────────────────────────────────
_full_service iora-setup "IORA Setup Wizard (Dev VM)" "docker.service" \
    "/bin/sh -c 'touch /mnt/data/iora/.setup-complete && echo IORA_OS_COMPAT=1 > /etc/iora/os-release'"
_enable iora-setup
success "iora-setup.service"

# ═══════════════════════════════════════════════════════════════════════════════
# 2. IORA APP SERVICES (systemd units matching IORA OS)
# ═══════════════════════════════════════════════════════════════════════════════

log "Creating IORA app service units..."

# Service-Port mapping (from devup.sh registry)
declare -A IORA_PORTS
IORA_PORTS[iora-core]=8090
IORA_PORTS[iora-home]=8126
IORA_PORTS[iora-control]=8091
IORA_PORTS[iora-assist]=8092
IORA_PORTS[iora-secrets]=8093
IORA_PORTS[iora-watchdog]=8094
IORA_PORTS[iora-security]=8095
IORA_PORTS[iora-gateway]=8096
IORA_PORTS[iora-supervisor]=8097
IORA_PORTS[iora-appstore]=8098
IORA_PORTS[iora-api]=8101
IORA_PORTS[iora-files]=8102
IORA_PORTS[iora-updater]=8103
IORA_PORTS[iora-connector]=8104
IORA_PORTS[iora-network-monitor]=8105
IORA_PORTS[iora-nginx]=8089
IORA_PORTS[iora-backup]=8100
IORA_PORTS[iora-dev-bridge]=8101
IORA_PORTS[iora-domain-validator]=8106
IORA_PORTS[iora-resource-manager]=8107

# Service dependencies
declare -A IORA_AFTER
IORA_AFTER[iora-home]="iora-core.service"
IORA_AFTER[iora-control]="iora-core.service iora-home.service"
IORA_AFTER[iora-assist]="iora-core.service"
IORA_AFTER[iora-watchdog]="iora-core.service"
IORA_AFTER[iora-security]="iora-watchdog.service"
IORA_AFTER[iora-supervisor]="iora-core.service iora-secrets.service docker.service"
IORA_AFTER[iora-appstore]="iora-core.service iora-supervisor.service"
IORA_AFTER[iora-backup]="iora-core.service"
IORA_AFTER[iora-dev-bridge]="iora-core.service iora-supervisor.service"
IORA_AFTER[iora-api]="iora-core.service iora-home.service"
IORA_AFTER[iora-stack]="docker.service iora-init-data.service"

for svc in "${!IORA_PORTS[@]}"; do
    _iora_service "$svc" "${IORA_PORTS[$svc]}" "${IORA_AFTER[$svc]:-}"
    success "  ${svc}.service (port ${IORA_PORTS[$svc]})"
done

# Create /opt/iora/build structure for each service
for svc in "${!IORA_PORTS[@]}"; do
    mkdir -p "/opt/iora/build/${svc}/bin"
done
success "/opt/iora/build/<svc>/bin/ directories created"

# ═══════════════════════════════════════════════════════════════════════════════
# 3. OS-LEVEL SERVICES – STUB (exist, but no-op in dev)
# ═══════════════════════════════════════════════════════════════════════════════

log "Creating stub services (IORA OS compatibility – no-op in Dev VM)..."

_stub_service iora-recovery          "Recovery Mode"
_stub_service iora-detect-virt       "VM Detection"
_stub_service iora-integrity         "Integrity Check"
_stub_service iora-integrity-init    "Integrity Init"
_stub_service iora-verify            "Binary Verification"
_stub_service iora-tamper-screen     "Tamper Detection"
_stub_service iora-update-check      "Update Check"
_stub_service iora-update-monitor    "Update Monitor"
_stub_service iora-recovery-log-init "Recovery Log Init"
_stub_service iora-motd              "MOTD Updater"
_stub_service iora-dhcp-conflict-guard "DHCP Conflict Guard"

# Enable the stubs that other services depend on
_enable iora-recovery-log-init
_enable iora-dhcp-conflict-guard

# Timer stubs
cat > "${SVC_DIR}/iora-update-check.timer" <<'EOF'
[Unit]
Description=IORA Update Check Timer (Dev VM stub)

[Timer]
OnBootSec=1h
OnUnitActiveSec=24h
Persistent=false

[Install]
WantedBy=timers.target
EOF

# ── data-unlock (simplified – no LUKS in dev) ──────────────────────────
cat > "${SVC_DIR}/iora-data-unlock.service" <<'EOF'
[Unit]
Description=IORA Data Partition Unlock (Dev VM – simplified, no LUKS)
DefaultDependencies=no
Before=mnt-data.mount

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'mkdir -p /mnt/data/iora && echo "Dev VM – no LUKS needed"'
SuccessExitStatus=0 1

[Install]
WantedBy=local-fs.target
EOF
_enable iora-data-unlock
success "iora-data-unlock.service (simplified, no LUKS)"

# ── mnt-data.mount (necessary for data partition deps) ──────────────────
cat > "${SVC_DIR}/mnt-data.mount" <<'EOF'
[Unit]
Description=IORA Data Partition (Dev VM)
DefaultDependencies=no
After=iora-data-unlock.service
Before=local-fs.target

[Mount]
What=tmpfs
Where=/mnt/data
Type=tmpfs
Options=defaults,size=2G

[Install]
WantedBy=local-fs.target
EOF
systemctl daemon-reload 2>/dev/null || true
systemctl enable mnt-data.mount 2>/dev/null || true
systemctl start mnt-data.mount 2>/dev/null || true
success "mnt-data.mount (tmpfs 2GB)"

# ═══════════════════════════════════════════════════════════════════════════════
# 4. SUMMARY
# ═══════════════════════════════════════════════════════════════════════════════

systemctl daemon-reload 2>/dev/null || true

echo ""
log "============================================"
log "Service Compatibility – Verification"
log "============================================"

check_svc() {
    local name="$1" type="$2"
    if [ -f "${SVC_DIR}/${name}.service" ] || [ -f "${SVC_DIR}/${name}.timer" ]; then
        success "  [${type}] ${name}"
    else
        warn "  [MISSING] ${name}"
    fi
}

# OS-level services
check_svc "systemd-networkd"      "FULL"
check_svc "docker"                "FULL"
check_svc "postgresql"            "FULL"
check_svc "zram"                  "FULL"
check_svc "chrony"                "FULL"
check_svc "iora-netctl"           "FULL"
check_svc "iora-init-data"        "FULL"
check_svc "iora-db-init"          "FULL"
check_svc "iora-stack"            "FULL"
check_svc "iora-stack-watchdog"   "FULL"
check_svc "iora-setup"            "FULL"
check_svc "iora-data-unlock"      "FULL"
check_svc "iora-recovery"         "STUB"
check_svc "iora-integrity"        "STUB"
check_svc "iora-verify"           "STUB"
check_svc "iora-update-check"     "STUB"
check_svc "iora-tamper-screen"    "STUB"

# App services
for svc in "${!IORA_PORTS[@]}"; do
    check_svc "$svc" "APP"
done

echo ""
log "Dev VM services match IORA OS:"
log "  $(ls ${SVC_DIR}/iora-*.service 2>/dev/null | wc -l) IORA service units created"
log "  FULL = fully functional | STUB = exists but no-op | APP = Rust binary unit"
echo ""
success "Service compatibility layer complete."
