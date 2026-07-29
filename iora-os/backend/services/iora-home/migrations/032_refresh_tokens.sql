-- Migration 032: Refresh token support for JWT authentication
-- Adds refresh token storage and JWT blacklist for secure logout.
--
-- Refresh tokens are long-lived credentials that can be exchanged for
-- new short-lived JWTs without requiring the user to re-enter their
-- password.

CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,           -- SHA-256 hash of the refresh token
    device_id TEXT,                     -- Optional device identifier
    user_agent TEXT,                    -- User agent at time of issue
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,             -- NULL = still valid
    revoked_by TEXT,                    -- 'logout', 'reissue', 'admin'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- JWT blacklist: allows invalidating a JWT before its natural expiry.
-- Entries are cleaned up by a background task after the JWT would have
-- expired anyway.
CREATE TABLE IF NOT EXISTS jwt_blacklist (
    jti TEXT PRIMARY KEY,               -- JWT ID (from Claims)
    user_id TEXT NOT NULL,
    revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,    -- When the JWT would have expired (for GC)
    reason TEXT NOT NULL DEFAULT 'logout',
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_jwt_blacklist_expires ON jwt_blacklist(expires_at);
CREATE INDEX IF NOT EXISTS idx_jwt_blacklist_user ON jwt_blacklist(user_id);
