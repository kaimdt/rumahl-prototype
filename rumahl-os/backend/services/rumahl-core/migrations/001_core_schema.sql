-- rumahl Core database schema
-- Stores system-wide analytics, task results, and inter-service data

-- Background task registry
CREATE TABLE IF NOT EXISTS background_tasks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    task_type TEXT NOT NULL,              -- 'periodic', 'event_driven', 'scheduled'
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    interval_seconds INTEGER,            -- for periodic tasks
    last_run_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_error TEXT,
    run_count INTEGER NOT NULL DEFAULT 0,
    error_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- System-wide analytics snapshots
CREATE TABLE IF NOT EXISTS analytics_snapshots (
    id BIGSERIAL PRIMARY KEY,
    snapshot_type TEXT NOT NULL,         -- 'system', 'persons', 'entities', 'automations'
    data JSONB NOT NULL,
    captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_snapshots_type ON analytics_snapshots(snapshot_type, captured_at DESC);

-- Inter-service messages / events log
CREATE TABLE IF NOT EXISTS system_events_log (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    source TEXT NOT NULL,
    payload JSONB,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_events_log_type ON system_events_log(event_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_events_log_unprocessed ON system_events_log(created_at) WHERE processed = FALSE;
