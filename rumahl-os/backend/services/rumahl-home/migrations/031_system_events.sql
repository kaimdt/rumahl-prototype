-- Migration 031: Persistent system event log
--
-- Stores every error / warning / info raised by background tasks, request
-- handlers, the tracing layer, and client-side reporters.
--
-- Design notes:
--   * `system_event_groups` is the de-duplicated view. The (severity, source,
--     message) fingerprint collapses repeated identical errors into a single
--     row with a `count` so a flapping subsystem doesn't bloat storage.
--   * `system_event_occurrences` keeps every individual occurrence with full
--     contextual metadata so the admin can drill into the raw history — this
--     is the "log" view where everything stays separate, as requested.
--   * Both tables index by `(last_seen / occurred_at) DESC` because the UI
--     always shows newest first.

CREATE TABLE IF NOT EXISTS system_event_groups (
    fingerprint TEXT PRIMARY KEY,
    severity TEXT NOT NULL,                  -- 'error' | 'warning' | 'info'
    source TEXT NOT NULL,                    -- logical subsystem
    message TEXT NOT NULL,
    count BIGINT NOT NULL DEFAULT 1,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_details JSONB,                      -- most recent occurrence metadata
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_system_event_groups_last_seen
    ON system_event_groups(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_system_event_groups_severity_last_seen
    ON system_event_groups(severity, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_system_event_groups_unresolved
    ON system_event_groups(resolved, last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_system_event_groups_source
    ON system_event_groups(source, last_seen DESC);

CREATE TABLE IF NOT EXISTS system_event_occurrences (
    id BIGSERIAL PRIMARY KEY,
    fingerprint TEXT NOT NULL REFERENCES system_event_groups(fingerprint) ON DELETE CASCADE,
    severity TEXT NOT NULL,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    details JSONB,                           -- per-occurrence metadata
    -- Inline copies of common metadata for fast filtering without JSON parsing
    origin TEXT NOT NULL DEFAULT 'backend',  -- 'backend' | 'frontend' | 'tracing'
    user_id TEXT,
    request_path TEXT,
    request_method TEXT,
    status_code INTEGER,
    file TEXT,
    line INTEGER,
    target TEXT,                             -- tracing target / module path
    error_chain TEXT,                        -- formatted error cause chain
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_event_occurrences_fingerprint_time
    ON system_event_occurrences(fingerprint, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_event_occurrences_time
    ON system_event_occurrences(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_event_occurrences_severity_time
    ON system_event_occurrences(severity, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_event_occurrences_origin
    ON system_event_occurrences(origin, occurred_at DESC);
