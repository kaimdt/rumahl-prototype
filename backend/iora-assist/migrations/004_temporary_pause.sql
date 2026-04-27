-- IORA Assist – Migration 004: Temporary Task Pausing
-- Supports "disable my alarm for 2 weeks" without permanently deleting the task.
-- The task engine auto-resumes the task once paused_until passes.

ALTER TABLE autonomous_tasks
    -- Timestamp until which the task is temporarily paused.
    -- When the task engine sees paused_until <= NOW() and enabled = false (due to pause),
    -- it re-enables the task automatically.
    ADD COLUMN IF NOT EXISTS paused_until TIMESTAMP WITH TIME ZONE,

    -- Records whether the current disabled state is from a temporary pause
    -- (true) or a permanent disable (false).  Prevents auto-resume from
    -- reactivating tasks the user explicitly switched off.
    ADD COLUMN IF NOT EXISTS paused_temporarily BOOLEAN NOT NULL DEFAULT false;

-- Fast lookup so the task engine can find tasks that need auto-resuming each tick.
CREATE INDEX IF NOT EXISTS idx_autonomous_tasks_paused_until
    ON autonomous_tasks(paused_until)
    WHERE paused_until IS NOT NULL AND paused_temporarily = true;

COMMENT ON COLUMN autonomous_tasks.paused_until        IS 'Re-enable this task after this timestamp (temporary pause)';
COMMENT ON COLUMN autonomous_tasks.paused_temporarily  IS 'True when the task was disabled via a temporary pause request';
