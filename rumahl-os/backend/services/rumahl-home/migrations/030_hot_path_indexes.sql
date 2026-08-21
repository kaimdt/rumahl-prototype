-- Migration 030: Hot-path indexes for high-traffic queries
-- Added 2026-05-25 after profiling revealed sequential scans on user_id+created_at
-- listings and on enabled-flag polling tables.
--
-- All indexes are additive and use IF NOT EXISTS, so re-applying is safe.

-- Webhooks: most listing endpoints query by user_id and order by created_at DESC.
-- A compound index removes the separate sort step.
CREATE INDEX IF NOT EXISTS idx_webhooks_user_created
    ON webhooks(user_id, created_at DESC);

-- Notifications: unread-counter widgets and the notification center frequently
-- filter by `read = false` and sort by recency. The existing index on
-- created_at alone forces a filter scan.
CREATE INDEX IF NOT EXISTS idx_notifications_read_created
    ON notifications(read, created_at DESC);

-- App scheduler: the scheduler loop wakes up frequently and asks
-- "give me enabled tasks for app X". Index existed on app_id alone; this
-- partial index targets only the enabled rows the scheduler actually cares about.
CREATE INDEX IF NOT EXISTS idx_app_schedules_enabled
    ON app_schedules(app_id, schedule_type)
    WHERE enabled = TRUE;

-- App scheduler: one_shot/cron next-run lookup.
CREATE INDEX IF NOT EXISTS idx_app_schedules_run_at
    ON app_schedules(run_at)
    WHERE enabled = TRUE AND run_at IS NOT NULL;

-- App webhooks: same pattern as the user webhooks table.
CREATE INDEX IF NOT EXISTS idx_app_webhooks_enabled
    ON app_webhooks(app_id)
    WHERE enabled = TRUE;

-- Webhook deliveries: failure analysis & retry lookups filter by webhook_id
-- and sort by recency.
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_wh_created
    ON webhook_deliveries(webhook_id, created_at DESC);

-- App storage KV: lookups are always `WHERE app_id = $1 AND key = $2`.
-- The existing index is on app_id alone — extending it covers the equality
-- on key and saves a heap re-check.
CREATE INDEX IF NOT EXISTS idx_app_storage_kv_app_key
    ON app_storage_kv(app_id, key);

-- App storage files: listing per app sorted by recency.
CREATE INDEX IF NOT EXISTS idx_app_storage_files_app_created
    ON app_storage_files(app_id, created_at DESC);

-- App schedule logs: per-task history queries.
-- The existing index on (task_id, executed_at DESC) is good; add per-app
-- filter for the cross-app log view.
CREATE INDEX IF NOT EXISTS idx_app_schedule_logs_app_executed
    ON app_schedule_logs(app_id, executed_at DESC);

-- App webhook deliveries: per-app history.
CREATE INDEX IF NOT EXISTS idx_app_webhook_deliveries_wh_delivered
    ON app_webhook_deliveries(webhook_id, delivered_at DESC);
