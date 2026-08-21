-- rumahl Connector: Schema for tunnel management and service exposure
-- Migration 001: Initial schema

-- Registered rumahl instances that connect via VPN tunnel
CREATE TABLE IF NOT EXISTS tunnels (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    -- WireGuard peer config
    peer_public_key TEXT NOT NULL,
    peer_endpoint TEXT, -- IP:port of the rumahl home instance (auto-detected)
    assigned_ip TEXT NOT NULL UNIQUE, -- VPN-internal IP (e.g. 10.100.0.x)
    -- Status
    status TEXT NOT NULL DEFAULT 'disconnected', -- 'connected', 'disconnected', 'error'
    last_handshake TEXT,
    last_seen TEXT,
    bytes_sent INTEGER NOT NULL DEFAULT 0,
    bytes_received INTEGER NOT NULL DEFAULT 0,
    -- Authentication
    auth_token_hash TEXT NOT NULL, -- SHA-256 of the pairing token
    -- Metadata
    rumahl_version TEXT,
    hostname TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tunnels_status ON tunnels(status);
CREATE INDEX IF NOT EXISTS idx_tunnels_auth ON tunnels(auth_token_hash);

-- Services exposed through the connector
CREATE TABLE IF NOT EXISTS exposed_services (
    id TEXT PRIMARY KEY NOT NULL,
    tunnel_id TEXT NOT NULL,
    -- Service definition
    service_name TEXT NOT NULL, -- e.g. 'dashboard', 'api', 'files', 'assist'
    local_port INTEGER NOT NULL, -- port on the rumahl instance (via VPN)
    local_protocol TEXT NOT NULL DEFAULT 'http', -- 'http', 'https', 'tcp', 'ws'
    -- Public exposure
    public_subdomain TEXT, -- e.g. 'myhouse' -> myhouse.rumahl-connect.example.com
    public_path TEXT NOT NULL DEFAULT '/', -- path prefix
    public_port INTEGER, -- NULL = use default (443)
    -- Access control
    require_auth INTEGER NOT NULL DEFAULT 1,
    allowed_ips TEXT, -- JSON array of allowed CIDR ranges (NULL = all)
    allowed_users TEXT, -- JSON array of user IDs (NULL = all authenticated)
    rate_limit_rpm INTEGER NOT NULL DEFAULT 120, -- requests per minute
    -- TLS
    tls_enabled INTEGER NOT NULL DEFAULT 1,
    custom_domain TEXT, -- custom domain with user's own TLS cert
    -- Status
    is_active INTEGER NOT NULL DEFAULT 1,
    health_status TEXT NOT NULL DEFAULT 'unknown', -- 'healthy', 'degraded', 'unhealthy', 'unknown'
    last_health_check TEXT,
    -- Metadata
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (tunnel_id) REFERENCES tunnels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_exposed_services_tunnel ON exposed_services(tunnel_id);
CREATE INDEX IF NOT EXISTS idx_exposed_services_subdomain ON exposed_services(public_subdomain);
CREATE UNIQUE INDEX IF NOT EXISTS idx_exposed_services_unique_route ON exposed_services(public_subdomain, public_path);

-- Access log for public requests
CREATE TABLE IF NOT EXISTS access_log (
    id TEXT PRIMARY KEY NOT NULL,
    service_id TEXT NOT NULL,
    tunnel_id TEXT NOT NULL,
    -- Request info
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    query_string TEXT,
    source_ip TEXT NOT NULL,
    user_agent TEXT,
    -- Auth
    authenticated_user TEXT,
    -- Response
    status_code INTEGER NOT NULL,
    response_time_ms INTEGER NOT NULL,
    bytes_transferred INTEGER NOT NULL DEFAULT 0,
    -- Metadata
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (service_id) REFERENCES exposed_services(id) ON DELETE CASCADE,
    FOREIGN KEY (tunnel_id) REFERENCES tunnels(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_access_log_service ON access_log(service_id);
CREATE INDEX IF NOT EXISTS idx_access_log_time ON access_log(created_at);
CREATE INDEX IF NOT EXISTS idx_access_log_ip ON access_log(source_ip);

-- Blocked IPs (DDoS / abuse protection)
CREATE TABLE IF NOT EXISTS blocked_ips (
    ip TEXT PRIMARY KEY NOT NULL,
    reason TEXT NOT NULL,
    blocked_until TEXT, -- NULL = permanent
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pairing tokens for new tunnel registrations
CREATE TABLE IF NOT EXISTS pairing_tokens (
    id TEXT PRIMARY KEY NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    label TEXT,
    created_by TEXT NOT NULL,
    used_by_tunnel TEXT,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pairing_tokens_hash ON pairing_tokens(token_hash);

-- Connector configuration
CREATE TABLE IF NOT EXISTS connector_config (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Insert defaults
INSERT OR IGNORE INTO connector_config (key, value) VALUES
    ('wireguard_listen_port', '51820'),
    ('wireguard_interface', 'wg-rumahl'),
    ('vpn_subnet', '10.100.0.0/24'),
    ('server_public_ip', ''),
    ('default_domain', 'rumahl-connect.local'),
    ('max_tunnels', '50'),
    ('max_services_per_tunnel', '20'),
    ('global_rate_limit_rpm', '1000'),
    ('auto_tls', 'true'),
    ('acme_email', ''),
    ('health_check_interval_seconds', '30');
