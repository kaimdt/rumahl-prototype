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

-- Comments for documentation
COMMENT ON TABLE apps IS 'Stores installed apps and their metadata';
COMMENT ON TABLE port_assignments IS 'Tracks dynamically assigned ports for apps';
COMMENT ON TABLE app_permissions IS 'Manages permission grants for apps';
COMMENT ON TABLE app_settings IS 'Stores app-specific configuration';
COMMENT ON TABLE app_pages IS 'Custom pages created by apps';
COMMENT ON TABLE app_widgets IS 'Widgets provided by apps';
COMMENT ON TABLE app_store_cache IS 'Caches app store metadata to reduce external API calls';
COMMENT ON TABLE installation_history IS 'Audit log of all installation/uninstallation actions';
