-- Additive v14 migration: tenant-owned header, navigation and footer configuration.
ALTER TABLE status_pages ADD COLUMN header_config JSON NULL AFTER header_brand_mode;
ALTER TABLE status_pages ADD COLUMN nav_links JSON NULL AFTER header_config;
ALTER TABLE status_pages ADD COLUMN footer_config JSON NULL AFTER nav_links;
ALTER TABLE status_pages ADD COLUMN footer_links JSON NULL AFTER footer_config;

