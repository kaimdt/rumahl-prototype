-- Add PIN for quick-login on terminal/kiosk devices
ALTER TABLE users ADD COLUMN IF NOT EXISTS pin_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';

-- Add terminal mode to devices
ALTER TABLE devices ADD COLUMN IF NOT EXISTS is_terminal BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS terminal_name TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS assigned_profile_id TEXT;

-- Store page designer layout settings in DB (instead of localStorage)
CREATE TABLE IF NOT EXISTS page_layouts (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    cols INTEGER NOT NULL DEFAULT 4,
    rows INTEGER NOT NULL DEFAULT 12,
    gap INTEGER NOT NULL DEFAULT 12,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(profile_id, page_id),
    FOREIGN KEY (profile_id) REFERENCES configuration_profiles(id)
);
