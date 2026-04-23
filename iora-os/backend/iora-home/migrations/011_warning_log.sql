-- Warning log: tracks when warnings were active and displayed
CREATE TABLE IF NOT EXISTS warning_log (
    id BIGSERIAL PRIMARY KEY,
    entity_id TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    level TEXT NOT NULL DEFAULT 'info',
    source TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at TIMESTAMPTZ,
    attributes_json TEXT NOT NULL DEFAULT '{}',
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_warning_log_entity ON warning_log(entity_id);
CREATE INDEX IF NOT EXISTS idx_warning_log_started ON warning_log(started_at);
CREATE INDEX IF NOT EXISTS idx_warning_log_active ON warning_log(ended_at);
