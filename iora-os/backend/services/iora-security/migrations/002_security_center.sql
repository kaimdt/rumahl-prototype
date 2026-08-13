CREATE TABLE IF NOT EXISTS security_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    threat_type TEXT NOT NULL,
    minimum_severity TEXT NOT NULL,
    actions TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scanner_providers (
    provider_id TEXT PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'auto',
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scan_jobs (
    id TEXT PRIMARY KEY,
    target TEXT NOT NULL,
    providers TEXT NOT NULL,
    status TEXT NOT NULL,
    result TEXT,
    requested_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS quarantine_items (
    id TEXT PRIMARY KEY,
    original_path TEXT NOT NULL,
    threat_type TEXT NOT NULL,
    reason TEXT NOT NULL,
    provider TEXT,
    quarantined_at TEXT NOT NULL,
    released_at TEXT,
    released_by TEXT
);

INSERT OR IGNORE INTO scanner_providers(provider_id, enabled, priority, mode, updated_at) VALUES
('internal', 1, 10, 'auto', datetime('now')),
('yara', 1, 20, 'auto', datetime('now')),
('clamav', 1, 30, 'auto', datetime('now'));

INSERT OR IGNORE INTO security_policies(id, name, threat_type, minimum_severity, actions, enabled, updated_at) VALUES
('default-malware', 'Default malware containment', 'malware', 'high', '["log","alert","quarantine"]', 1, datetime('now')),
('default-network', 'Default network attack containment', 'network_attack', 'medium', '["log","alert","temporary_block"]', 1, datetime('now')),
('critical-integrity', 'Critical OS integrity protection', 'critical_integrity', 'critical', '["log","alert","quarantine","lockdown"]', 1, datetime('now')),
('suspicious-script', 'Suspicious script execution', 'script_execution', 'high', '["log","alert","stop_process"]', 1, datetime('now'));
