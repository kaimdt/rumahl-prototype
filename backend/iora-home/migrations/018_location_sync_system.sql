-- Location history GPS points: stores individual lat/lng positions over time
-- This is separate from person_location_history which tracks state transitions (home/away)
-- This table stores raw GPS coordinates for drawing movement trails on the map
CREATE TABLE IF NOT EXISTS location_history_points (
    id BIGSERIAL PRIMARY KEY,
    entity_id TEXT NOT NULL,              -- e.g. "person.alice", "device_tracker.phone"
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    gps_accuracy INTEGER,
    state TEXT,                            -- e.g. "home", "not_home", zone name
    source TEXT,                           -- "gps", "router", etc.
    recorded_at TIMESTAMPTZ NOT NULL,      -- when HA recorded this state
    synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW()  -- when we synced it from HA
);

CREATE INDEX IF NOT EXISTS idx_lhp_entity_time ON location_history_points(entity_id, recorded_at);
CREATE INDEX IF NOT EXISTS idx_lhp_recorded ON location_history_points(recorded_at);
-- Prevent duplicate entries
CREATE UNIQUE INDEX IF NOT EXISTS idx_lhp_entity_unique ON location_history_points(entity_id, recorded_at, latitude, longitude);

-- Per-entity sync status: tracks when we last synced history for each entity
CREATE TABLE IF NOT EXISTS location_sync_status (
    entity_id TEXT PRIMARY KEY,
    friendly_name TEXT NOT NULL DEFAULT '',
    last_sync_at TIMESTAMPTZ,              -- when we last successfully synced
    oldest_data_at TIMESTAMPTZ,            -- oldest data point we have
    newest_data_at TIMESTAMPTZ,            -- newest data point we have
    total_points INTEGER NOT NULL DEFAULT 0,
    sync_state TEXT NOT NULL DEFAULT 'pending',  -- pending, syncing, synced, error, gap_detected
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Admin system notifications: system-level alerts visible only to admins
CREATE TABLE IF NOT EXISTS admin_system_notifications (
    id TEXT PRIMARY KEY,
    category TEXT NOT NULL DEFAULT 'system', -- sync, system, security, maintenance
    severity TEXT NOT NULL DEFAULT 'info',    -- info, warning, error, critical
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    details JSONB,                            -- extra structured data
    source TEXT NOT NULL DEFAULT 'system',    -- which subsystem generated it
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    acknowledged_by TEXT,                     -- user_id who acknowledged
    acknowledged_at TIMESTAMPTZ,
    auto_resolve BOOLEAN NOT NULL DEFAULT FALSE,
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_asn_category ON admin_system_notifications(category);
CREATE INDEX IF NOT EXISTS idx_asn_severity ON admin_system_notifications(severity);
CREATE INDEX IF NOT EXISTS idx_asn_created ON admin_system_notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asn_unresolved ON admin_system_notifications(resolved, created_at DESC);
