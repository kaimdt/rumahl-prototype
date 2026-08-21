-- Migration 036: Session restore
--
-- Persists open OS windows (page, layout, geometry, z-order, minimized)
-- per user so the desktop comes back after login / page reload — the
-- "Session Restore" feature of the OS shell (Package 0, Feature 4).
--
-- Design notes:
--   * One row per (user, page). The frontend PUTs the complete window set
--     (debounced) and GETs it back on boot; localStorage is the offline
--     fallback when the backend is unreachable.
--   * `layout` mirrors the frontend OsWindowLayout string ('window',
--     'maximized', 'left', 'right', 'top', 'bottom', quarter snap variants,
--     'split-left', 'split-right').

CREATE TABLE IF NOT EXISTS session_windows (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    page_id TEXT NOT NULL,
    layout TEXT NOT NULL DEFAULT 'window',
    x INTEGER NOT NULL DEFAULT 0,
    y INTEGER NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 880,
    height INTEGER NOT NULL DEFAULT 640,
    z INTEGER NOT NULL DEFAULT 0,
    minimized BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, page_id)
);

CREATE INDEX IF NOT EXISTS idx_session_windows_user
    ON session_windows(user_id);
