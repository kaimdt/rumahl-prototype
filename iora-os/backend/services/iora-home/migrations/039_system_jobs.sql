-- Migration 034: System-wide job manager
--
-- Downloads, file operations, backups, imports and updates run as background
-- jobs that survive app switches. The table is the source of truth for the
-- Job Center UI and the `ora.jobs` SDK surface (permission AppQueueManage).
--
-- Design notes:
--   * `status` lifecycle: queued -> running -> paused/completed/failed/cancelled.
--     A paused job can be resumed; cancelled is terminal.
--   * `progress` is an integer 0..100 updated by the executing side.
--   * `metadata` carries source-specific payload (download URL, target paths,
--     backup id, ...) so the UI can render contextual actions without extra
--     endpoints.
--   * `created_by` records the user or system component that started the job
--     (used for per-user filtering once profiles land in Package 1).

CREATE TABLE IF NOT EXISTS system_jobs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    job_type TEXT NOT NULL DEFAULT 'generic',
    status TEXT NOT NULL DEFAULT 'queued',
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'system',
    metadata JSONB NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_jobs_status ON system_jobs(status);
CREATE INDEX IF NOT EXISTS idx_system_jobs_created_at ON system_jobs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_jobs_created_by ON system_jobs(created_by);
