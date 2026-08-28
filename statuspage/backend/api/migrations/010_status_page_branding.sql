-- Additive v10 migration for per-page branding assets.
ALTER TABLE status_pages ADD COLUMN custom_css_url VARCHAR(1000) NULL AFTER favicon_url;
