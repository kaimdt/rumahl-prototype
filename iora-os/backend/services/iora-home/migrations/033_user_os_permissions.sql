CREATE TABLE IF NOT EXISTS user_os_permissions (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    allowed BOOLEAN NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, permission)
);

CREATE INDEX IF NOT EXISTS idx_user_os_permissions_user
    ON user_os_permissions(user_id);
