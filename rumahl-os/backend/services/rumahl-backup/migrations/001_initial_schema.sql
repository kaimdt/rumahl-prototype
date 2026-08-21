-- rumahl Backup Service Database Schema

-- Backups table
CREATE TABLE IF NOT EXISTS backups (
    id UUID PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    backup_type VARCHAR(50) NOT NULL, -- 'manual', 'scheduled', 'pre_update'
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    size_bytes BIGINT NOT NULL DEFAULT 0,
    local_path TEXT NOT NULL,
    remote_path TEXT,
    remote_backend VARCHAR(50), -- 'ftp', 'webdav', 's3'
    status VARCHAR(50) NOT NULL, -- 'creating', 'completed', 'failed', 'uploaded'
    error_message TEXT,
    content_manifest JSONB NOT NULL DEFAULT '{}',
    metadata JSONB NOT NULL DEFAULT '{}'
);

-- Backup configuration table
CREATE TABLE IF NOT EXISTS backup_config (
    id UUID PRIMARY KEY,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,

    -- Content selection
    include_databases BOOLEAN NOT NULL DEFAULT TRUE,
    include_docker_volumes BOOLEAN NOT NULL DEFAULT TRUE,
    include_system_config BOOLEAN NOT NULL DEFAULT TRUE,
    include_user_data BOOLEAN NOT NULL DEFAULT TRUE,
    include_apps BOOLEAN NOT NULL DEFAULT TRUE,

    -- Scheduling
    schedule_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    schedule_cron VARCHAR(100),
    schedule_retention_days INTEGER NOT NULL DEFAULT 7,

    -- Pre-update backups
    pre_update_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    pre_update_retention_count INTEGER NOT NULL DEFAULT 3,

    -- Remote storage
    remote_storage_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    remote_storage_backend VARCHAR(50), -- 'ftp', 'webdav', 's3'
    remote_storage_config JSONB,

    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_backups_created_at ON backups(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_backups_type ON backups(backup_type);
CREATE INDEX IF NOT EXISTS idx_backups_status ON backups(status);

-- Insert default configuration
INSERT INTO backup_config (
    id, enabled, include_databases, include_docker_volumes,
    include_system_config, include_user_data, include_apps,
    schedule_enabled, schedule_cron, schedule_retention_days,
    pre_update_enabled, pre_update_retention_count,
    remote_storage_enabled, updated_at
) VALUES (
    gen_random_uuid(), FALSE, TRUE, TRUE, TRUE, TRUE, TRUE,
    FALSE, '0 2 * * *', 7,
    TRUE, 3,
    FALSE, NOW()
) ON CONFLICT (id) DO NOTHING;
