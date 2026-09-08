-- Notification channels: stores configured delivery targets.
--
-- channel_type values:
--   'rumahl'       – internal rumahl dashboard notification (always on, no extra config)
--   'ha_mobile'  – Home Assistant mobile_app notify service  (target_id = notify service name, e.g. "mobile_app_pixel_8")
--   'desktop'    – rumahl Desktop Client (target_id = desktop client identifier / '*' for all connected)
--
CREATE TABLE IF NOT EXISTS notification_channels (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    channel_type TEXT NOT NULL,         -- 'rumahl' | 'ha_mobile' | 'desktop'
    target_id   TEXT NOT NULL DEFAULT '',  -- HA notify service or desktop client id
    enabled     BOOLEAN NOT NULL DEFAULT TRUE,
    config      JSONB NOT NULL DEFAULT '{}',  -- extra per-channel config (e.g. HA data overrides)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_channels_type ON notification_channels(channel_type);
CREATE INDEX IF NOT EXISTS idx_notification_channels_enabled ON notification_channels(enabled);

-- Notification dispatch log: records which channels each notification was sent to.
CREATE TABLE IF NOT EXISTS notification_dispatch_log (
    id            TEXT PRIMARY KEY,
    notification_id TEXT NOT NULL,
    channel_id    TEXT NOT NULL,
    channel_type  TEXT NOT NULL,
    status        TEXT NOT NULL DEFAULT 'pending', -- 'ok' | 'error' | 'skipped'
    error_message TEXT NOT NULL DEFAULT '',
    dispatched_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_log_notification ON notification_dispatch_log(notification_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_log_channel ON notification_dispatch_log(channel_id);
