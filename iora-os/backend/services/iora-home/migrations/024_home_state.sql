-- 024_home_state.sql
-- Persists in-memory home state maps (dashboard settings, composite sensors,
-- smart scenes, scheduled actions, entity watchdogs, active emergency)
-- across iora-home restarts. Each row is a single JSON blob keyed by scope.

CREATE TABLE IF NOT EXISTS home_state (
    scope TEXT PRIMARY KEY,
    data JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
