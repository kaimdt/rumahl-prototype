-- rumahl API: Schema for connected clients, subscriptions, and API metrics
-- Migration 001: Initial schema

-- MQTT subscriptions (bridge to Home Assistant MQTT)
CREATE TABLE IF NOT EXISTS mqtt_subscriptions (
    id TEXT PRIMARY KEY NOT NULL,
    client_id TEXT NOT NULL,
    topic TEXT NOT NULL,
    qos INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_mqtt_subs_client ON mqtt_subscriptions(client_id);
CREATE INDEX IF NOT EXISTS idx_mqtt_subs_topic ON mqtt_subscriptions(topic);

-- GraphQL persisted queries (APQ)
CREATE TABLE IF NOT EXISTS persisted_queries (
    hash TEXT PRIMARY KEY NOT NULL,
    query_text TEXT NOT NULL,
    operation_name TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_used TEXT NOT NULL DEFAULT (datetime('now')),
    use_count INTEGER NOT NULL DEFAULT 0
);

-- WebDAV locks
CREATE TABLE IF NOT EXISTS webdav_locks (
    id TEXT PRIMARY KEY NOT NULL,
    resource_path TEXT NOT NULL,
    lock_type TEXT NOT NULL DEFAULT 'write', -- 'write' or 'read'
    lock_scope TEXT NOT NULL DEFAULT 'exclusive', -- 'exclusive' or 'shared'
    owner TEXT NOT NULL,
    depth TEXT NOT NULL DEFAULT '0', -- '0' or 'infinity'
    timeout_seconds INTEGER NOT NULL DEFAULT 3600,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webdav_locks_resource ON webdav_locks(resource_path);
CREATE INDEX IF NOT EXISTS idx_webdav_locks_token ON webdav_locks(token);

-- API metrics
CREATE TABLE IF NOT EXISTS api_metrics (
    id TEXT PRIMARY KEY NOT NULL,
    interface_type TEXT NOT NULL, -- 'graphql', 'webdav', 'mqtt', 'caldav', 'rest'
    operation TEXT NOT NULL,
    user_id TEXT,
    duration_ms INTEGER NOT NULL,
    status TEXT NOT NULL, -- 'success', 'error', 'timeout'
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_api_metrics_type ON api_metrics(interface_type);
CREATE INDEX IF NOT EXISTS idx_api_metrics_time ON api_metrics(created_at);

-- CalDAV calendars (mapping to HA calendar entities)
CREATE TABLE IF NOT EXISTS caldav_calendars (
    id TEXT PRIMARY KEY NOT NULL,
    entity_id TEXT NOT NULL UNIQUE, -- HA calendar entity
    display_name TEXT NOT NULL,
    color TEXT,
    owner_id TEXT NOT NULL,
    is_shared INTEGER NOT NULL DEFAULT 0,
    sync_token TEXT NOT NULL DEFAULT '0',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_caldav_calendars_entity ON caldav_calendars(entity_id);
CREATE INDEX IF NOT EXISTS idx_caldav_calendars_owner ON caldav_calendars(owner_id);
