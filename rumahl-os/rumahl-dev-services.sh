#!/usr/bin/env bash
# ============================================================================
# rumahl-dev-services.sh – rumahl OS Service-Äquivalente für die Dev-VM
# ============================================================================
# Erstellt systemd-Service-Units die 1:1 den rumahl OS Services entsprechen.
# EXAKT gleiche Struktur wie rumahl OS / rumahl OS Dev:
#   - Binaries: /usr/bin/rumahl-*
#   - Data:     /opt/rumahl/data
#   - Config:   /etc/ora/
#   - Logs:     journalctl -u rumahl-*
#
# Usage: sudo ./rumahl-dev-services.sh [--source-mode|--build-mode]
#   --source-mode (default)  Units run `cargo run -p <svc>` from the synced
#                            1:1 mirror (/home/ora/ora) - no build step.
#   --build-mode             Units run the deployed binaries /usr/bin/rumahl-*
# ============================================================================

set -euo pipefail

# -- Run mode -----------------------------------------------------------------
RUN_MODE="source"
case "${1:-}" in
    --source-mode) RUN_MODE="source"; shift ;;
    --build-mode)  RUN_MODE="build"; shift ;;
    -h|--help)     echo "Usage: $0 [--source-mode|--build-mode]"; exit 0 ;;
    "") ;;
    *) echo "Unknown argument: $1 (use --source-mode or --build-mode)" >&2; exit 1 ;;
esac

# Marker for the hot-reload daemon (rumahl-dev-hot-reload.sh) and dev scripts
mkdir -p /etc/ora
echo "$RUN_MODE" > /etc/ora/dev-run-mode
echo "Run mode: $RUN_MODE"

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()    { echo -e "${BLUE}[svc]${NC} $*"; }
success(){ echo -e "${GREEN}[svc]${NC} $*"; }
warn()   { echo -e "${YELLOW}[svc]${NC} $*"; }

[ "$(id -u)" -eq 0 ] || { echo "ERROR: Must run as root"; exit 1; }

SVC_DIR="/etc/systemd/system"
mkdir -p "$SVC_DIR" "$SVC_DIR/multi-user.target.wants" "$SVC_DIR/timers.target.wants"
mkdir -p /usr/lib/ora /var/log /var/log/ora

# ═══════════════════════════════════════════════════════════════════════════════
# HELPER: service unit templates
# ═══════════════════════════════════════════════════════════════════════════════

# rumahl app service – EXAKT wie rumahl OS post-build.sh generiert
# Binary liegt unter /usr/bin/rumahl-*, Data unter /opt/rumahl/data
_rumahl_service() {
    local name="$1" port="${2:-}" after="${3:-}" memory_max="${4:-}"
    local binary="/usr/bin/${name}"
    local datadir="/opt/rumahl/data/${name}"
    mkdir -p "$datadir" 2>/dev/null || true

    local mem_limit=""
    [ -n "$memory_max" ] && mem_limit="MemoryMax=${memory_max}"

    # Port discovery: expose the FULL service port map as specific
    # {SERVICE}_PORT variables. The generic `PORT` fallback in
    # system_config::service_port() would otherwise resolve every OTHER
    # service to THIS service's own port (PORT=8126 in rumahl-home means
    # service_url("rumahl-files") -> http://127.0.0.1:8126 -> rumahl-home
    # itself), causing recursive self-proxy loops (503 timeouts) and 404s
    # for /api/os/control/*. Each unit gets the whole map so cross-service
    # discovery works identically to rumahl OS defaults.
    local port_envs=""
    for ps in "${!RUMAHL_PORTS[@]}"; do
        local upper
        upper=$(printf '%s' "$ps" | tr '[:lower:]-' '[:upper:]_')
        port_envs="${port_envs}${upper}_PORT=${RUMAHL_PORTS[$ps]} "
    done

    # Cargo parallelism: each rustc needs ~2GB RAM. Without a limit cargo
    # uses ALL cores (e.g. 16 x 2GB = 32GB) and the OOM killer kills the
    # service -> systemd restart loop. Budget 4GB per job, 2..8 jobs.
    local mem_mb cargo_jobs
    mem_mb=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 8192)
    cargo_jobs=$(( mem_mb / 4096 ))
    [ "$cargo_jobs" -lt 2 ] && cargo_jobs=2
    [ "$cargo_jobs" -gt 8 ] && cargo_jobs=8

    if [ "$RUN_MODE" = "source" ]; then
        # SOURCE MODE: run `cargo run -p <svc>` straight from the 1:1 mirror.
        # cargo compiles incrementally in the VM; the hot-reload daemon
        # (rumahl-hot-reload.service) restarts this unit on source changes.
        # rumahl-dev-bridge is the exception: it requires root (host-level
        # channels) and would exit with "requires root (uid=0)" as ora.
        local run_user="ora" run_group="ora"
        [ "$name" = "rumahl-dev-bridge" ] && run_user="root" && run_group="root"
        # As root, the rustup shim needs the ora toolchain/cargo env
        local bridge_env=""
        [ "$name" = "rumahl-dev-bridge" ] && bridge_env="Environment=HOME=/home/ora
Environment=RUSTUP_HOME=/home/ora/.rustup
Environment=CARGO_HOME=/home/ora/.cargo"
        chown -R ora:ora "$datadir" 2>/dev/null || true
        cat > "${SVC_DIR}/${name}.service" <<EOF
[Unit]
Description=rumahl ${name} Service (source mode - cargo run)
Documentation=https://rumahl-os.dev/services/${name}
# Cold-start gate: without it all cargo run units would serialize on the
# cargo build lock for hours. systemd starts rumahl-build-all.service first
# (single parallel build), then every service starts instantly.
After=rumahl-build-all.service
Wants=rumahl-build-all.service
${after:+After=${after}}
${after:+Wants=${after}}
ConditionPathExists=/home/ora/ora/rumahl-os/backend/Cargo.toml
ConditionPathExists=/home/ora/.cargo/bin/cargo
StartLimitBurst=5
StartLimitIntervalSec=300

[Service]
Type=simple
User=${run_user}
Group=${run_group}
WorkingDirectory=/home/ora/ora/rumahl-os/backend
# Cold-start fix: `cargo run -p X` recompiles the dependency graph per
# service (Cargo artifacts are feature-exact) and serializes every service
# on the shared build lock - a cold start can take hours. The binaries are
# built once by rumahl-build-all.service (After/Wants above); the hot-reload
# daemon rebuilds them on source changes (see rumahl-dev-hot-reload.sh).
ExecStart=/home/ora/ora/rumahl-os/backend/target/debug/${name}
Restart=always
RestartSec=15
# FD limit: default (1024) is exhausted by WebSocket/SSE clients + HTTP
# pools (accept error: Too many open files). Match the rumahl OS installer.
LimitNOFILE=65536
LimitNPROC=4096
# Keep rustc parallelity within the VM's RAM (see cargo_jobs above)
Environment=CARGO_BUILD_JOBS=${cargo_jobs}
Environment=${port_envs}
${bridge_env}
Environment=RUST_LOG=${name//-/_}=debug
EnvironmentFile=-/etc/ora/${name}.env
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${name}
${mem_limit}

# Source mode: cargo needs write access to the tree (target/) and ~/.cargo
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=full
ReadWritePaths=/home/ora/ora /home/ora/.cargo /opt/rumahl/data

[Install]
WantedBy=multi-user.target
EOF
        return 0
    fi

    # BUILD MODE: run the deployed binary (EXAKT wie rumahl OS)
    cat > "${SVC_DIR}/${name}.service" <<EOF
[Unit]
Description=rumahl ${name} Service
Documentation=https://rumahl-os.dev/services/${name}
${after:+After=${after}}
${after:+Wants=${after}}
ConditionPathExists=${binary}
StartLimitBurst=5
StartLimitIntervalSec=300

[Service]
Type=simple
User=root
WorkingDirectory=${datadir}
ExecStart=${binary}
Restart=always
RestartSec=10
# FD limit: default (1024) is exhausted by WebSocket/SSE clients + HTTP
# pools (accept error: Too many open files). Match the rumahl OS installer.
LimitNOFILE=65536
LimitNPROC=4096
# Full port map for cross-service discovery (see comment in _rumahl_service)
Environment=${port_envs}
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${name}
Environment=RUST_LOG=${name//-/_}=info
EnvironmentFile=-/etc/ora/${name}.env
${mem_limit}

# Security hardening (same as rumahl OS)
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ReadWritePaths=/opt/rumahl/data /opt/rumahl/docs /tmp/rumahl-sandboxes /var/lib/ora /mnt/data/ora
ReadOnlyPaths=/usr/bin /etc/ora

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
Description=${desc} (Dev-VM stub – rumahl OS compatibility)

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
Description=ZRAM Swap (rumahl OS)
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
    
    # rumahl-db-init: Creates root role + rumahl databases
    _full_service rumahl-db-init "rumahl Database Initialisation" "postgresql.service" \
        "/bin/sh -c 'su - postgres -c \"createuser -s root 2>/dev/null || true\"; su - postgres -c \"psql -c '\''CREATE DATABASE rumahl_home OWNER ora'\''\" 2>/dev/null || true; su - postgres -c \"psql -c '\''CREATE DATABASE rumahl_core OWNER ora'\''\" 2>/dev/null || true; su - postgres -c \"psql -c '\''CREATE DATABASE rumahl_security OWNER ora'\''\" 2>/dev/null || true; su - postgres -c \"psql -c '\''CREATE DATABASE rumahl_secrets OWNER ora'\''\" 2>/dev/null || true; su - postgres -c \"psql -c '\''CREATE DATABASE rumahl_appstore OWNER ora'\''\" 2>/dev/null || true'"
    _enable rumahl-db-init
    success "rumahl-db-init.service (creates rumahl databases)"
else
    _stub_service rumahl-db-init "rumahl DB Init (PostgreSQL not installed)"
    success "rumahl-db-init.service (stub – no PostgreSQL)"
fi

# ── rumahl-init-data ──────────────────────────────────────────────────────
_full_service rumahl-init-data "rumahl Data Directory Init" "mnt-data.mount" \
    "/bin/sh -c 'mkdir -p /mnt/data/ora /mnt/data/rauc /mnt/data/backups /opt/rumahl/data && chmod 755 /mnt/data/ora /mnt/data/rauc /mnt/data/backups /opt/rumahl/data'"
_enable rumahl-init-data
success "rumahl-init-data.service"

# ── rumahl-stack (Docker user-apps) ────────────────────────────────────────
_full_service rumahl-stack "rumahl User-Apps Docker Stack" "docker.service rumahl-init-data.service" \
    "/bin/sh -c 'if [ -f /mnt/data/ora/docker-compose.yml ]; then docker compose -f /mnt/data/ora/docker-compose.yml up -d --remove-orphans 2>/dev/null || true; fi'"
success "rumahl-stack.service (user-apps Docker compose)"

# ── rumahl-stack-watchdog ──────────────────────────────────────────────────
cat > "${SVC_DIR}/rumahl-stack-watchdog.service" <<'WATCHDOG'
[Unit]
Description=rumahl Stack Watchdog (Dev VM)
After=docker.service rumahl-stack.service

[Service]
Type=oneshot
ExecStart=/usr/lib/ora/rumahl-watchdog-check
SuccessExitStatus=0 1
StandardOutput=journal
StandardError=journal
WATCHDOG

cat > "${SVC_DIR}/rumahl-stack-watchdog.timer" <<'WATCHDOGTIMER'
[Unit]
Description=rumahl Stack Watchdog Timer

[Timer]
OnBootSec=3min
OnUnitActiveSec=2min
RandomizedDelaySec=30s

[Install]
WantedBy=timers.target
WATCHDOGTIMER
ln -sf "${SVC_DIR}/rumahl-stack-watchdog.timer" "${SVC_DIR}/timers.target.wants/rumahl-stack-watchdog.timer" 2>/dev/null || true
success "rumahl-stack-watchdog.timer (every 2 min)"

# ── watchdog-check script (gleiche Logik wie rumahl OS) ───────────────────
cat > /usr/lib/ora/rumahl-watchdog-check <<'WDSH'
#!/bin/sh
LOG_TAG="rumahl-watchdog"
log() { logger -t "$LOG_TAG" "$*"; echo "[$(date -Iseconds)] $LOG_TAG: $*"; }

# Restart stopped native rumahl services
for svc in rumahl-core rumahl-home rumahl-control rumahl-assist \
            rumahl-secrets rumahl-watchdog rumahl-security rumahl-gateway \
            rumahl-supervisor rumahl-api rumahl-appstore rumahl-backup rumahl-connector \
            rumahl-dev-bridge rumahl-files rumahl-network-monitor rumahl-nginx \
            rumahl-resource-manager rumahl-updater rumahl-domain-validator; do
    if ! systemctl is-active --quiet "${svc}.service" 2>/dev/null; then
        if systemctl is-enabled --quiet "${svc}.service" 2>/dev/null; then
            log "restarting stopped native service: ${svc}"
            systemctl start "${svc}.service" 2>/dev/null || true
        fi
    fi
done

# Restart stopped Docker user-app containers
if [ -f /mnt/data/ora/docker-compose.yml ]; then
    STOPPED=$(docker compose -f /mnt/data/ora/docker-compose.yml ps --status exited --services 2>/dev/null | wc -l)
    if [ "$STOPPED" -gt 0 ]; then
        log "restarting $STOPPED stopped user-app container(s)"
        docker compose -f /mnt/data/ora/docker-compose.yml up -d --remove-orphans 2>/dev/null || true
    fi
fi
exit 0
WDSH
chmod 755 /usr/lib/ora/rumahl-watchdog-check
success "rumahl-watchdog-check script"

# ── rumahl-setup ──────────────────────────────────────────────────────────
_full_service rumahl-setup "rumahl Setup Wizard (Dev VM)" "docker.service" \
    "/bin/sh -c 'touch /mnt/data/ora/.setup-complete && echo RUMAHL_OS_COMPAT=1 > /etc/ora/os-release'"
_enable rumahl-setup
success "rumahl-setup.service"

# ═══════════════════════════════════════════════════════════════════════════════
# 2. REVERSE PROXY & SSL/TLS (rumahl OS parity)
# ═══════════════════════════════════════════════════════════════════════════════

log "Setting up nginx reverse proxy with SSL/TLS..."

# Install nginx if not present
if ! command -v nginx >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get install -y -qq nginx 2>/dev/null || true
fi

# Generate self-signed SSL certificate (like rumahl OS)
SSL_DIR="/etc/ora/ssl"
mkdir -p "$SSL_DIR"
if [ ! -f "$SSL_DIR/server.crt" ]; then
    openssl req -x509 -nodes -days 3650 \
        -newkey rsa:2048 \
        -keyout "$SSL_DIR/server.key" \
        -out "$SSL_DIR/server.crt" \
        -subj "/C=DE/ST=Dev/L=Dev/O=rumahl-Dev/CN=rumahl-dev.local" \
        -addext "subjectAltName=DNS:rumahl-dev.local,DNS:localhost,IP:127.0.0.1" 2>/dev/null
    chmod 600 "$SSL_DIR/server.key"
    chmod 644 "$SSL_DIR/server.crt"
    success "SSL certificate generated: $SSL_DIR/server.crt"
else
    success "SSL certificate already exists"
fi

# Nginx configuration matching rumahl OS
mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d
rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

cat > /etc/nginx/sites-available/rumahl-gateway <<'NGINXEOF'
# rumahl OS Gateway – Dev VM Reverse Proxy
# Matches production rumahl-nginx configuration

# Upstream definitions (service discovery)
upstream rumahl_home {
    server 127.0.0.1:8126;
    keepalive 32;
}

upstream rumahl_core {
    server 127.0.0.1:8090;
    keepalive 16;
}

upstream rumahl_assist {
    server 127.0.0.1:8092;
    keepalive 8;
}

upstream rumahl_appstore {
    server 127.0.0.1:8098;
    keepalive 8;
}

upstream rumahl_supervisor {
    server 127.0.0.1:8097;
    keepalive 8;
}

upstream rumahl_gateway {
    server 127.0.0.1:8096;
    keepalive 8;
}

upstream rumahl_security {
    server 127.0.0.1:8095;
    keepalive 8;
}

upstream rumahl_files {
    server 127.0.0.1:8100;
    keepalive 8;
}

upstream rumahl_dev_bridge {
    server 127.0.0.1:8101;
    keepalive 8;
}

upstream rumahl_control {
    server 127.0.0.1:8091;
    keepalive 8;
}

# Rate limiting (like rumahl OS)
limit_req_zone $binary_remote_addr zone=api:10m rate=30r/s;
limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/m;

# Main server block – HTTP → HTTPS redirect
server {
    listen 80;
    listen [::]:80;
    server_name rumahl-dev.local localhost;

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
    server_name rumahl-dev.local localhost;

    # SSL configuration
    ssl_certificate /etc/ora/ssl/server.crt;
    ssl_certificate_key /etc/ora/ssl/server.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;

    # Security headers (like rumahl OS)
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

    # Frontend (SPA) – __FRONTEND_BLOCK__

    # API – rumahl-home (main API)
    location /api/ {
        limit_req zone=api burst=50 nodelay;
        proxy_pass http://rumahl_home;
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
        proxy_pass http://rumahl_home;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket support
    location /ws/ {
        proxy_pass http://rumahl_home;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
    }

    # rumahl-core (service registry)
    location /core/ {
        proxy_pass http://rumahl_core/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # rumahl-assist (AI)
    location /assist/ {
        proxy_pass http://rumahl_assist/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;
        proxy_read_timeout 600s;
    }

    # rumahl-assist streaming
    location /assist/stream/ {
        proxy_pass http://rumahl_assist/;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 600s;
    }

    # App Store
    location /store/ {
        proxy_pass http://rumahl_appstore/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Supervisor (Docker management)
    location /supervisor/ {
        proxy_pass http://rumahl_supervisor/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Security
    location /security/ {
        proxy_pass http://rumahl_security/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Files
    location /files/ {
        proxy_pass http://rumahl_files/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 100M;
    }

    # Gateway
    location /gateway/ {
        proxy_pass http://rumahl_gateway/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Control Center
    location /control/ {
        proxy_pass http://rumahl_control/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    # Dev Bridge (IDE integration) – EXAKT wie rumahl OS Dev
    location /dev/ {
        proxy_pass http://rumahl_dev_bridge/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_http_version 1.1;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 600s;
    }

    # Swagger/API docs
    location /docs {
        proxy_pass http://rumahl_home/api/docs;
        proxy_set_header Host $host;
    }

    location /api/docs {
        proxy_pass http://rumahl_home;
        proxy_set_header Host $host;
    }

    # Health endpoints
    location /health/ {
        access_log off;
        proxy_pass http://rumahl_home/health;
    }
}

# Port 3001 – Development proxy (Vite dev server on host → VM)
# The host forwards localhost:3001 → VM:3001 via QEMU port forwarding.
# This lets the host's Vite dev server (npm run dev) reach the backend.
server {
    listen 3001;
    listen [::]:3001;
    server_name localhost 127.0.0.1;

    location / {
        proxy_pass http://rumahl_home;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }
}
NGINXEOF

# Frontend block depends on the run mode:
#   source: proxy to rumahl-home, which forwards to the Vite dev server
#           (RUMAHL_FRONTEND_DEV_URL) incl. HMR websocket upgrades
#   build:  serve the static dist files (production-like)
if [ "$RUN_MODE" = "source" ]; then
    log "nginx: source mode - frontend proxied to rumahl-home (Vite HMR)"
    python3 - <<'PYEOF'
import re
path = '/etc/nginx/sites-available/rumahl-gateway'
with open(path) as f:
    content = f.read()
block = """    location / {
        proxy_pass http://rumahl_home;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
        proxy_read_timeout 86400s;
    }
"""
content = re.sub(r'    # .*__FRONTEND_BLOCK__\n', block, content)
with open(path, 'w') as f:
    f.write(content)
PYEOF
else
    log "nginx: build mode - frontend served from /opt/rumahl/build/dist"
    python3 - <<'PYEOF'
import re
path = '/etc/nginx/sites-available/rumahl-gateway'
with open(path) as f:
    content = f.read()
block = """    root /opt/rumahl/build/dist;
    index index.html;

    # Frontend routes (SPA fallback)
    location / {
        try_files $uri $uri/ /index.html;
    }
"""
content = re.sub(r'    # .*__FRONTEND_BLOCK__\n', block, content)
with open(path, 'w') as f:
    f.write(content)
PYEOF
fi

ln -sf /etc/nginx/sites-available/rumahl-gateway /etc/nginx/sites-enabled/rumahl-gateway

# Test and reload nginx
nginx -t 2>/dev/null && systemctl reload nginx 2>/dev/null || true
systemctl enable nginx 2>/dev/null || true
success "nginx reverse proxy configured (HTTP→HTTPS, all services)"

# ═══════════════════════════════════════════════════════════════════════════════
# 3. rumahl APP SERVICES (EXAKT wie rumahl OS /devup.sh registry)
# ═══════════════════════════════════════════════════════════════════════════════

log "Creating rumahl app service units..."

# Service-Port mapping (EXAKT aus devup.sh _register Aufrufen)
declare -A RUMAHL_PORTS
RUMAHL_PORTS[rumahl-core]=8090
RUMAHL_PORTS[rumahl-home]=8126
RUMAHL_PORTS[rumahl-control]=8091
RUMAHL_PORTS[rumahl-assist]=8092
RUMAHL_PORTS[rumahl-secrets]=8093
RUMAHL_PORTS[rumahl-watchdog]=8094
RUMAHL_PORTS[rumahl-security]=8095
RUMAHL_PORTS[rumahl-gateway]=8096
RUMAHL_PORTS[rumahl-supervisor]=8097
RUMAHL_PORTS[rumahl-appstore]=8098
RUMAHL_PORTS[rumahl-api]=8099
RUMAHL_PORTS[rumahl-backup]=8107
RUMAHL_PORTS[rumahl-dev-bridge]=8101
RUMAHL_PORTS[rumahl-domain-validator]=8102
RUMAHL_PORTS[rumahl-files]=8100
RUMAHL_PORTS[rumahl-network-monitor]=8104
RUMAHL_PORTS[rumahl-nginx]=8089
RUMAHL_PORTS[rumahl-resource-manager]=8105
RUMAHL_PORTS[rumahl-intelligence]=8112
RUMAHL_PORTS[rumahl-updater]=8106
RUMAHL_PORTS[rumahl-connector]=8088

# Service dependencies (EXAKT aus devup.sh _register Aufrufen)
declare -A RUMAHL_AFTER
RUMAHL_AFTER[rumahl-home]="rumahl-core.service"
RUMAHL_AFTER[rumahl-control]="rumahl-core.service rumahl-home.service"
RUMAHL_AFTER[rumahl-assist]="rumahl-core.service"
RUMAHL_AFTER[rumahl-watchdog]="rumahl-core.service"
RUMAHL_AFTER[rumahl-security]="rumahl-watchdog.service"
RUMAHL_AFTER[rumahl-supervisor]="rumahl-core.service rumahl-secrets.service docker.service"
RUMAHL_AFTER[rumahl-appstore]="rumahl-core.service rumahl-supervisor.service"
RUMAHL_AFTER[rumahl-backup]="rumahl-core.service"
RUMAHL_AFTER[rumahl-dev-bridge]="rumahl-core.service rumahl-supervisor.service"
RUMAHL_AFTER[rumahl-api]="rumahl-core.service rumahl-home.service"

# Memory limits (like rumahl OS)
declare -A RUMAHL_MEM
RUMAHL_MEM[rumahl-assist]="1500M"

for svc in "${!RUMAHL_PORTS[@]}"; do
    _rumahl_service "$svc" "${RUMAHL_PORTS[$svc]}" "${RUMAHL_AFTER[$svc]:-}" "${RUMAHL_MEM[$svc]:-}"
    success "  ${svc}.service (port ${RUMAHL_PORTS[$svc]})"
done

# Enable every rumahl service so it starts automatically on boot — the
# watchdog only restarts units that are enabled, and without this the
# services would never come up after a reboot.
for svc in "${!RUMAHL_PORTS[@]}"; do
    ln -sf "${SVC_DIR}/${svc}.service" "${SVC_DIR}/multi-user.target.wants/${svc}.service" 2>/dev/null || true
done
success "All rumahl services enabled (multi-user.target.wants)"


# ── Build-once gate (source mode) ─────────────────────────────────────────
# All source-mode services run `cargo run -p <svc>`; without a pre-build
# they serialize on the cargo build lock and a cold start can take hours
# (every service recompiles its dependency graph). Build all binaries once
# in a single parallel cargo invocation, then let the services start
# instantly behind it (After/Wants above). The build is incremental, so a
# warm boot only costs the up-to-date check (< 1s).
if [ "$RUN_MODE" = "source" ]; then
    build_mem_mb=$(awk '/MemTotal/{printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 8192)
    build_jobs=$(( build_mem_mb / 4096 ))
    [ "$build_jobs" -lt 2 ] && build_jobs=2
    [ "$build_jobs" -gt 8 ] && build_jobs=8
    BUILD_ALL_CRATES=$(printf -- '-p %s ' "${!RUMAHL_PORTS[@]}")
    cat > "${SVC_DIR}/rumahl-build-all.service" <<EOF
[Unit]
Description=rumahl build-once gate (compiles all service binaries)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
User=ora
Group=ora
WorkingDirectory=/home/ora/ora/rumahl-os/backend
Environment=HOME=/home/ora
Environment=RUSTUP_HOME=/home/ora/.rustup
Environment=CARGO_HOME=/home/ora/.cargo
Environment=CARGO_BUILD_JOBS=${build_jobs}
ExecStart=/home/ora/.cargo/bin/cargo build ${BUILD_ALL_CRATES}
TimeoutStartSec=3600
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    ln -sf "${SVC_DIR}/rumahl-build-all.service" "${SVC_DIR}/multi-user.target.wants/rumahl-build-all.service" 2>/dev/null || true
    success "rumahl-build-all.service (parallel pre-build; services start instantly after)"
fi

# Create /opt/rumahl/data structure for each service
for svc in "${!RUMAHL_PORTS[@]}"; do
    mkdir -p "/opt/rumahl/data/${svc}" 2>/dev/null || true
done
success "/opt/rumahl/data/<svc>/ directories created"

# ═══════════════════════════════════════════════════════════════════════════════
# 4. OS-LEVEL SERVICES – STUB (exist, but no-op in dev)
# ═══════════════════════════════════════════════════════════════════════════════

log "Creating stub services (rumahl OS compatibility – no-op in Dev VM)..."

_stub_service rumahl-recovery          "Recovery Mode"
_stub_service rumahl-detect-virt       "VM Detection"
_stub_service rumahl-integrity         "Integrity Check"
_stub_service rumahl-integrity-init    "Integrity Init"
_stub_service rumahl-verify            "Binary Verification"
_stub_service rumahl-tamper-screen     "Tamper Detection"
_stub_service rumahl-update-check      "Update Check"
_stub_service rumahl-update-monitor    "Update Monitor"
_stub_service rumahl-recovery-log-init "Recovery Log Init"
_stub_service rumahl-motd              "MOTD Updater"
_stub_service rumahl-dhcp-conflict-guard "DHCP Conflict Guard"

# Enable the stubs that other services depend on
_enable rumahl-recovery-log-init
_enable rumahl-dhcp-conflict-guard

# Timer stubs
cat > "${SVC_DIR}/rumahl-update-check.timer" <<'EOF'
[Unit]
Description=rumahl Update Check Timer (Dev VM stub)

[Timer]
OnBootSec=1h
OnUnitActiveSec=24h
Persistent=false

[Install]
WantedBy=timers.target
EOF

# ── data-unlock (simplified – no LUKS in dev) ──────────────────────────
cat > "${SVC_DIR}/rumahl-data-unlock.service" <<'EOF'
[Unit]
Description=rumahl Data Partition Unlock (Dev VM – simplified, no LUKS)
DefaultDependencies=no
Before=mnt-data.mount

[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/bin/sh -c 'mkdir -p /mnt/data/ora && echo "Dev VM – no LUKS needed"'
SuccessExitStatus=0 1

[Install]
WantedBy=local-fs.target
EOF
_enable rumahl-data-unlock
success "rumahl-data-unlock.service (simplified, no LUKS)"

# ── mnt-data.mount (necessary for data partition deps) ──────────────────
cat > "${SVC_DIR}/mnt-data.mount" <<'EOF'
[Unit]
Description=rumahl Data Partition (Dev VM)
DefaultDependencies=no
After=rumahl-data-unlock.service
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
# 5. LOGGING & MONITORING (matches rumahl OS)
# ═══════════════════════════════════════════════════════════════════════════════

log "Configuring logging and monitoring..."

# Log rotation for rumahl services
cat > /etc/logrotate.d/ora <<'LOGROTATEEOF'
/var/log/ora/*.log {
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

# Rsyslog config for rumahl services
if command -v rsyslogd >/dev/null 2>&1; then
    cat > /etc/rsyslog.d/50-ora.conf <<'RSYSLOGEOF'
# rumahl OS service logging
:programname, startswith, "rumahl-" /var/log/ora/services.log
& stop
RSYSLOGEOF
    systemctl restart rsyslog 2>/dev/null || true
fi

success "Logging: journald + rsyslog + logrotate configured"

# Health check script
cat > /usr/lib/ora/rumahl-health-check <<'HEALTHEOF'
#!/bin/bash
# rumahl Health Check – Monitors all rumahl services
LOG_TAG="rumahl-health"
LOG_FILE="/var/log/ora/health.log"

log() { 
    logger -t "$LOG_TAG" "$*"
    echo "[$(date -Iseconds)] $LOG_TAG: $*" >> "$LOG_FILE"
}

# Check all rumahl services
check_service() {
    local svc="$1"
    if ! systemctl is-active --quiet "${svc}.service" 2>/dev/null; then
        log "WARN: $svc is not running"
        return 1
    fi
    return 0
}

# Main health check
SERVICES="rumahl-core rumahl-home rumahl-assist rumahl-appstore rumahl-supervisor rumahl-gateway rumahl-security rumahl-files rumahl-secrets rumahl-control rumahl-watchdog rumahl-dev-bridge"

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
cat > /var/log/ora/status.json <<EOF
{
  "timestamp": "$(date -Iseconds)",
  "healthy": $HEALTHY,
  "unhealthy": $UNHEALTHY
}
EOF

exit 0
HEALTHEOF
chmod 755 /usr/lib/ora/rumahl-health-check

# Health check timer
cat > "${SVC_DIR}/rumahl-health-check.timer" <<'EOF'
[Unit]
Description=rumahl Health Check Timer

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
RandomizedDelaySec=10s

[Install]
WantedBy=timers.target
EOF

cat > "${SVC_DIR}/rumahl-health-check.service" <<'EOF'
[Unit]
Description=rumahl Health Check

[Service]
Type=oneshot
ExecStart=/usr/lib/ora/rumahl-health-check
StandardOutput=journal
StandardError=journal
EOF

ln -sf "${SVC_DIR}/rumahl-health-check.timer" "${SVC_DIR}/timers.target.wants/rumahl-health-check.timer" 2>/dev/null || true
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
check_svc "rumahl-netctl"           "FULL"
check_svc "rumahl-init-data"        "FULL"
check_svc "rumahl-db-init"          "FULL"
check_svc "rumahl-stack"            "FULL"
check_svc "rumahl-stack-watchdog"   "FULL"
check_svc "rumahl-setup"            "FULL"
check_svc "rumahl-data-unlock"      "FULL"
check_svc "rumahl-recovery"         "STUB"
check_svc "rumahl-integrity"        "STUB"
check_svc "rumahl-verify"           "STUB"
check_svc "rumahl-update-check"     "STUB"
check_svc "rumahl-tamper-screen"    "STUB"
check_svc "rumahl-health-check"     "FULL"
check_svc "rumahl-health-check.timer" "FULL"

# App services
for svc in "${!RUMAHL_PORTS[@]}"; do
    check_svc "$svc" "APP"
done

echo ""
log "Dev VM services match rumahl OS:"
log "  $(ls ${SVC_DIR}/rumahl-*.service 2>/dev/null | wc -l) rumahl service units created"
log "  FULL = fully functional | STUB = exists but no-op | APP = Rust binary unit"
echo ""
log "Binary paths: /usr/bin/rumahl-* (EXAKT wie rumahl OS)"
log "Run mode:     $RUN_MODE ($([ "$RUN_MODE" = "source" ] && echo 'cargo run from 1:1 mirror' || echo 'deployed binaries'))"
log "Data paths:   /opt/rumahl/data/<svc>/ (EXAKT wie rumahl OS)"
log "Config paths: /etc/ora/<svc>.env (EXAKT wie rumahl OS)"
echo ""
success "Service compatibility layer complete."
