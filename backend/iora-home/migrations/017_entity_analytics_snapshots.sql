CREATE TABLE IF NOT EXISTS entity_analytics_snapshots (
    id SERIAL PRIMARY KEY,
    recorded_at TIMESTAMPTZ NOT NULL,
    total_entities INTEGER NOT NULL,
    unavailable_count INTEGER NOT NULL,
    stale_count INTEGER NOT NULL,
    total_state_changes INTEGER NOT NULL,
    most_active_entity TEXT,
    most_active_changes INTEGER DEFAULT 0
);
