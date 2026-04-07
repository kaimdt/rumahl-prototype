-- Users table
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Devices table
CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    device_type TEXT, -- 'browser', 'tablet', 'mobile', etc.
    user_agent TEXT,
    last_seen TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User-Device associations (for multi-user support)
CREATE TABLE IF NOT EXISTS user_devices (
    user_id TEXT NOT NULL,
    device_id TEXT NOT NULL,
    is_primary BOOLEAN NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (user_id, device_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

-- Configuration profiles (can be per-user or per-device)
CREATE TABLE IF NOT EXISTS configuration_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    profile_type TEXT NOT NULL CHECK(profile_type IN ('user', 'device')), -- 'user' or 'device'
    owner_id TEXT NOT NULL, -- user_id or device_id depending on profile_type
    is_default BOOLEAN NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Pages configuration
CREATE TABLE IF NOT EXISTS pages (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    page_id TEXT NOT NULL, -- logical page identifier (e.g., 'home', 'lights')
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (profile_id) REFERENCES configuration_profiles(id) ON DELETE CASCADE,
    UNIQUE(profile_id, page_id)
);

-- Widgets configuration
CREATE TABLE IF NOT EXISTS widgets (
    id TEXT PRIMARY KEY,
    page_id TEXT NOT NULL,
    widget_type TEXT NOT NULL,
    entity_id TEXT,
    position_x INTEGER NOT NULL DEFAULT 0,
    position_y INTEGER NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 1,
    height INTEGER NOT NULL DEFAULT 1,
    config TEXT, -- JSON configuration for the widget
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (page_id) REFERENCES pages(id) ON DELETE CASCADE
);

-- Theme settings
CREATE TABLE IF NOT EXISTS theme_settings (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    sleep_mode BOOLEAN NOT NULL DEFAULT 0,
    auto_theme BOOLEAN NOT NULL DEFAULT 1,
    selected_theme TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (profile_id) REFERENCES configuration_profiles(id) ON DELETE CASCADE,
    UNIQUE(profile_id)
);

-- Background configurations
CREATE TABLE IF NOT EXISTS background_configs (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    background_type TEXT NOT NULL CHECK(background_type IN ('static', 'slideshow', 'video', 'gradient')),
    config TEXT NOT NULL, -- JSON with type-specific configuration
    is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (profile_id) REFERENCES configuration_profiles(id) ON DELETE CASCADE
);

-- Background triggers (for automation-based background changes)
CREATE TABLE IF NOT EXISTS background_triggers (
    id TEXT PRIMARY KEY,
    profile_id TEXT NOT NULL,
    trigger_type TEXT NOT NULL CHECK(trigger_type IN ('time', 'entity_state', 'event')),
    trigger_config TEXT NOT NULL, -- JSON with trigger-specific configuration
    background_config_id TEXT NOT NULL,
    priority INTEGER NOT NULL DEFAULT 0,
    is_enabled BOOLEAN NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (profile_id) REFERENCES configuration_profiles(id) ON DELETE CASCADE,
    FOREIGN KEY (background_config_id) REFERENCES background_configs(id) ON DELETE CASCADE
);

-- User preferences (design mode choice, etc.)
CREATE TABLE IF NOT EXISTS user_preferences (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    device_id TEXT,
    preference_key TEXT NOT NULL,
    preference_value TEXT NOT NULL, -- JSON value
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    UNIQUE(user_id, device_id, preference_key)
);

-- Sync metadata (for tracking changes and enabling real-time sync)
CREATE TABLE IF NOT EXISTS sync_metadata (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN ('INSERT', 'UPDATE', 'DELETE')),
    changed_at TEXT NOT NULL DEFAULT (datetime('now')),
    changed_by_device TEXT,
    FOREIGN KEY (changed_by_device) REFERENCES devices(id)
);

-- Create indices for performance
CREATE INDEX IF NOT EXISTS idx_pages_profile ON pages(profile_id);
CREATE INDEX IF NOT EXISTS idx_widgets_page ON widgets(page_id);
CREATE INDEX IF NOT EXISTS idx_theme_settings_profile ON theme_settings(profile_id);
CREATE INDEX IF NOT EXISTS idx_background_configs_profile ON background_configs(profile_id);
CREATE INDEX IF NOT EXISTS idx_background_triggers_profile ON background_triggers(profile_id);
CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences(user_id);
CREATE INDEX IF NOT EXISTS idx_sync_metadata_changed_at ON sync_metadata(changed_at);
CREATE INDEX IF NOT EXISTS idx_user_devices_device ON user_devices(device_id);
