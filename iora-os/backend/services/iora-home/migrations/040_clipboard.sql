-- Migration 035: Clipboard manager
--
-- Personal clipboard history per user, shared across devices via the same
-- API (any authenticated device of the user reads/writes the store). The
-- frontend captures copy/cut events and posts them here; the Clipboard panel
-- (Ctrl+Shift+V) lists, pins, searches and re-copies entries.
--
-- Design notes:
--   * `content` is capped at 64 KiB by the handler; passwords are never
--     captured (frontend skips password inputs).
--   * Deduplication happens in the handler: posting the same content moves
--     the existing entry to the top instead of inserting a duplicate.
--   * `source` records where the entry came from (device/app identifier).

CREATE TABLE IF NOT EXISTS clipboard_entries (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'text',
    source TEXT NOT NULL DEFAULT 'web',
    created_by TEXT NOT NULL DEFAULT '',
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clipboard_created_by_created
    ON clipboard_entries(created_by, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_clipboard_created_by_pinned
    ON clipboard_entries(created_by, pinned DESC);
