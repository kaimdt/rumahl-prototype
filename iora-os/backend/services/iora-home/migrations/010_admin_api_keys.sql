-- Migration 010: Admin roles and API key system
-- Adds is_admin flag to users and creates api_keys table

-- Add is_admin column to users (first registered user will be promoted to admin via app logic)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- API Keys table for programmatic access (custom devices, integrations)
CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    key_prefix TEXT NOT NULL,           -- First 8 chars of the key for identification
    permissions TEXT NOT NULL DEFAULT '["read"]',  -- JSON array of permissions
    rate_limit INTEGER NOT NULL DEFAULT 60,        -- Requests per minute
    last_used_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,              -- NULL = never expires
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_is_active ON api_keys(is_active);

-- Rate limiting tracking table
CREATE TABLE IF NOT EXISTS api_key_rate_limits (
    key_id TEXT NOT NULL,
    window_start TIMESTAMPTZ NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (key_id, window_start),
    FOREIGN KEY (key_id) REFERENCES api_keys(id) ON DELETE CASCADE
);
