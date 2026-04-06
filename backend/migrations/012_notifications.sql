-- Persistent notification storage
CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    level TEXT NOT NULL DEFAULT 'info',
    source TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    read INTEGER NOT NULL DEFAULT 0,
    auto_dismiss_secs INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
