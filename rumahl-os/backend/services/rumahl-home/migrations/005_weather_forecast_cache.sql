-- Weather forecast cache
CREATE TABLE IF NOT EXISTS weather_forecast_cache (
    id BIGSERIAL PRIMARY KEY,
    entity_id TEXT NOT NULL,
    forecast_type TEXT NOT NULL DEFAULT 'daily',  -- 'daily' or 'hourly'
    forecast_data TEXT NOT NULL,                   -- JSON array of forecast entries
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(entity_id, forecast_type)
);
