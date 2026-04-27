-- Plugin and App management schema

-- Plugin registry (small code extensions that run on-demand)
CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT NOT NULL,
    author TEXT NOT NULL,
    plugin_type TEXT NOT NULL,  -- 'widget', 'service', 'api', 'integration', 'theme'
    permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
    config JSONB,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plugins_enabled ON plugins(enabled);
CREATE INDEX IF NOT EXISTS idx_plugins_type ON plugins(plugin_type);

-- Plugin execution logs (for sandboxed plugin runs)
CREATE TABLE IF NOT EXISTS plugin_execution_log (
    id BIGSERIAL PRIMARY KEY,
    plugin_id TEXT NOT NULL REFERENCES plugins(id) ON DELETE CASCADE,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms INTEGER,
    success BOOLEAN NOT NULL,
    error TEXT,
    metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_plugin_execution_log_plugin ON plugin_execution_log(plugin_id, executed_at DESC);

-- App store registry (Docker apps installed via supervisor)
CREATE TABLE IF NOT EXISTS app_registry (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT NOT NULL,
    author TEXT NOT NULL,
    icon TEXT,
    image TEXT NOT NULL,  -- Docker image
    container_id TEXT,    -- Running container ID
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    config JSONB,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_registry_enabled ON app_registry(enabled);
