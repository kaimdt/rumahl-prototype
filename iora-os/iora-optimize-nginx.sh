#!/bin/bash
# ============================================================================
# iora-optimize-nginx.sh – Nginx Performance Optimization for IORA OS
# ============================================================================
# Optimizes nginx configuration for better performance and lower latency.
#
# Usage: sudo ./iora-optimize-nginx.sh
# ============================================================================

set -euo pipefail

GREEN='\033[0;32m'; BLUE='\033[0;34m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()    { echo -e "${BLUE}[nginx-opt]${NC} $*"; }
success(){ echo -e "${GREEN}[nginx-opt]${NC} $*"; }
warn()   { echo -e "${YELLOW}[nginx-opt]${NC} $*"; }

# Must run as root
if [ "$(id -u)" -ne 0 ]; then
    echo "ERROR: Must run as root: sudo ./iora-optimize-nginx.sh"
    exit 1
fi

if ! command -v nginx >/dev/null 2>&1; then
    warn "Nginx not installed, skipping optimization"
    exit 0
fi

log "Optimizing nginx configuration..."

# Detect CPU cores
CPU_CORES=$(nproc 2>/dev/null || echo "2")
WORKER_CONNECTIONS=2048

# Calculate optimal worker_connections based on system resources
TOTAL_RAM_MB=$(awk '/MemTotal/{printf "%.0f", $2/1024}' /proc/meminfo 2>/dev/null || echo "4096")
if [ $TOTAL_RAM_MB -ge 8192 ]; then
    WORKER_CONNECTIONS=4096
elif [ $TOTAL_RAM_MB -ge 4096 ]; then
    WORKER_CONNECTIONS=2048
else
    WORKER_CONNECTIONS=1024
fi

log "System: ${CPU_CORES} cores, ${TOTAL_RAM_MB}MB RAM"
log "Nginx workers: ${CPU_CORES}, connections per worker: ${WORKER_CONNECTIONS}"

# ═══════════════════════════════════════════════════════════════════════════════
# Global nginx optimization
# ═══════════════════════════════════════════════════════════════════════════════

cat > /etc/nginx/nginx.conf <<EOF
# IORA OS Nginx Configuration (Optimized)
user www-data;
worker_processes ${CPU_CORES};
worker_rlimit_nofile 65535;
pid /run/nginx.pid;

events {
    worker_connections ${WORKER_CONNECTIONS};
    use epoll;
    multi_accept on;
}

http {
    ##
    # Basic Settings
    ##
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    keepalive_requests 100;
    types_hash_max_size 2048;
    server_tokens off;

    # Increase buffer sizes for better performance
    client_body_buffer_size 128k;
    client_max_body_size 100m;
    client_header_buffer_size 1k;
    large_client_header_buffers 4 16k;

    # Timeouts
    client_body_timeout 12;
    client_header_timeout 12;
    send_timeout 10;

    # File caching
    open_file_cache max=10000 inactive=30s;
    open_file_cache_valid 60s;
    open_file_cache_min_uses 2;
    open_file_cache_errors on;

    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    ##
    # SSL Settings
    ##
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_session_tickets off;

    ##
    # Logging Settings
    ##
    access_log /var/log/nginx/access.log combined buffer=32k flush=5s;
    error_log /var/log/nginx/error.log warn;

    ##
    # Gzip Settings
    ##
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 5;
    gzip_min_length 256;
    gzip_types
        application/atom+xml
        application/javascript
        application/json
        application/ld+json
        application/manifest+json
        application/rss+xml
        application/vnd.geo+json
        application/vnd.ms-fontobject
        application/x-font-ttf
        application/x-web-app-manifest+json
        application/xhtml+xml
        application/xml
        font/opentype
        image/bmp
        image/svg+xml
        image/x-icon
        text/cache-manifest
        text/css
        text/plain
        text/vcard
        text/vnd.rim.location.xloc
        text/vtt
        text/x-component
        text/x-cross-domain-policy;

    ##
    # Virtual Host Configs
    ##
    include /etc/nginx/conf.d/*.conf;
    include /etc/nginx/sites-enabled/*;
}
EOF

success "Nginx main configuration optimized"

# ═══════════════════════════════════════════════════════════════════════════════
# Add performance tuning directives
# ═══════════════════════════════════════════════════════════════════════════════

mkdir -p /etc/nginx/conf.d

cat > /etc/nginx/conf.d/performance.conf <<'EOF'
# IORA OS Nginx Performance Tuning

# Proxy optimizations
proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_buffering on;
proxy_buffer_size 4k;
proxy_buffers 8 4k;
proxy_busy_buffers_size 8k;
proxy_connect_timeout 10s;
proxy_send_timeout 60s;
proxy_read_timeout 60s;

# Cache settings for static content
map $sent_http_content_type $expires {
    default                    off;
    text/html                  epoch;
    text/css                   max;
    application/javascript     max;
    ~image/                    max;
    ~font/                     max;
}
expires $expires;
EOF

success "Performance tuning directives added"

# ═══════════════════════════════════════════════════════════════════════════════
# Systemd optimizations
# ═══════════════════════════════════════════════════════════════════════════════

mkdir -p /etc/systemd/system/nginx.service.d

cat > /etc/systemd/system/nginx.service.d/performance.conf <<EOF
[Service]
# Increase file descriptor limit
LimitNOFILE=65535

# Faster restarts
RestartSec=2

# Resource limits (generous for high-traffic scenarios)
MemoryMax=2G
CPUQuota=200%
EOF

success "Systemd service optimizations applied"

# ═══════════════════════════════════════════════════════════════════════════════
# Test and reload
# ═══════════════════════════════════════════════════════════════════════════════

log "Testing nginx configuration..."
if nginx -t; then
    success "Nginx configuration is valid"

    systemctl daemon-reload 2>/dev/null || true

    if systemctl is-active --quiet nginx 2>/dev/null; then
        systemctl reload nginx 2>/dev/null || systemctl restart nginx 2>/dev/null
        success "Nginx reloaded with new configuration"
    else
        systemctl enable nginx 2>/dev/null || true
        systemctl start nginx 2>/dev/null || true
        success "Nginx started with optimized configuration"
    fi
else
    warn "Nginx configuration test failed - please check manually with 'nginx -t'"
    exit 1
fi

echo ""
log "Nginx optimization complete!"
log "  Workers: ${CPU_CORES}"
log "  Connections per worker: ${WORKER_CONNECTIONS}"
log "  Total capacity: $((CPU_CORES * WORKER_CONNECTIONS)) concurrent connections"
log "  Gzip compression: enabled"
log "  HTTP keepalive: enabled"
log "  Proxy buffering: optimized"
echo ""
success "Nginx is now optimized for ${TOTAL_RAM_MB}MB / ${CPU_CORES}-core system"
