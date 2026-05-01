-- Service registration approvals and OS update history for the
-- Admin Control Center (`AdminPanelPhase2.tsx`).
--
-- Registrations: external services / plugins request to register with
-- iora-core via heartbeat. Until an admin approves, they are listed
-- here. The lifecycle is:
--   pending -> approved -> (suspended | revoked)
--   pending -> rejected
CREATE TABLE IF NOT EXISTS service_registrations (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    provider_type TEXT NOT NULL DEFAULT 'plugin', -- 'app' | 'plugin'
    name TEXT NOT NULL,
    version TEXT NOT NULL DEFAULT '0.0.0',
    developer TEXT NOT NULL DEFAULT 'unknown',
    description TEXT NOT NULL DEFAULT '',
    requested_permissions TEXT NOT NULL DEFAULT '[]', -- JSON array
    status TEXT NOT NULL DEFAULT 'pending',           -- pending|approved|rejected|suspended|revoked
    api_token TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewer TEXT
);
CREATE INDEX IF NOT EXISTS idx_service_registrations_status
    ON service_registrations(status);

-- OS update history. New entries are inserted by the updates/install
-- and updates/rollback handlers (the iora-updater binary is invoked
-- separately). This table is the audit trail surfaced to the admin UI.
CREATE TABLE IF NOT EXISTS update_history (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL,
    from_version TEXT NOT NULL DEFAULT '',
    to_version TEXT NOT NULL,
    status TEXT NOT NULL,                         -- success|failed|rolled_back|in_progress
    installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    error_message TEXT
);
CREATE INDEX IF NOT EXISTS idx_update_history_installed
    ON update_history(installed_at DESC);
