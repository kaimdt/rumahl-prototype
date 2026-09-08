-- rumahl Files: Core tables for file management and sharing
-- Migration 001: Initial schema

CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    sha256_hash TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    parent_folder_id TEXT,
    is_folder INTEGER NOT NULL DEFAULT 0,
    description TEXT,
    tags TEXT, -- JSON array of tags
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    deleted_at TEXT, -- soft delete
    FOREIGN KEY (parent_folder_id) REFERENCES files(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id);
CREATE INDEX IF NOT EXISTS idx_files_parent ON files(parent_folder_id);
CREATE INDEX IF NOT EXISTS idx_files_hash ON files(sha256_hash);
CREATE INDEX IF NOT EXISTS idx_files_deleted ON files(deleted_at);

-- Share links: time-limited, optionally password-protected
CREATE TABLE IF NOT EXISTS share_links (
    id TEXT PRIMARY KEY NOT NULL,
    file_id TEXT NOT NULL,
    created_by TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    password_hash TEXT, -- bcrypt hash if password-protected
    expires_at TEXT, -- NULL = never expires
    max_downloads INTEGER, -- NULL = unlimited
    download_count INTEGER NOT NULL DEFAULT 0,
    allow_upload INTEGER NOT NULL DEFAULT 0, -- allow recipients to upload to folder
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_share_links_token ON share_links(token);
CREATE INDEX IF NOT EXISTS idx_share_links_file ON share_links(file_id);

-- File permissions: per-user or per-group access control
CREATE TABLE IF NOT EXISTS file_permissions (
    id TEXT PRIMARY KEY NOT NULL,
    file_id TEXT NOT NULL,
    grantee_id TEXT NOT NULL, -- user ID or group ID
    grantee_type TEXT NOT NULL DEFAULT 'user', -- 'user' or 'group'
    permission TEXT NOT NULL DEFAULT 'read', -- 'read', 'write', 'admin'
    granted_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_permissions_file ON file_permissions(file_id);
CREATE INDEX IF NOT EXISTS idx_file_permissions_grantee ON file_permissions(grantee_id);

-- File activity log
CREATE TABLE IF NOT EXISTS file_activity (
    id TEXT PRIMARY KEY NOT NULL,
    file_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL, -- 'upload', 'download', 'share', 'delete', 'rename', 'move', 'permission_change'
    details TEXT, -- JSON with extra info
    ip_address TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_activity_file ON file_activity(file_id);
CREATE INDEX IF NOT EXISTS idx_file_activity_user ON file_activity(user_id);
CREATE INDEX IF NOT EXISTS idx_file_activity_time ON file_activity(created_at);

-- File versions (optional versioning)
CREATE TABLE IF NOT EXISTS file_versions (
    id TEXT PRIMARY KEY NOT NULL,
    file_id TEXT NOT NULL,
    version_number INTEGER NOT NULL,
    storage_path TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256_hash TEXT NOT NULL,
    uploaded_by TEXT NOT NULL,
    comment TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_file_versions_file ON file_versions(file_id);

-- Storage quotas per user
CREATE TABLE IF NOT EXISTS storage_quotas (
    user_id TEXT PRIMARY KEY NOT NULL,
    quota_bytes INTEGER NOT NULL DEFAULT 1073741824, -- 1 GB default
    used_bytes INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
