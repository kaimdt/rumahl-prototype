-- Temporary database access users with expiration (max 1 month)
CREATE TABLE IF NOT EXISTS temp_db_users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    description TEXT,
    permissions TEXT NOT NULL DEFAULT 'readonly',  -- 'readonly' or 'readwrite'
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    revoked_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    CONSTRAINT expires_max_1_month CHECK (expires_at <= created_at + INTERVAL '31 days')
);

CREATE INDEX IF NOT EXISTS idx_temp_db_users_expires ON temp_db_users(expires_at);
CREATE INDEX IF NOT EXISTS idx_temp_db_users_active ON temp_db_users(revoked, expires_at);
