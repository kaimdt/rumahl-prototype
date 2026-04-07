-- Weather forecast cache
CREATE TABLE IF NOT EXISTS weather_forecast_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    entity_id TEXT NOT NULL,
    forecast_type TEXT NOT NULL DEFAULT 'daily',  -- 'daily' or 'hourly'
    forecast_data TEXT NOT NULL,                   -- JSON array of forecast entries
    fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(entity_id, forecast_type)
);
