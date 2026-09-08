-- Migration 008: Provider model registry + persisted secrets
--
-- Adds:
--   * persistent cache of models discovered per AI provider
--   * persisted secrets store (GitHub PAT, OAuth tokens, etc.)
--   * fetch metadata columns on provider_configs
--
-- Idempotent: safe to re-run.

-- The original provider_configs CHECK constraint only allows openai/anthropic/local/desktop,
-- but the application supports many more (compatible, pidev, deepseek, grok, mistral, …).
-- Drop it so we can persist any registered provider type. Validation moves to the application.
ALTER TABLE provider_configs DROP CONSTRAINT IF EXISTS provider_configs_provider_type_check;

-- Discovered models per provider — populated on save and via periodic refresh.
CREATE TABLE IF NOT EXISTS provider_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_config_id UUID NOT NULL REFERENCES provider_configs(id) ON DELETE CASCADE,
    model_id TEXT NOT NULL,
    model_name TEXT NOT NULL,
    capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_seen TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    is_live BOOLEAN NOT NULL DEFAULT false, -- true for local/desktop providers refreshed every poll
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    UNIQUE(provider_config_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_config_id);
CREATE INDEX IF NOT EXISTS idx_provider_models_last_seen ON provider_models(last_seen DESC);

-- Generic secrets store — encrypted-at-rest TBD.
-- Keys follow `<scope>.<name>`, e.g. "github.pat", "github.app_id".
CREATE TABLE IF NOT EXISTS persisted_secrets (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Extend provider_configs with refresh metadata (no-op if columns already exist).
ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS last_model_fetch_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS last_model_fetch_error TEXT;
ALTER TABLE provider_configs ADD COLUMN IF NOT EXISTS model_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON TABLE provider_models IS 'Cache of models discovered for each AI provider (auto + manual refresh).';
COMMENT ON TABLE persisted_secrets IS 'Persisted secrets like GitHub PAT, OAuth tokens, API keys.';
