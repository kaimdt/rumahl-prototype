-- Add PIN for quick-login on terminal/kiosk devices
ALTER TABLE users ADD COLUMN pin_hash TEXT;
ALTER TABLE users ADD COLUMN avatar_url TEXT;
ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user';

-- Add terminal mode to devices
ALTER TABLE devices ADD COLUMN is_terminal BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN terminal_name TEXT;
ALTER TABLE devices ADD COLUMN assigned_profile_id TEXT;

-- Store page designer layout settings in DB (instead of localStorage)
CREATE TABLE IF NOT EXISTS page_layouts (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    cols INTEGER NOT NULL DEFAULT 4,
    rows INTEGER NOT NULL DEFAULT 12,
    gap INTEGER NOT NULL DEFAULT 12,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(profile_id, page_id),
    FOREIGN KEY (profile_id) REFERENCES configuration_profiles(id)
);
