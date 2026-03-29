-- Global system preferences (shared across all users)
CREATE TABLE IF NOT EXISTS system_preferences (
    id TEXT PRIMARY KEY,
    preference_key TEXT NOT NULL UNIQUE,
    preference_value TEXT NOT NULL, -- JSON value
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_system_preferences_key ON system_preferences(preference_key);
