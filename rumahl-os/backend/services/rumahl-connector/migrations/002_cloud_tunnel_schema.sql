-- Migration 002: Cloud Tunnel Schema (replaces WireGuard-based architecture)
-- Cloud relay works like Nabu Casa / Home Assistant Cloud:
-- rumahl Home connects OUTBOUND via WebSocket → relay proxies HTTP traffic

-- Tunnels: each rumahl Home instance gets one tunnel
CREATE TABLE IF NOT EXISTS cloud_tunnels (
    id              TEXT PRIMARY KEY NOT NULL,
    name            TEXT NOT NULL DEFAULT 'rumahl Home',
    description     TEXT,
    subdomain       TEXT NOT NULL UNIQUE,
    token_hash      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending',
    rumahl_version    TEXT,
    hostname        TEXT,
    last_seen       TEXT,
    connected_since TEXT,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);

-- Exposed services: which local ports should be proxied
CREATE TABLE IF NOT EXISTS exposed_services (
    id              TEXT PRIMARY KEY NOT NULL,
    tunnel_id       TEXT NOT NULL REFERENCES cloud_tunnels(id) ON DELETE CASCADE,
    service_name    TEXT NOT NULL,
    local_port      INTEGER NOT NULL,
    local_protocol  TEXT NOT NULL DEFAULT 'http',
    require_auth    INTEGER NOT NULL DEFAULT 0,
    rate_limit_rpm  INTEGER NOT NULL DEFAULT 120,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL
);

-- Access log for proxied requests
CREATE TABLE IF NOT EXISTS access_log (
    id                TEXT PRIMARY KEY NOT NULL,
    tunnel_id         TEXT NOT NULL,
    method            TEXT NOT NULL,
    path              TEXT NOT NULL,
    query_string      TEXT,
    source_ip         TEXT NOT NULL,
    user_agent        TEXT,
    status_code       INTEGER NOT NULL,
    response_time_ms  INTEGER NOT NULL,
    bytes_transferred INTEGER NOT NULL DEFAULT 0,
    created_at        TEXT NOT NULL
);

-- Pairing tokens: one-time tokens to connect a new rumahl instance
CREATE TABLE IF NOT EXISTS pairing_tokens (
    id              TEXT PRIMARY KEY NOT NULL,
    token_hash      TEXT NOT NULL,
    label           TEXT,
    created_by      TEXT NOT NULL,
    used_by_tunnel  TEXT,
    expires_at      TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_cloud_tunnels_subdomain ON cloud_tunnels(subdomain);
CREATE INDEX IF NOT EXISTS idx_cloud_tunnels_status ON cloud_tunnels(status);
CREATE INDEX IF NOT EXISTS idx_access_log_tunnel ON access_log(tunnel_id);
CREATE INDEX IF NOT EXISTS idx_access_log_created ON access_log(created_at);
CREATE INDEX IF NOT EXISTS idx_pairing_tokens_hash ON pairing_tokens(token_hash);
