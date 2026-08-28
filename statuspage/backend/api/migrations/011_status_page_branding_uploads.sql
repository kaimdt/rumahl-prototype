-- Additive v11 migration for uploaded and theme-specific branding.
ALTER TABLE status_pages ADD COLUMN logo_dark_url VARCHAR(500) NULL AFTER logo_url;
ALTER TABLE status_pages ADD COLUMN logo_mode VARCHAR(20) NOT NULL DEFAULT 'same' AFTER logo_dark_url;
ALTER TABLE status_pages ADD COLUMN custom_css MEDIUMTEXT NULL AFTER custom_css_url;
