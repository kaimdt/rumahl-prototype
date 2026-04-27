-- IORA Gateway Database Schema
-- Tracks all external integrations, requests, and security events

CREATE TABLE IF NOT EXISTS gateway_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT UNIQUE NOT NULL,
    request_type TEXT NOT NULL,  -- email, web_search, http_get, http_post
    requested_by TEXT NOT NULL,   -- service or AI that requested
    url TEXT,
    destination TEXT,             -- email address or search query
    request_data TEXT,            -- JSON of request parameters
    status TEXT NOT NULL,         -- pending, validated, executing, completed, failed, blocked
    created_at TEXT NOT NULL,
    completed_at TEXT,
    execution_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_requests_type ON gateway_requests(request_type);
CREATE INDEX IF NOT EXISTS idx_requests_status ON gateway_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_created ON gateway_requests(created_at DESC);

CREATE TABLE IF NOT EXISTS content_validations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    validation_type TEXT NOT NULL,  -- malware_scan, code_detection, html_sanitize, url_check
    is_safe BOOLEAN NOT NULL,
    threat_level INTEGER DEFAULT 0,  -- 0-10
    findings TEXT,                   -- JSON array of detected issues
    validated_at TEXT NOT NULL,
    FOREIGN KEY (request_id) REFERENCES gateway_requests(request_id)
);

CREATE INDEX IF NOT EXISTS idx_validation_request ON content_validations(request_id);
CREATE INDEX IF NOT EXISTS idx_validation_safe ON content_validations(is_safe);

CREATE TABLE IF NOT EXISTS sandbox_executions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    process_id INTEGER,
    sandbox_type TEXT NOT NULL,     -- process_isolation, chroot, container
    started_at TEXT NOT NULL,
    finished_at TEXT,
    exit_code INTEGER,
    timeout_triggered BOOLEAN DEFAULT 0,
    killed_by_system BOOLEAN DEFAULT 0,
    resource_usage TEXT,            -- JSON: cpu, memory, network
    FOREIGN KEY (request_id) REFERENCES gateway_requests(request_id)
);

CREATE INDEX IF NOT EXISTS idx_sandbox_request ON sandbox_executions(request_id);

CREATE TABLE IF NOT EXISTS blocked_content (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    block_reason TEXT NOT NULL,
    blocked_content_hash TEXT,
    threat_indicators TEXT,         -- JSON array
    blocked_at TEXT NOT NULL,
    reported_to_security BOOLEAN DEFAULT 1,
    FOREIGN KEY (request_id) REFERENCES gateway_requests(request_id)
);

CREATE INDEX IF NOT EXISTS idx_blocked_request ON blocked_content(request_id);
CREATE INDEX IF NOT EXISTS idx_blocked_at ON blocked_content(blocked_at DESC);

CREATE TABLE IF NOT EXISTS ai_request_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL,
    ai_service TEXT NOT NULL,       -- which AI made the request
    tool_requested TEXT NOT NULL,   -- email, search, http
    parameters TEXT NOT NULL,       -- JSON
    approved BOOLEAN NOT NULL,
    approval_reason TEXT,
    logged_at TEXT NOT NULL,
    FOREIGN KEY (request_id) REFERENCES gateway_requests(request_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_request ON ai_request_log(request_id);
CREATE INDEX IF NOT EXISTS idx_ai_service ON ai_request_log(ai_service);

CREATE TABLE IF NOT EXISTS url_whitelist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    domain TEXT UNIQUE NOT NULL,
    pattern TEXT,                   -- regex pattern for URL matching
    added_by TEXT NOT NULL,
    added_at TEXT NOT NULL,
    expires_at TEXT,
    is_active BOOLEAN DEFAULT 1,
    description TEXT
);

CREATE INDEX IF NOT EXISTS idx_whitelist_domain ON url_whitelist(domain);
CREATE INDEX IF NOT EXISTS idx_whitelist_active ON url_whitelist(is_active);

CREATE TABLE IF NOT EXISTS update_verifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    package_name TEXT NOT NULL,
    version TEXT NOT NULL,
    download_url TEXT NOT NULL,
    checksum_type TEXT NOT NULL,    -- sha256, sha512
    expected_checksum TEXT NOT NULL,
    actual_checksum TEXT,
    signature TEXT,                 -- PGP signature if available
    verification_status TEXT NOT NULL,  -- pending, valid, invalid, tampered
    verified_at TEXT NOT NULL,
    installed BOOLEAN DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_updates_package ON update_verifications(package_name);
CREATE INDEX IF NOT EXISTS idx_updates_status ON update_verifications(verification_status);

CREATE TABLE IF NOT EXISTS rate_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service_name TEXT NOT NULL,
    request_type TEXT NOT NULL,
    requests_per_hour INTEGER NOT NULL,
    requests_per_day INTEGER NOT NULL,
    current_hour_count INTEGER DEFAULT 0,
    current_day_count INTEGER DEFAULT 0,
    last_reset_hour TEXT,
    last_reset_day TEXT,
    UNIQUE(service_name, request_type)
);

CREATE INDEX IF NOT EXISTS idx_rate_service ON rate_limits(service_name);
