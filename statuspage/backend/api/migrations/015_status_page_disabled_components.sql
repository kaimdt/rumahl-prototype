-- Additive v15 migration: decide per status page whether paused monitors remain visible.
ALTER TABLE status_pages ADD COLUMN show_disabled_components TINYINT(1) NOT NULL DEFAULT 1 AFTER domain_enabled;

