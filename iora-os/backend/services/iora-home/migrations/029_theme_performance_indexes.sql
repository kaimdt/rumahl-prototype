-- Theme Performance Indexes
-- ========================
-- list_themes does: SELECT * FROM installed_themes ORDER BY system DESC, name ASC
-- Without an index, this is a full table scan. Add a composite index.
CREATE INDEX IF NOT EXISTS idx_installed_themes_list 
    ON installed_themes (system DESC, name ASC);

-- user_theme_selections uses ON CONFLICT(profile_id) in upserts.
-- Without a unique index, every upsert scans the whole table.
-- Since we use ON CONFLICT(profile_id), we need a unique constraint/index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_theme_sel_profile 
    ON user_theme_selections (profile_id);
