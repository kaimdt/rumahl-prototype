-- Additive v12 migration for independent desktop/mobile header branding.
ALTER TABLE status_pages ADD COLUMN mobile_logo_url VARCHAR(500) NULL AFTER logo_dark_url;
ALTER TABLE status_pages ADD COLUMN mobile_logo_dark_url VARCHAR(500) NULL AFTER mobile_logo_url;
ALTER TABLE status_pages ADD COLUMN header_brand_mode VARCHAR(20) NOT NULL DEFAULT 'logo' AFTER logo_mode;
