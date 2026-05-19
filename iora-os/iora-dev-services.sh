#!/usr/bin/env bash
# ============================================================================
# iora-dev-services.sh – IORA OS Service-Äquivalente für die Dev-VM
# ============================================================================
# Erstellt systemd-Service-Units die 1:1 den IORA OS Services entsprechen.
# EXAKT gleiche Struktur wie IORA OS / IORA OS Dev:
#   - Binaries: /usr/bin/iora-*
#   - Data:     /opt/iora/data
#   - Config:   /etc/iora/
#   - Logs:     journalctl -u iora-*
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
mkdir -p /usr/lib/iora /var/log /var/log/iora

# ═══════════════════════════════════════════════════════════════════════════════
# HELPER: service unit templates
# ═══════════════════════════════════════════════════════════════════════════════

# IORA app service – EXAKT wie IORA OS post-build.sh generiert
# Binary liegt unter /usr/bin/iora-*, Data unter /opt/iora/data
_iora_service() {
    local name="$1" port="${2:-}" after="${3:-}" memory_max="${4:-}"
    local binary="/usr/bin/${name}"
    local datadir="/opt/iora/data/${name}"
    mkdir -p "$datadir" 2>/dev/null || true

    local mem_limit=""
    [ -n "$memory_max" ] && mem_limit="MemoryMax=${memory_max}"

    cat > "${SVC_DIR}/${name}.service" <<EOF
[Unit]
Description=IORA ${name} Service
Documentation=https://iora-os.dev/services/${name}
${after:+After=${after}}
${after:+Wants=${after}}
ConditionPathExists=${binary}

[Service]
Type=simple
User=root
WorkingDirectory=${datadir}
ExecStart=${binary}
Restart=always
RestartSec=2
StartLimitBurst=5
StartLimitIntervalSec=30
${port:+Environment=PORT=${port}}
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${name}
Environment=RUST_LOG=${name//-/_}=info
EnvironmentFile=-/etc/iora/${name}.env
${mem_limit}

# Security hardening (same as IORA OS)
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/iora/data /opt/iora/docs /tmp/iora-sandboxes /var/lib/iora /mnt/data/iora
ReadOnlyPaths=/usr/bin /etc/iora

[Install]
WantedBy=multi-user.target
EOF
}

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
    
    # iora-db-init: Creates root role + IORA databases
    _full_service iora-db-init "IORA Database Initialisation" "postgresql.service" \
        "/bin/sh -c 'su - postgres -c \"createuser -s root 2>/dev/null || true\"; su - postgres -c \"psql -c '\''CREATE DATABASE iora_home OWNER iora'\''\" 2>/dev/null || true; su - postgres -c \"psql -c '\''CREATE DATABASE iora_core OWNER iora'\''\" 2>/dev/null || true; su - postgres -c \"psql -c '\''CREATE DATABASE iora_security OWNER iora'\''\" 2>/dev/null || true; su - postgres -c \"psql -c '\''CREATE DATABASE iora_secrets OWNER iora'\''\" 2>/dev/null || true; su - postgres -c \"psql -c '\''CREATE DATABASE iora_appstore OWNER iora'\''\" 2>/dev/null || true'"
    _enable iora-db-init
    success "iora-db-init.service (creates IORA databases)"
else
    _stub_service iora-db-init "IORA DB Init (PostgreSQL not installed)"
    success "iora-db-init.service (stub – no PostgreSQL)"
fi

# ── iora-init-data ──────────────────────────────────────────────────────
_full_service iora-init-data "IORA Data Directory Init" "mnt-data.mount" \
    "/bin/sh -c 'mkdir -p /mnt/data/iora /mnt/data/rauc /mnt/data/backups /opt/iora/data && chmod 755 /mnt/data/iora /mnt/data/rauc /mnt/data/backups /opt/iora/data'"
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
            iora-resource-manager iora-updater iora-domain-validator; do
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
# 2. REVERSE PROXY & SSL/TLS (IORA OS parity)
# ═══════════════════════════════════════════════════════════════════════════════

log "Setting up nginx reverse proxy with SSL/TLS..."

# Install nginx if not present
if ! command -v nginx >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -qq nginx 2>/dev/null || true
fi

# Generate self-signed SSL certificate (like IORA OS)
SSL_DIR="/etc/iora/ssl"
mkdir -p "$SSL_DIR"
if [ ! -f "$SSL_DIR/server.crt" ]; then
    openssl req -x509 -nodes -days 3650 \
        -newkey rsa:2048 \
        -keyout "$SSL_DIR/server.key" \
        -out "$SSL_DIR/server.crt" \
        -subj "/C=DE/ST=Dev/L=Dev/O=IORA-Dev/CN=iora-dev.local" \
        -addext "subjectAltName=DNS:iora-dev.local,DNS:localhost,IP:127.0.0.1" 2>/dev/null
    chmod 600 "$SSL_DIR/server.key"
    chmod 644 "$SSL_DIR/server.crt"
    success "SSL certificate generated: $SSL_DIR/server.crt"
else
    success "SSL certificate already exists"
fi

# Generate DH parameters (small for dev speed)
if [ ! -f "$SSL_DIR/dhparam.pem" ]; then
    openssl dhparam -out "$SSL_DIR/dhparam.pem" 1024 2>/dev/null || true
fi

# Nginx configuration matching IORA OS
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

cat > /etc/nginx/sites-available/iora-gateway <<'NGINXEOF'
# IORA OS Gateway – Dev VM Reverse Proxy
# Matches production iora-nginx configuration

# Upstream definitions (service discovery)
upstream iora_home {
    server 127.0.0.1:8126;
    keepalive 32;
}

upstream iora_core {
    server 127.0.0.1:8090;
    keepalive 16;
}

upstream iora_assist {
    server 127.0.0.1:8092;
    keepalive 8;
}

upstream iora_appstore {
    server 127.0.0.1:8098;
    keepalive 8;
}

upstream iora_supervisor {
    server 127.0.0.1:8097;
    keepalive 8;
}

upstream iora_gateway {
    server 127.0.0.1:8096;
    keepalive 8;
}

upstream iora_security {
    server 127.0.0.1:8095;
    keepalive 8;
}

upstream iora_files {
    server 127.0.0.1:8103;
    keepalive 8;
}

upstream iora_dev_bridge {
    server 127.0.0.1:8101;
    keepalive 8;
}

upstream iora_control {
    server 127.0.0.1:8091;
    keepalive 8;
}

# Rate limiting (like IORA OS)
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;

# Main server block – HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name iora-dev.local localhost;

    # ACME challenge (for future Let's Encrypt)
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Health check (no redirect)
    location /health {
        access_log off;
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    # Redirect everything else to HTTPS
    location / {
        return 301 https://$host$request_uri;
    }
}

# HTTPS server block
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name iora-dev.local localhost;

    # SSL configuration
    ssl_certificate /etc/iora/ssl/server.crt;
    ssl_certificate_key /etc/iora/ssl/server.key;
    ssl_dhparam /etc/iora/ssl/dhparam.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # Security headers (like IORA OS)
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    add_header X-Frame-Options SAMEORIGIN always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;

    # Gzip
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;

    # Frontend (SPA) – served by iora-home or static files
    root /opt/iora/build/dist;
    index index.html;

    # Frontend routes (SPA fallback)
    location / {
        try_files $uri $uri/ /index.html;
    }

    # API – iora-home (main API)
    location /api/ {
        limit_req zone=api burst=50 nodelay;
        proxy_pass http://iora_home;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 300s;
    }

    # Auth endpoints (stricter rate limit)
    location /api/auth/ {
        limit_req zone=auth burst=3 nodelay;
        proxy_pass http://iora_home;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
    location /ws/ {
        proxy_pass http://iora_home;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
    }

    # iora-core (service registry)
    location /core/ {
        proxy_pass http://iora_core/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # iora-assist (AI)
    location /assist/ {
        proxy_pass http://iora_assist/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_read_timeout 600s;
    }

    # iora-assist streaming
    location /assist/stream/ {
        proxy_pass http://iora_assist/;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
    }

    # App Store
    location /store/ {
        proxy_pass http://iora_appstore/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Supervisor (Docker management)
    location /supervisor/ {
        proxy_pass http://iora_supervisor/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Security
    location /security/ {
        proxy_pass http://iora_security/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Files
    location /files/ {
        proxy_pass http://iora_files/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 100M;
    }

    # Gateway
    location /gateway/ {
        proxy_pass http://iora_gateway/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Control Center
    location /control/ {
        proxy_pass http://iora_control/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Dev Bridge (IDE integration) – EXAKT wie IORA OS Dev
    location /dev/ {
        proxy_pass http://iora_dev_bridge/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 600s;
    }

    # Swagger/API docs
    location /docs {
        proxy_pass http://iora_home/api/docs;
        proxy_set_header Host $host;
    }

    location /api/docs {
        proxy_pass http://iora_home;
        proxy_set_header Host $host;
    }

    # Health endpoints
    location /health/ {
        access_log off;
        proxy_pass http://iora_home/health;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/iora-gateway /etc/nginx/sites-enabled/iora-gateway

# Test and reload nginx
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
systemctl enable nginx 2>/dev/null || true
success "nginx reverse proxy configured (HTTP→HTTPS, all services)"

# ═══════════════════════════════════════════════════════════════════════════════
# 3. IORA APP SERVICES (EXAKT wie IORA OS /devup.sh registry)
# ═══════════════════════════════════════════════════════════════════════════════

log "Creating IORA app service units..."

# Service-Port mapping (EXAKT aus devup.sh _register Aufrufen)
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
IORA_PORTS[iora-api]=8099
IORA_PORTS[iora-backup]=8100
IORA_PORTS[iora-dev-bridge]=8101
IORA_PORTS[iora-domain-validator]=8102
IORA_PORTS[iora-files]=8103
IORA_PORTS[iora-network-monitor]=8104
IORA_PORTS[iora-nginx]=8089
IORA_PORTS[iora-resource-manager]=8105
IORA_PORTS[iora-updater]=8106
IORA_PORTS[iora-connector]=8088

# Service dependencies (EXAKT aus devup.sh _register Aufrufen)
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

# Memory limits (like IORA OS)
declare -A IORA_MEM
IORA_MEM[iora-assist]="1500M"

for svc in "${!IORA_PORTS[@]}"; do
    _iora_service "$svc" "${IORA_PORTS[$svc]}" "${IORA_AFTER[$svc]:-}" "${IORA_MEM[$svc]:-}"
    success "  ${svc}.service (port ${IORA_PORTS[$svc]})"
done

# Create /opt/iora/data structure for each service
for svc in "${!IORA_PORTS[@]}"; do
    mkdir -p "/opt/iora/data/${svc}" 2>/dev/null || true
done
success "/opt/iora/data/<svc>/ directories created"

# ═══════════════════════════════════════════════════════════════════════════════
# 4. OS-LEVEL SERVICES – STUB (exist, but no-op in dev)
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
# 5. LOGGING & MONITORING (matches IORA OS)
# ═══════════════════════════════════════════════════════════════════════════════

log "Configuring logging and monitoring..."

# Log rotation for IORA services
cat > /etc/logrotate.d/iora <<'LOGROTATEEOF'
/var/log/iora/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 root root
    sharedscripts
    postrotate
        systemctl reload rsyslog > /dev/null 2>&1 || true
    endscript
}
LOGROTATEEOF

# Rsyslog config for IORA services
if command -v rsyslogd >/dev/null 2>&1; then
    cat > /etc/rsyslog.d/50-iora.conf <<'RSYSLOGEOF'
# IORA OS service logging
:programname, startswith, "iora-" /var/log/iora/services.log
& stop
RSYSLOGEOF
    systemctl restart rsyslog 2>/dev/null || true
fi

success "Logging: journald + rsyslog + logrotate configured"

# Health check script
cat > /usr/lib/iora/iora-health-check <<'HEALTHEOF'
#!/bin/bash
# IORA Health Check – Monitors all IORA services
LOG_TAG="iora-health"
LOG_FILE="/var/log/iora/health.log"

log() { 
    logger -t "$LOG_TAG" "$*"
    echo "[$(date -Iseconds)] $LOG_TAG: $*" >> "$LOG_FILE"
}

# Check all IORA services
check_service() {
    local svc="$1"
    if ! systemctl is-active --quiet "${svc}.service" 2>/dev/null; then
        log "WARN: $svc is not running"
        return 1
    fi
    return 0
}

# Main health check
SERVICES="iora-core iora-home iora-assist iora-appstore iora-supervisor iora-gateway iora-security iora-files iora-secrets iora-control iora-watchdog iora-dev-bridge"

HEALTHY=0
UNHEALTHY=0

for svc in $SERVICES; do
    if check_service "$svc"; then
        HEALTHY=$((HEALTHY + 1))
    else
        UNHEALTHY=$((UNHEALTHY + 1))
    fi
done

# Check nginx, PostgreSQL, Docker
for svc in nginx postgresql docker; do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
        HEALTHY=$((HEALTHY + 1))
    else
        log "WARN: $svc is not running"
        UNHEALTHY=$((UNHEALTHY + 1))
    fi
done

# Write status file
cat > /var/log/iora/status.json <<EOF
{
  "timestamp": "$(date -Iseconds)",
  "healthy": $HEALTHY,
  "unhealthy": $UNHEALTHY
}
EOF

exit 0
HEALTHEOF
chmod 755 /usr/lib/iora/iora-health-check

# Health check timer
cat > "${SVC_DIR}/iora-health-check.timer" <<'EOF'
[Unit]
Description=IORA Health Check Timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
RandomizedDelaySec=10s

[Install]
WantedBy=timers.target
EOF

cat > "${SVC_DIR}/iora-health-check.service" <<'EOF'
[Unit]
Description=IORA Health Check

[Service]
Type=oneshot
ExecStart=/usr/lib/iora/iora-health-check
StandardOutput=journal
StandardError=journal
EOF

ln -sf "${SVC_DIR}/iora-health-check.timer" "${SVC_DIR}/timers.target.wants/iora-health-check.timer" 2>/dev/null || true
success "Health check: runs every minute"

# ═══════════════════════════════════════════════════════════════════════════════
# 6. SUMMARY
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
check_svc "iora-health-check"     "FULL"
check_svc "iora-health-check.timer" "FULL"

# App services
for svc in "${!IORA_PORTS[@]}"; do
    check_svc "$svc" "APP"
done

echo ""
log "Dev VM services match IORA OS:"
log "  $(ls ${SVC_DIR}/iora-*.service 2>/dev/null | wc -l) IORA service units created"
log "  FULL = fully functional | STUB = exists but no-op | APP = Rust binary unit"
echo ""
log "Binary paths: /usr/bin/iora-* (EXAKT wie IORA OS)"
log "Data paths:   /opt/iora/data/<svc>/ (EXAKT wie IORA OS)"
log "Config paths: /etc/iora/<svc>.env (EXAKT wie IORA OS)"
echo ""
success "Service compatibility layer complete."
