-- Warning log: tracks when warnings were active and displayed
CREATE TABLE IF NOT EXISTS warning_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    level TEXT NOT NULL DEFAULT 'info',
    source TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    acknowledged INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_warning_log_entity ON warning_log(entity_id);
CREATE INDEX IF NOT EXISTS idx_warning_log_started ON warning_log(started_at);
CREATE INDEX IF NOT EXISTS idx_warning_log_active ON warning_log(ended_at);
