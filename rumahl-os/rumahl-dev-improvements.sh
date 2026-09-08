#!/bin/bash
# rumahl Dev VM Improvements Script
# Dieses Skript fügt fehlende Features hinzu, damit die Dev VM 1:1 mit rumahl OS übereinstimmt

set -e

SVC_DIR="/etc/systemd/system"

log() { echo "[rumahl-Dev-Improve] $*"; }

# ═══════════════════════════════════════════════════════════════════════════════
# 1. rumahl-detect-virt - Virtualisierungs-Erkennung
# ═══════════════════════════════════════════════════════════════════════════════
if [ ! -f /usr/bin/rumahl-detect-virt ]; then
    log "Installing rumahl-detect-virt..."
    cat > /usr/bin/rumahl-detect-virt <<'EOF'
#!/bin/sh
# rumahl OS virtualization/container detector

set -e

VIRT_TYPE="none"
VIRT_VENDOR=""
VIRT_CONTAINER="none"
VIRT_LABEL="Bare metal"

if command -v systemd-detect-virt >/dev/null 2>&1; then
    _vm=$(systemd-detect-virt --vm 2>/dev/null || true)
    _ct=$(systemd-detect-virt --container 2>/dev/null || true)
    [ -n "$_vm" ] && [ "$_vm" != "none" ] && VIRT_TYPE="$_vm"
    [ -n "$_ct" ] && [ "$_ct" != "none" ] && VIRT_CONTAINER="$_ct"
fi

sys_vendor=""; product=""
[ -r /sys/class/dmi/id/sys_vendor ] && sys_vendor=$(tr -d '\0' < /sys/class/dmi/id/sys_vendor 2>/dev/null)
[ -r /sys/class/dmi/id/product_name ] && product=$(tr -d '\0' < /sys/class/dmi/id/product_name 2>/dev/null)

if [ "$VIRT_TYPE" = "none" ]; then
    case "${sys_vendor} ${product}" in
        *VMware*) VIRT_TYPE="vmware" ;;
        *VirtualBox*|*innotek*) VIRT_TYPE="oracle" ;;
        *QEMU*) VIRT_TYPE="qemu" ;;
        *Xen*) VIRT_TYPE="xen" ;;
        *Microsoft*|*Hyper-V*) VIRT_TYPE="microsoft" ;;
    esac
    if [ "$VIRT_TYPE" = "none" ] && grep -qa '^flags.*\bhypervisor\b' /proc/cpuinfo 2>/dev/null; then
        VIRT_TYPE="kvm"
    fi
fi

case "$VIRT_TYPE" in
    vmware) VIRT_VENDOR="VMware" ;;
    oracle) VIRT_VENDOR="Oracle VirtualBox" ;;
    qemu) VIRT_VENDOR="QEMU/KVM" ;;
    kvm) VIRT_VENDOR="KVM" ;;
    microsoft) VIRT_VENDOR="Microsoft Hyper-V" ;;
    xen) VIRT_VENDOR="Xen" ;;
    *) VIRT_VENDOR="Unknown/Bare metal" ;;
esac

mkdir -p /etc/ora /etc/issue.d /etc/motd.d 2>/dev/null || true

# Write environment file
cat > /run/rumahl-virt.env <<ENVEOF
VIRT_TYPE=${VIRT_TYPE}
VIRT_VENDOR=${VIRT_VENDOR}
VIRT_CONTAINER=${VIRT_CONTAINER}
ENVEOF

# Write config file
cat > /etc/rumahl-virt.conf <<CONFEOF
Virtualization: ${VIRT_TYPE}
Vendor: ${VIRT_VENDOR}
Container: ${VIRT_CONTAINER}
CONFEOF

# Update issue/motd
echo "rumahl OS Dev VM (${VIRT_VENDOR})" > /etc/issue.d/10-rumahl-virt.issue
if [ -d /etc/motd.d ]; then
    echo "rumahl OS Dev VM (${VIRT_VENDOR})" > /etc/motd.d/10-rumahl-virt
fi

exit 0
EOF
    chmod 755 /usr/bin/rumahl-detect-virt
    
    # Create systemd service
    cat > "${SVC_DIR}/rumahl-detect-virt.service" <<EOF
[Unit]
Description=rumahl Virtualization Detection
DefaultDependencies=no
Before=systemd-user-sessions.service

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/bin/rumahl-detect-virt
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    ln -sf "${SVC_DIR}/rumahl-detect-virt.service" "${SVC_DIR}/multi-user.target.wants/rumahl-detect-virt.service" 2>/dev/null || true
    log "rumahl-detect-virt installed"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 2. PostgreSQL Performance Tuning + Hardening
# ═══════════════════════════════════════════════════════════════════════════════
log "Configuring PostgreSQL service defaults..."
mkdir -p /etc/systemd/system/postgresql.service.d
if [ -f /etc/systemd/system/postgresql.service.d/20-rumahl-init.conf ] && \
   grep -Eq '/usr/bin/pg_ctl|/var/lib/pgsql' /etc/systemd/system/postgresql.service.d/20-rumahl-init.conf; then
    rm -f /etc/systemd/system/postgresql.service.d/20-rumahl-init.conf
fi
cat > /etc/systemd/system/postgresql.service.d/20-rumahl-env.conf <<EOF
[Service]
Environment=LANG=C LC_ALL=C
TimeoutStartSec=120
EOF
systemctl daemon-reload 2>/dev/null || true
log "PostgreSQL service defaults configured"

# PostgreSQL performance tuning configuration
if command -v psql >/dev/null 2>&1; then
    log "Applying PostgreSQL performance tuning..."

    # Calculate optimal settings based on available RAM
    TOTAL_RAM_MB=$(awk '/MemTotal/{printf "%.0f", $2/1024}' /proc/meminfo 2>/dev/null || echo "4096")
    SHARED_BUFFERS=$((TOTAL_RAM_MB / 4))   # 25% of RAM
    EFFECTIVE_CACHE=$((TOTAL_RAM_MB / 2))  # 50% of RAM
    WORK_MEM=$((TOTAL_RAM_MB / 64))        # RAM / 64 per connection
    MAINTENANCE_WORK_MEM=$((TOTAL_RAM_MB / 16))  # RAM / 16

    # Cap values for sanity
    [ $SHARED_BUFFERS -gt 2048 ] && SHARED_BUFFERS=2048
    [ $WORK_MEM -lt 4 ] && WORK_MEM=4
    [ $WORK_MEM -gt 64 ] && WORK_MEM=64
    [ $MAINTENANCE_WORK_MEM -lt 64 ] && MAINTENANCE_WORK_MEM=64
    [ $MAINTENANCE_WORK_MEM -gt 512 ] && MAINTENANCE_WORK_MEM=512

    tuned_any=0
    for cluster_conf in /etc/postgresql/*/*/postgresql.conf; do
        [ -f "$cluster_conf" ] || continue
        conf_dir="$(dirname "$cluster_conf")/conf.d"
        mkdir -p "$conf_dir"
        cat > "$conf_dir/99-rumahl-performance.conf" <<EOF
# rumahl OS PostgreSQL Performance Tuning
# Auto-generated based on ${TOTAL_RAM_MB}MB system RAM

# Memory Settings
shared_buffers = ${SHARED_BUFFERS}MB
effective_cache_size = ${EFFECTIVE_CACHE}MB
work_mem = ${WORK_MEM}MB
maintenance_work_mem = ${MAINTENANCE_WORK_MEM}MB

# Connection Settings
max_connections = 100
superuser_reserved_connections = 3

# Write Performance
wal_buffers = 16MB
checkpoint_completion_target = 0.9
checkpoint_timeout = 15min
max_wal_size = 1GB
min_wal_size = 256MB

# Query Planning
random_page_cost = 1.1
effective_io_concurrency = 200
default_statistics_target = 100

# Logging (minimal for performance)
log_destination = 'stderr'
logging_collector = on
log_directory = '/var/log/postgresql'
log_filename = 'postgresql-%a.log'
log_truncate_on_rotation = on
log_rotation_age = 1d
log_rotation_size = 0
log_min_duration_statement = 1000
log_line_prefix = '%t [%p] %u@%d '
log_autovacuum_min_duration = 0

# Autovacuum
autovacuum = on
autovacuum_max_workers = 3
autovacuum_naptime = 1min

# Lock Management
deadlock_timeout = 1s

# Performance
synchronous_commit = off  # Dev mode - faster writes
fsync = on                # Keep fsync for data safety

# Client Connection
listen_addresses = 'localhost'
unix_socket_directories = '/var/run/postgresql'
EOF

        if ! grep -q "^[[:space:]]*include_dir[[:space:]]*=[[:space:]]*'conf.d'" "$cluster_conf" 2>/dev/null; then
            echo "include_dir = 'conf.d'" >> "$cluster_conf" 2>/dev/null || true
        fi
        tuned_any=1
    done

    if [ "$tuned_any" -eq 1 ]; then
        systemctl reload postgresql 2>/dev/null || systemctl restart postgresql 2>/dev/null || true
    fi

    log "PostgreSQL performance tuning configured (${SHARED_BUFFERS}MB shared_buffers, ${WORK_MEM}MB work_mem)"
else
    log "PostgreSQL not installed or data dir missing, skipping performance tuning"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 3. Chrony Configuration
# ═══════════════════════════════════════════════════════════════════════════════
if [ -f /etc/chrony.conf ] || [ ! -f /usr/sbin/chronyd ]; then
    log "Chrony configuration already exists or chrony not installed"
else
    log "Configuring chrony..."
    cat > /etc/chrony.conf <<EOF
# rumahl OS defaults
pool 2.pool.ntp.org iburst maxsources 4
pool time.cloudflare.com iburst maxsources 2

makestep 1.0 3
rtcsync
driftfile /var/lib/chrony/drift
logdir /var/log/chrony
allow 127.0.0.1/32
allow ::1/128
EOF
    mkdir -p /etc/systemd/system/chrony.service.d
    cat > /etc/systemd/system/chrony.service.d/20-rumahl-init.conf <<EOF
[Service]
ExecStartPre=+/bin/sh -c 'mkdir -p /var/lib/chrony /var/log/chrony /run/chrony && chown -R chrony:chrony /var/lib/chrony /var/log/chrony /run/chrony 2>/dev/null || true && chmod 0750 /var/lib/chrony /var/log/chrony && touch /var/lib/chrony/drift && chown chrony:chrony /var/lib/chrony/drift 2>/dev/null || true'
Restart=on-failure
RestartSec=10
TimeoutStartSec=60
EOF
    systemctl daemon-reload 2>/dev/null || true
    log "Chrony configured"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 4. rumahl-db-init Verbesserung - pg_hba.conf Härtung
# ═══════════════════════════════════════════════════════════════════════════════
log "Checking rumahl-db-init configuration..."
if command -v psql >/dev/null 2>&1; then
    # Create improved db init script
    cat > /usr/lib/ora/rumahl-db-init-improved <<'EOF'
#!/bin/sh
# Improved rumahl Database Initialisation

log() { logger -t "rumahl-db-init" "$*"; echo "[rumahl-db-init] $*"; }

# Wait for PostgreSQL
for i in $(seq 1 30); do
    if su - postgres -c "pg_isready -q" 2>/dev/null; then break; fi
    sleep 1
done

# Create root superuser
su - postgres -c "createuser -s root 2>/dev/null || true" 2>/dev/null || true

# Create ora role with password
su - postgres -c "psql -c \"CREATE ROLE ora LOGIN PASSWORD 'ora'\"" 2>/dev/null || \
    su - postgres -c "psql -c \"ALTER ROLE ora PASSWORD 'ora'\"" 2>/dev/null || true

# Create databases
for db in rumahl_home rumahl_core rumahl_security rumahl_secrets rumahl_appstore rumahl_assist; do
    su - postgres -c "psql -c 'CREATE DATABASE $db OWNER ora'" 2>/dev/null || true
done

# Harden pg_hba.conf
PGDATA=$(su - postgres -c "psql -t -c 'SHOW data_directory'" 2>/dev/null | tr -d ' ')
if [ -n "$PGDATA" ] && [ -f "$PGDATA/pg_hba.conf" ]; then
    if ! grep -q "host.*all.*ora.*127.0.0.1" "$PGDATA/pg_hba.conf" 2>/dev/null; then
        echo "" >> "$PGDATA/pg_hba.conf"
        echo "# rumahl application role" >> "$PGDATA/pg_hba.conf"
        echo "host    all             ora            127.0.0.1/32            scram-sha-256" >> "$PGDATA/pg_hba.conf"
        echo "host    all             ora            ::1/128                 scram-sha-256" >> "$PGDATA/pg_hba.conf"
        su - postgres -c "psql -c 'SELECT pg_reload_conf()'" 2>/dev/null || true
        log "pg_hba.conf hardened"
    fi
fi

# Create environment files
mkdir -p /etc/ora
for svc in rumahl-home rumahl-core rumahl-secrets rumahl-security; do
    db=$(echo "$svc" | tr '-' '_')
    echo "DATABASE_URL=postgres://ora:ora@localhost/$db" > "/etc/ora/$svc.env" 2>/dev/null || true
    chmod 600 "/etc/ora/$svc.env" 2>/dev/null || true
done

log "Database initialization complete"
exit 0
EOF
    chmod 755 /usr/lib/ora/rumahl-db-init-improved
    log "Improved rumahl-db-init script created"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 5. Dynamic Memory Optimization
# ═══════════════════════════════════════════════════════════════════════════════
log "Applying dynamic memory optimization..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/rumahl-optimize-memory.sh" ]; then
    bash "$SCRIPT_DIR/rumahl-optimize-memory.sh"
else
    warn "rumahl-optimize-memory.sh not found, skipping memory optimization"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 6. Nginx Performance Optimization
# ═══════════════════════════════════════════════════════════════════════════════
log "Applying nginx performance optimization..."

if [ -f "$SCRIPT_DIR/rumahl-optimize-nginx.sh" ]; then
    bash "$SCRIPT_DIR/rumahl-optimize-nginx.sh"
else
    warn "rumahl-optimize-nginx.sh not found, skipping nginx optimization"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 7. Service Priority & Lazy Loading
# ═══════════════════════════════════════════════════════════════════════════════
log "Configuring service priorities and lazy loading..."

if [ -f "$SCRIPT_DIR/rumahl-service-priority.sh" ]; then
    bash "$SCRIPT_DIR/rumahl-service-priority.sh"
else
    warn "rumahl-service-priority.sh not found, skipping service priority configuration"
fi

# ═══════════════════════════════════════════════════════════════════════════════
# 7. Boot experience - production identity on the dev VM console
#    (same ASCII logo as the rumahl OS installer, see INSTALLER_BOOT_SPLASH.md)
# ═══════════════════════════════════════════════════════════════════════════════
log "Installing rumahl boot identity (MOTD + GRUB)..."

# Login banner (SSH + serial console) with the rumahl OS ASCII logo and
# live service status - the dev VM greets you like rumahl OS does.
mkdir -p /etc/update-motd.d
cat > /etc/update-motd.d/10-rumahl-status <<'MOTDEOF'
#!/bin/bash
# rumahl OS dev VM status banner (same ASCII identity as the installer)
printf '%s\n' \
'          ██╗ ██████╗ ██████╗  █████╗' \
'          ██║██╔═══██╗██╔══██╗██╔══██╗' \
'          ██║██║   ██║██████╔╝███████║' \
'          ██║██║   ██║██╔══██╗██╔══██║' \
'          ██║╚██████╔╝██║  ██║██║  ██║' \
'          ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝'
echo '       Interface for Optimized Residential Autonomy (Dev VM)'
echo ''
echo '  Services:'
for svc in rumahl-core rumahl-home rumahl-assist rumahl-secrets rumahl-watchdog rumahl-gateway; do
    st=$(systemctl is-active "$svc" 2>/dev/null || echo inactive)
    printf '    %-14s %s\n' "$svc" "$st"
done
echo ''
echo "  Uptime: $(uptime -p | sed 's/up //')"
echo ''
MOTDEOF
chmod 755 /etc/update-motd.d/10-rumahl-status
[ -x /etc/update-motd.d/10-rumahl-status ] && log "MOTD banner installed"

# GRUB: rumahl identity + readable colors (menu shows "rumahl OS")
if [ -f /etc/default/grub ]; then
    grep -q '^GRUB_DISTRIBUTOR=' /etc/default/grub && sed -i 's/^GRUB_DISTRIBUTOR=.*/GRUB_DISTRIBUTOR="rumahl OS"/' /etc/default/grub || echo 'GRUB_DISTRIBUTOR="rumahl OS"' >> /etc/default/grub
    grep -q '^GRUB_COLOR_NORMAL=' /etc/default/grub && sed -i 's/^GRUB_COLOR_NORMAL=.*/GRUB_COLOR_NORMAL="cyan\/black"/' /etc/default/grub || echo 'GRUB_COLOR_NORMAL="cyan/black"' >> /etc/default/grub
    grep -q '^GRUB_COLOR_HIGHLIGHT=' /etc/default/grub && sed -i 's/^GRUB_COLOR_HIGHLIGHT=.*/GRUB_COLOR_HIGHLIGHT="white\/black"/' /etc/default/grub || echo 'GRUB_COLOR_HIGHLIGHT="white/black"' >> /etc/default/grub
    grep -q '^GRUB_TIMEOUT=' /etc/default/grub || echo 'GRUB_TIMEOUT=3' >> /etc/default/grub
    update-grub 2>&1 | tail -1 || warn "update-grub failed - GRUB identity not applied"
    log "GRUB boot identity applied (rumahl OS)"
fi

log "All improvements applied!"
