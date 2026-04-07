-- Active NINA warnings cache — survives backend restarts
CREATE TABLE IF NOT EXISTS nina_warning_cache (
    id TEXT PRIMARY KEY,
    warning_json TEXT NOT NULL,
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
