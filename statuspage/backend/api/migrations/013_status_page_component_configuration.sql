-- Additive v13 migration: component presentation is configured independently per status page.
ALTER TABLE status_page_groups ADD COLUMN collapsed TINYINT(1) NOT NULL DEFAULT 0 AFTER position;
ALTER TABLE status_page_groups ADD COLUMN auto_expand TINYINT(1) NOT NULL DEFAULT 1 AFTER collapsed;
ALTER TABLE status_page_services ADD COLUMN enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER position;
ALTER TABLE status_page_services ADD COLUMN history_days INT NOT NULL DEFAULT 90 AFTER show_performance;

