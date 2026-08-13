-- Migration 037: Runtime permission requests
--
-- Android/iOS-style permission dialogs: a component (app, plugin, system
-- surface) requests an OS permission that the user has not granted yet. The
-- request sits here as `pending`; the user answers with Allow/Deny in the
-- OS shell dialog. Approving writes the grant into `user_os_permissions`
-- (migration 033) so `effective_os_permissions` picks it up immediately.
--
-- Design notes:
--   * One active request per user; a request can only be answered while
--     `pending` (409 on stale answers).
--   * `requester` is a display name ("Files", "Photos", "system", ...) and
--     `scope` is the technical context (app id, `system`).
--   * Denied requests are kept for audit; the dialog skips non-pending ones.

CREATE TABLE IF NOT EXISTS permission_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    permission TEXT NOT NULL,
    requester TEXT NOT NULL DEFAULT 'system',
    scope TEXT NOT NULL DEFAULT 'system',
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    responded_at TIMESTAMPTZ,
    responded_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_permission_requests_user_status
    ON permission_requests(user_id, status);
