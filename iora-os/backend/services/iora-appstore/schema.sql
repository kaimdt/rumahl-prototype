-- IORA App Store Database Schema
-- This schema supports app installation, port assignment, permissions, and settings

-- Apps table: stores installed apps
CREATE TABLE IF NOT EXISTS apps (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    developer VARCHAR(255) NOT NULL,
    description TEXT,
    icon TEXT,
    manifest_json JSONB NOT NULL,
    trust_level VARCHAR(50) NOT NULL CHECK (trust_level IN ('trusted', 'untrusted', 'verified')),
    source VARCHAR(50) NOT NULL CHECK (source IN ('store', 'zip')),
    installed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    container_name VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Port assignments table: tracks dynamic port allocation
CREATE TABLE IF NOT EXISTS port_assignments (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    internal_port INTEGER NOT NULL,
    external_port INTEGER NOT NULL,
    protocol VARCHAR(10) NOT NULL CHECK (protocol IN ('tcp', 'udp')),
    assignment_mode VARCHAR(10) NOT NULL DEFAULT 'random' CHECK (assignment_mode IN ('random', 'fixed')),
    assigned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(external_port, protocol),
    UNIQUE(app_id, internal_port, protocol)
);

-- App permissions table: tracks permission grants
CREATE TABLE IF NOT EXISTS app_permissions (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    permission VARCHAR(255) NOT NULL,
    granted BOOLEAN NOT NULL DEFAULT FALSE,
    granted_at TIMESTAMP WITH TIME ZONE,
    granted_by VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(app_id, permission)
);

-- App settings table: stores app configuration
CREATE TABLE IF NOT EXISTS app_settings (
    id UUID PRIMARY KEY,
    app_id UUID UNIQUE NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    settings_json JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- App pages table: custom pages created by apps
CREATE TABLE IF NOT EXISTS app_pages (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    page_id VARCHAR(255) NOT NULL,
    title VARCHAR(255) NOT NULL,
    icon VARCHAR(100),
    url TEXT NOT NULL,
    show_in_nav BOOLEAN NOT NULL DEFAULT TRUE,
    display_order INTEGER DEFAULT 0,
    parent_page_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(app_id, page_id)
);

-- App widgets table: widgets provided by apps
CREATE TABLE IF NOT EXISTS app_widgets (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    widget_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    widget_type VARCHAR(100) NOT NULL,
    component_url TEXT NOT NULL,
    description TEXT,
    default_config JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(app_id, widget_id)
);

-- App store cache: caches app store metadata
CREATE TABLE IF NOT EXISTS app_store_cache (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    developer VARCHAR(255) NOT NULL,
    description TEXT,
    icon TEXT,
    category VARCHAR(100),
    tags TEXT[],
    screenshots TEXT[],
    manifest_json JSONB NOT NULL,
    cached_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- Installation history: tracks all installation attempts
CREATE TABLE IF NOT EXISTS installation_history (
    id UUID PRIMARY KEY,
    app_id VARCHAR(255) NOT NULL,
    version VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL CHECK (action IN ('install', 'uninstall', 'enable', 'disable', 'update')),
    success BOOLEAN NOT NULL,
    error_message TEXT,
    performed_by VARCHAR(255),
    performed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_apps_app_id ON apps(app_id);
CREATE INDEX IF NOT EXISTS idx_apps_enabled ON apps(enabled);
CREATE INDEX IF NOT EXISTS idx_apps_trust_level ON apps(trust_level);
CREATE INDEX IF NOT EXISTS idx_port_assignments_app_id ON port_assignments(app_id);
CREATE INDEX IF NOT EXISTS idx_port_assignments_external_port ON port_assignments(external_port);
CREATE INDEX IF NOT EXISTS idx_app_permissions_app_id ON app_permissions(app_id);
CREATE INDEX IF NOT EXISTS idx_app_permissions_granted ON app_permissions(granted);
CREATE INDEX IF NOT EXISTS idx_app_settings_app_id ON app_settings(app_id);
CREATE INDEX IF NOT EXISTS idx_app_pages_app_id ON app_pages(app_id);
CREATE INDEX IF NOT EXISTS idx_app_widgets_app_id ON app_widgets(app_id);
CREATE INDEX IF NOT EXISTS idx_app_store_cache_expires_at ON app_store_cache(expires_at);
CREATE INDEX IF NOT EXISTS idx_installation_history_app_id ON installation_history(app_id);
CREATE INDEX IF NOT EXISTS idx_installation_history_performed_at ON installation_history(performed_at DESC);

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_apps_updated_at BEFORE UPDATE ON apps
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- New v2.1: Extended App Capabilities

-- App storage: tracks file and key-value storage for apps
CREATE TABLE IF NOT EXISTS app_storage_files (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    name VARCHAR(512) NOT NULL,
    mime_type VARCHAR(255),
    size_bytes BIGINT NOT NULL DEFAULT 0,
    sha256 VARCHAR(64),
    storage_path TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_storage_kv (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    key VARCHAR(512) NOT NULL,
    value JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(app_id, key)
);

-- App database provisioning
CREATE TABLE IF NOT EXISTS app_databases (
    id UUID PRIMARY KEY,
    app_id UUID UNIQUE NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    backend VARCHAR(20) NOT NULL DEFAULT 'sqlite' CHECK (backend IN ('sqlite', 'postgres')),
    db_path TEXT,
    wal_mode BOOLEAN NOT NULL DEFAULT TRUE,
    max_size_bytes BIGINT NOT NULL DEFAULT 104857600,
    auto_backup BOOLEAN NOT NULL DEFAULT TRUE,
    backup_interval_minutes INTEGER NOT NULL DEFAULT 1440,
    last_backup_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_database_backups (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    backup_path TEXT NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- App scheduled tasks
CREATE TABLE IF NOT EXISTS app_schedules (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    schedule_type VARCHAR(20) NOT NULL CHECK (schedule_type IN ('cron', 'interval', 'one_shot')),
    cron_expression VARCHAR(100),
    interval_seconds BIGINT,
    run_at TIMESTAMP WITH TIME ZONE,
    payload JSONB DEFAULT '{}',
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    max_retries INTEGER NOT NULL DEFAULT 3,
    retry_delay_seconds BIGINT NOT NULL DEFAULT 60,
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_schedule_logs (
    id BIGSERIAL PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES app_schedules(id) ON DELETE CASCADE,
    executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    success BOOLEAN NOT NULL,
    duration_ms BIGINT NOT NULL DEFAULT 0,
    error TEXT,
    status_code INTEGER
);

-- App webhooks
CREATE TABLE IF NOT EXISTS app_webhooks (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
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
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_webhook_deliveries (
    id UUID PRIMARY KEY,
    webhook_id UUID NOT NULL REFERENCES app_webhooks(id) ON DELETE CASCADE,
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
    delivered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

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
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_messaging_subscriptions (
    id UUID PRIMARY KEY,
    app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    channel_id UUID NOT NULL REFERENCES app_messaging_channels(id) ON DELETE CASCADE,
    filter TEXT,
    webhook_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(app_id, channel_id)
);

CREATE TABLE IF NOT EXISTS app_messaging_messages (
    id UUID PRIMARY KEY,
    channel_id UUID NOT NULL REFERENCES app_messaging_channels(id) ON DELETE CASCADE,
    publisher VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    priority VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    ttl_seconds BIGINT NOT NULL DEFAULT 300,
    published_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_direct_messages (
    id UUID PRIMARY KEY,
    from_app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    to_app_id UUID NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    read_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for new tables
CREATE INDEX IF NOT EXISTS idx_app_storage_files_app_id ON app_storage_files(app_id);
CREATE INDEX IF NOT EXISTS idx_app_storage_kv_app_id ON app_storage_kv(app_id);
CREATE INDEX IF NOT EXISTS idx_app_databases_app_id ON app_databases(app_id);
CREATE INDEX IF NOT EXISTS idx_app_database_backups_app_id ON app_database_backups(app_id);
CREATE INDEX IF NOT EXISTS idx_app_schedules_app_id ON app_schedules(app_id);
CREATE INDEX IF NOT EXISTS idx_app_schedule_logs_app_id ON app_schedule_logs(app_id);
CREATE INDEX IF NOT EXISTS idx_app_schedule_logs_task_id ON app_schedule_logs(task_id);
CREATE INDEX IF NOT EXISTS idx_app_webhooks_app_id ON app_webhooks(app_id);
CREATE INDEX IF NOT EXISTS idx_app_webhook_deliveries_webhook_id ON app_webhook_deliveries(webhook_id);
CREATE INDEX IF NOT EXISTS idx_app_messaging_subscriptions_app_id ON app_messaging_subscriptions(app_id);
CREATE INDEX IF NOT EXISTS idx_app_messaging_messages_channel_id ON app_messaging_messages(channel_id);
CREATE INDEX IF NOT EXISTS idx_app_direct_messages_from ON app_direct_messages(from_app_id);
CREATE INDEX IF NOT EXISTS idx_app_direct_messages_to ON app_direct_messages(to_app_id);

-- Comments for documentation
COMMENT ON TABLE apps IS 'Stores installed apps and their metadata';
COMMENT ON TABLE port_assignments IS 'Tracks dynamically assigned ports for apps';
COMMENT ON TABLE app_permissions IS 'Manages permission grants for apps';
COMMENT ON TABLE app_settings IS 'Stores app-specific configuration';
COMMENT ON TABLE app_pages IS 'Custom pages created by apps';
COMMENT ON TABLE app_widgets IS 'Widgets provided by apps';
COMMENT ON TABLE app_store_cache IS 'Caches app store metadata to reduce external API calls';
COMMENT ON TABLE installation_history IS 'Audit log of all installation/uninstallation actions';
COMMENT ON TABLE app_storage_files IS 'Files uploaded by apps';
COMMENT ON TABLE app_storage_kv IS 'Key-value data stored by apps';
COMMENT ON TABLE app_databases IS 'Per-app SQLite/PostgreSQL database provisioning';
COMMENT ON TABLE app_database_backups IS 'Database backup history';
COMMENT ON TABLE app_schedules IS 'Scheduled/cron tasks registered by apps';
COMMENT ON TABLE app_schedule_logs IS 'Execution logs for scheduled tasks';
COMMENT ON TABLE app_webhooks IS 'Webhook endpoints registered by apps';
COMMENT ON TABLE app_webhook_deliveries IS 'Delivery logs for webhook calls';
COMMENT ON TABLE app_messaging_channels IS 'Message channels for inter-app communication';
COMMENT ON TABLE app_messaging_subscriptions IS 'Channel subscriptions by app';
COMMENT ON TABLE app_messaging_messages IS 'Published messages on channels';
COMMENT ON TABLE app_direct_messages IS 'Direct messages between apps';
