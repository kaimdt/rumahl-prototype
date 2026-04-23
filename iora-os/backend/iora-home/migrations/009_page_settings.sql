-- Page-level settings: card style, background override, custom CSS, etc.
CREATE TABLE IF NOT EXISTS page_settings (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    page_id TEXT NOT NULL,
    card_style TEXT DEFAULT 'default',
    background_type TEXT,           -- NULL = use global, 'static' | 'gradient' | 'slideshow' | 'video'
    background_config TEXT,         -- JSON blob for background (same schema as global background)
    custom_css TEXT,                -- optional per-page custom CSS
    hide_header BOOLEAN NOT NULL DEFAULT FALSE,
    padding INTEGER DEFAULT 16,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(profile_id, page_id)
);

-- Global card style preference (profile-wide default)
-- Stored in system_preferences with key 'global_card_style'
