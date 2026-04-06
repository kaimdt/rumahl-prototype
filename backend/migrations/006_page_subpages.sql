-- Add sub-page and display mode support to pages
ALTER TABLE pages ADD COLUMN show_in_nav BOOLEAN NOT NULL DEFAULT 1;
ALTER TABLE pages ADD COLUMN display_mode TEXT NOT NULL DEFAULT 'page';
ALTER TABLE pages ADD COLUMN parent_page_id TEXT;
