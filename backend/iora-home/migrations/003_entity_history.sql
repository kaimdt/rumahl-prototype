-- Entity history for local caching of HA state changes
CREATE TABLE IF NOT EXISTS entity_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    state TEXT NOT NULL,
    attributes TEXT,
    last_changed TEXT NOT NULL,
    recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entity_history_entity_time
    ON entity_history(entity_id, recorded_at);

CREATE INDEX IF NOT EXISTS idx_entity_history_recorded
    ON entity_history(recorded_at);
