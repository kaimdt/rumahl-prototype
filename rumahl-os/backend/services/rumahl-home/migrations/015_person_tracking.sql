-- Person location history for long-term analytics
-- Tracks when and where persons were detected via Home Assistant

CREATE TABLE IF NOT EXISTS person_location_history (
    id BIGSERIAL PRIMARY KEY,
    person_entity_id TEXT NOT NULL,        -- e.g., "person.alice"
    person_name TEXT NOT NULL,             -- human readable name
    location_state TEXT NOT NULL,          -- e.g., "home", "work", "away", zone name
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    gps_accuracy INTEGER,
    source TEXT,                           -- "gps", "router", "bluetooth", etc.
    attributes JSONB,                      -- full HA attributes blob
    started_at TIMESTAMPTZ NOT NULL,       -- when they arrived at this location
    ended_at TIMESTAMPTZ,                  -- NULL = still there
    duration_seconds INTEGER               -- filled in when ended_at is set
);

CREATE INDEX IF NOT EXISTS idx_person_location_entity ON person_location_history(person_entity_id);
CREATE INDEX IF NOT EXISTS idx_person_location_started ON person_location_history(started_at);
CREATE INDEX IF NOT EXISTS idx_person_location_state ON person_location_history(person_entity_id, location_state);
CREATE INDEX IF NOT EXISTS idx_person_location_open ON person_location_history(person_entity_id) WHERE ended_at IS NULL;

-- Daily summary: aggregated view of a person's locations per day
CREATE TABLE IF NOT EXISTS person_daily_summary (
    id BIGSERIAL PRIMARY KEY,
    person_entity_id TEXT NOT NULL,
    summary_date DATE NOT NULL,
    location_breakdown JSONB NOT NULL,     -- {"home": 14400, "work": 28800, "away": 3600} (seconds)
    most_visited_location TEXT,
    time_at_home_seconds INTEGER NOT NULL DEFAULT 0,
    first_departure_at TIMESTAMPTZ,
    last_return_at TIMESTAMPTZ,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(person_entity_id, summary_date)
);

CREATE INDEX IF NOT EXISTS idx_person_daily_summary_entity ON person_daily_summary(person_entity_id);
CREATE INDEX IF NOT EXISTS idx_person_daily_summary_date ON person_daily_summary(summary_date DESC);
