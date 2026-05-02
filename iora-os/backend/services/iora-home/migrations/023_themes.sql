-- Theme System (v2.2) – File-based themes
-- =========================================
-- Supports ZIP-based themes with CSS files, JS, HTML templates,
-- fonts, images, icons, and inline CSS variables.

CREATE TABLE IF NOT EXISTS installed_themes (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '1.0.0',
    developer TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    icon TEXT,
    preview_image TEXT,
    parent_theme TEXT,
    source TEXT NOT NULL DEFAULT 'inline',   -- 'inline' or 'file'
    css_variables TEXT NOT NULL DEFAULT '{}',
    additional_css TEXT,
    css_files_json TEXT DEFAULT '[]',       -- ["variables.css","theme.css"]
    js_files_json TEXT DEFAULT '[]',         -- ["js/theme.js"]
    html_templates_json TEXT DEFAULT '{}',   -- {"header":"html/header.html"}
    fonts_json TEXT DEFAULT '[]',            -- ThemeFont[]
    icon_font_json TEXT,                     -- ThemeIconConfig
    system BOOLEAN NOT NULL DEFAULT FALSE,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    source_app_id TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_theme_selections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    profile_id TEXT NOT NULL,
    theme_id TEXT NOT NULL DEFAULT 'auto',
    auto_theme BOOLEAN NOT NULL DEFAULT TRUE,
    overrides TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE,
    UNIQUE(profile_id)
);
