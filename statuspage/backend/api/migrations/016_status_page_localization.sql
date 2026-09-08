-- Additive v16 migration: page-owned locale selection and translated content.
ALTER TABLE status_pages ADD COLUMN default_language VARCHAR(10) NOT NULL DEFAULT 'en' AFTER show_disabled_components;
ALTER TABLE status_pages ADD COLUMN enabled_locales JSON NULL AFTER default_language;
ALTER TABLE status_pages ADD COLUMN translations JSON NULL AFTER enabled_locales;
