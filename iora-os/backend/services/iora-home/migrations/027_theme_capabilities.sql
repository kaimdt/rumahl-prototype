-- Theme Capabilities (v2.3) – Design modes, auto, accent, glass, custom settings
-- ========================================================================
-- Adds:
--   installed_themes.capabilities_json     – ThemeCapabilities as JSON
--   user_theme_settings                    – Per-user per-theme custom settings

ALTER TABLE installed_themes
ADD COLUMN IF NOT EXISTS capabilities_json TEXT DEFAULT NULL;

CREATE TABLE IF NOT EXISTS user_theme_settings (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    theme_id TEXT NOT NULL,
    setting_key TEXT NOT NULL,
    setting_value TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(profile_id, theme_id, setting_key)
);

CREATE INDEX IF NOT EXISTS idx_user_theme_settings_profile 
ON user_theme_settings(profile_id, theme_id);
