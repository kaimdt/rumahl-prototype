-- Theme Widget Templates (v2.4) – Theme-defined widget rendering
-- =============================================================
-- Themes can now provide HTML/CSS/JS templates for individual widget types,
-- completely replacing the default React widget rendering with custom designs.

ALTER TABLE installed_themes
ADD COLUMN IF NOT EXISTS widget_templates_json TEXT DEFAULT NULL;
