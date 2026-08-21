-- rumahl Security Database Schema
-- This database is encrypted and stores all security-related events
-- WARNING: This file will be executed on an encrypted SQLite database

-- Security events log (immutable, hash-chained for integrity)
CREATE TABLE IF NOT EXISTS security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    event_type TEXT NOT NULL,  -- connection, auth, intrusion, anomaly, lockdown, user_rotation
    severity TEXT NOT NULL,     -- info, warning, critical
    source_ip TEXT,
    service_name TEXT,
    user_id TEXT,
    event_data TEXT,           -- JSON containing encrypted sensitive data
    hash TEXT NOT NULL,        -- SHA-256 hash of this record
    prev_hash TEXT,            -- Previous record's hash (blockchain-style)
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_events_timestamp ON security_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_events_type ON security_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_severity ON security_events(severity);
CREATE INDEX IF NOT EXISTS idx_events_source_ip ON security_events(source_ip);

-- PostgreSQL database connections tracking
CREATE TABLE IF NOT EXISTS database_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    connection_id TEXT,
    pid INTEGER,
    source_ip TEXT,
    database_name TEXT,
    username TEXT,
    application_name TEXT,
    is_authorized BOOLEAN NOT NULL DEFAULT 0,
    query_count INTEGER DEFAULT 0,
    connected_at TEXT,
    terminated_at TEXT,
    termination_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_conn_source_ip ON database_connections(source_ip);
CREATE INDEX IF NOT EXISTS idx_conn_username ON database_connections(username);
CREATE INDEX IF NOT EXISTS idx_conn_authorized ON database_connections(is_authorized);

-- Threat intelligence and IP reputation
CREATE TABLE IF NOT EXISTS threat_intelligence (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT UNIQUE NOT NULL,
    threat_level INTEGER NOT NULL DEFAULT 0,  -- 0-10 scale
    first_seen TEXT NOT NULL,
    last_seen TEXT NOT NULL,
    incident_count INTEGER NOT NULL DEFAULT 0,
    failed_auth_count INTEGER DEFAULT 0,
    sql_injection_attempts INTEGER DEFAULT 0,
    rate_limit_violations INTEGER DEFAULT 0,
    blocked BOOLEAN NOT NULL DEFAULT 0,
    blocked_at TEXT,
    notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_threat_ip ON threat_intelligence(ip_address);
CREATE INDEX IF NOT EXISTS idx_threat_level ON threat_intelligence(threat_level DESC);
CREATE INDEX IF NOT EXISTS idx_threat_blocked ON threat_intelligence(blocked);

-- System lockdown events
CREATE TABLE IF NOT EXISTS system_lockdowns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    triggered_at TEXT NOT NULL,
    trigger_reason TEXT NOT NULL,
    trigger_event_id INTEGER,
    lockdown_level INTEGER NOT NULL,  -- 1=warning, 2=suspicious, 3=confirmed, 4=critical
    affected_services TEXT,           -- JSON array of service names
    released_at TEXT,
    released_by TEXT,                 -- Admin user who released
    auto_released BOOLEAN DEFAULT 0,
    duration_seconds INTEGER
);

CREATE INDEX IF NOT EXISTS idx_lockdown_triggered ON system_lockdowns(triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_lockdown_level ON system_lockdowns(lockdown_level DESC);

-- PostgreSQL user management and rotation
CREATE TABLE IF NOT EXISTS postgres_users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    service_name TEXT NOT NULL,
    database_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    rotated_at TEXT,
    rotation_count INTEGER DEFAULT 0,
    next_rotation_due TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1,
    password_hash TEXT NOT NULL,     -- Encrypted password for audit
    permissions TEXT NOT NULL        -- JSON array of granted permissions
);

CREATE INDEX IF NOT EXISTS idx_pguser_service ON postgres_users(service_name);
CREATE INDEX IF NOT EXISTS idx_pguser_active ON postgres_users(is_active);
CREATE INDEX IF NOT EXISTS idx_pguser_rotation ON postgres_users(next_rotation_due);

-- Authorized IP whitelist
CREATE TABLE IF NOT EXISTS ip_whitelist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT UNIQUE NOT NULL,
    ip_range TEXT,                   -- CIDR notation if applicable
    description TEXT,
    added_by TEXT,
    added_at TEXT NOT NULL,
    expires_at TEXT,
    is_active BOOLEAN NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_whitelist_ip ON ip_whitelist(ip_address);
CREATE INDEX IF NOT EXISTS idx_whitelist_active ON ip_whitelist(is_active);

-- Anomaly detection baselines
CREATE TABLE IF NOT EXISTS activity_baselines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_name TEXT NOT NULL,
    metric_type TEXT NOT NULL,      -- request_rate, db_queries, connection_count, etc.
    hour_of_day INTEGER,             -- 0-23 for time-based patterns
    day_of_week INTEGER,             -- 0-6 for weekly patterns
    baseline_value REAL NOT NULL,
    std_deviation REAL,
    last_updated TEXT NOT NULL,
    sample_count INTEGER DEFAULT 0,
    UNIQUE(service_name, metric_type, hour_of_day, day_of_week)
);

CREATE INDEX IF NOT EXISTS idx_baseline_service ON activity_baselines(service_name);

-- Database integrity verification
CREATE TABLE IF NOT EXISTS integrity_checksums (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    record_count INTEGER NOT NULL,
    verified_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_checksum_table ON integrity_checksums(table_name);
CREATE INDEX IF NOT EXISTS idx_checksum_verified ON integrity_checksums(verified_at DESC);

-- Alert notifications queue
CREATE TABLE IF NOT EXISTS pending_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    alert_type TEXT NOT NULL,
    severity TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    event_id INTEGER,
    created_at TEXT NOT NULL,
    sent_at TEXT,
    acknowledged_at TEXT,
    acknowledged_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_pending ON pending_alerts(sent_at) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON pending_alerts(severity);
