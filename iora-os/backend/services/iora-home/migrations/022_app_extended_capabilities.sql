-- IORA v2.1: Extended App Capabilities Schema
-- Adds tables for app storage, SQLite databases, scheduled tasks, webhooks, and messaging

-- App storage: files
CREATE TABLE IF NOT EXISTS app_storage_files (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) NOT NULL,
    name VARCHAR(512) NOT NULL,
    mime_type VARCHAR(255),
    size_bytes BIGINT NOT NULL DEFAULT 0,
    sha256 VARCHAR(64),
    storage_path TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_storage_files_app_id ON app_storage_files(app_id);

-- App storage: key-value
CREATE TABLE IF NOT EXISTS app_storage_kv (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) NOT NULL,
    key VARCHAR(512) NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(app_id, key)
);

CREATE INDEX IF NOT EXISTS idx_app_storage_kv_app_id ON app_storage_kv(app_id);

-- App database provisioning
CREATE TABLE IF NOT EXISTS app_databases (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) UNIQUE NOT NULL,
    backend VARCHAR(20) NOT NULL DEFAULT 'sqlite' CHECK (backend IN ('sqlite', 'postgres')),
    db_path TEXT,
    wal_mode BOOLEAN NOT NULL DEFAULT TRUE,
    max_size_bytes BIGINT NOT NULL DEFAULT 104857600,
    auto_backup BOOLEAN NOT NULL DEFAULT TRUE,
    backup_interval_minutes INTEGER NOT NULL DEFAULT 1440,
    last_backup_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- App scheduled tasks
CREATE TABLE IF NOT EXISTS app_schedules (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    schedule_type VARCHAR(20) NOT NULL CHECK (schedule_type IN ('cron', 'interval', 'one_shot')),
    cron_expression VARCHAR(100),
    interval_seconds BIGINT,
    run_at TIMESTAMPTZ,
    payload JSONB DEFAULT '{}',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    max_retries INTEGER NOT NULL DEFAULT 3,
    retry_delay_seconds BIGINT NOT NULL DEFAULT 60,
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_schedules_app_id ON app_schedules(app_id);

CREATE TABLE IF NOT EXISTS app_schedule_logs (
    id BIGSERIAL PRIMARY KEY,
    app_id VARCHAR(255) NOT NULL,
    task_id UUID NOT NULL,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    success BOOLEAN NOT NULL,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    error TEXT,
    status_code INTEGER
);

CREATE INDEX IF NOT EXISTS idx_app_schedule_logs_task ON app_schedule_logs(task_id, executed_at DESC);

-- App webhooks
CREATE TABLE IF NOT EXISTS app_webhooks (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT DEFAULT '',
    method VARCHAR(10) NOT NULL DEFAULT 'POST' CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
    target_url TEXT NOT NULL,
    header_mapping JSONB DEFAULT '{}',
    verify_signature BOOLEAN NOT NULL DEFAULT FALSE,
    secret TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    max_retries INTEGER NOT NULL DEFAULT 3,
    rate_limit_per_minute INTEGER NOT NULL DEFAULT 0,
    timeout_seconds BIGINT NOT NULL DEFAULT 30,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_webhooks_app_id ON app_webhooks(app_id);

CREATE TABLE IF NOT EXISTS app_webhook_deliveries (
    id UUID PRIMARY KEY,
    webhook_id UUID NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1,
    request_method VARCHAR(10),
    request_headers JSONB,
    request_body TEXT,
    request_query_params JSONB,
    source_ip VARCHAR(45),
    response_status_code INTEGER,
    response_headers JSONB,
    response_body TEXT,
    response_error TEXT,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    delivered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_webhook_deliveries_wh ON app_webhook_deliveries(webhook_id, delivered_at DESC);

-- App messaging channels
CREATE TABLE IF NOT EXISTS app_messaging_channels (
    id UUID PRIMARY KEY,
    name VARCHAR(255) UNIQUE NOT NULL,
    channel_type VARCHAR(20) NOT NULL DEFAULT 'public' CHECK (channel_type IN ('public', 'protected', 'system')),
    description TEXT DEFAULT '',
    allowed_publishers TEXT[] DEFAULT '{}',
    allowed_subscribers TEXT[] DEFAULT '{}',
    retention_seconds BIGINT NOT NULL DEFAULT 3600,
    max_message_size_bytes BIGINT NOT NULL DEFAULT 102400,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_messaging_subscriptions (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) NOT NULL,
    channel_id UUID NOT NULL,
    filter TEXT,
    webhook_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(app_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_app_messaging_subs_app ON app_messaging_subscriptions(app_id);

CREATE TABLE IF NOT EXISTS app_messaging_messages (
    id UUID PRIMARY KEY,
    channel_id UUID NOT NULL,
    publisher VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    ttl_seconds BIGINT NOT NULL DEFAULT 300,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_messaging_msgs_channel ON app_messaging_messages(channel_id, published_at DESC);

CREATE TABLE IF NOT EXISTS app_direct_messages (
    id UUID PRIMARY KEY,
    from_app_id VARCHAR(255) NOT NULL,
    to_app_id VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    read_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_app_direct_msgs_to ON app_direct_messages(to_app_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_direct_msgs_from ON app_direct_messages(from_app_id, sent_at DESC);
