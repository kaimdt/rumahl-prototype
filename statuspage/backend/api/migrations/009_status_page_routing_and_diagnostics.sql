-- Additive v9 migration. Existing status pages remain reachable by both modes.
ALTER TABLE status_pages ADD COLUMN path_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER canonical_domain;
ALTER TABLE status_pages ADD COLUMN domain_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER path_enabled;
ALTER TABLE check_results ADD COLUMN diagnostic_json LONGTEXT NULL AFTER error;
ALTER TABLE check_results ADD COLUMN screenshot_url VARCHAR(1000) NULL AFTER diagnostic_json;
