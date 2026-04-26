-- Add sub-page and display mode support to pages
ALTER TABLE pages ADD COLUMN IF NOT EXISTS show_in_nav BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE pages ADD COLUMN IF NOT EXISTS display_mode TEXT NOT NULL DEFAULT 'page';
ALTER TABLE pages ADD COLUMN IF NOT EXISTS parent_page_id TEXT;
