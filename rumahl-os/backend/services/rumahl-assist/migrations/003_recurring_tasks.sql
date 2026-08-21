-- rumahl Assist – Migration 003: Recurring Task Scheduling
-- Adds rich recurrence support so the AI can create tasks like
-- "wake me Mon-Fri at 06:30" or "remind me daily for 2 weeks".

ALTER TABLE autonomous_tasks
    -- Recurrence type: how often the task fires
    ADD COLUMN IF NOT EXISTS recurrence_type TEXT NOT NULL DEFAULT 'once'
        CHECK (recurrence_type IN ('once', 'daily', 'weekdays', 'weekly', 'interval', 'custom')),

    -- Which days of the week the task fires (1=Mon…7=Sun, empty = every day).
    -- Stored as a JSONB array so it can hold arbitrary day lists.
    ADD COLUMN IF NOT EXISTS recurrence_days JSONB NOT NULL DEFAULT '[]',

    -- The clock time (in 24 h, UTC) at which the task fires each recurrence.
    -- NULL means "as soon as the next interval arrives".
    ADD COLUMN IF NOT EXISTS time_of_day TIME,

    -- Optional hard end date for the recurrence window.
    ADD COLUMN IF NOT EXISTS recurrence_end_at TIMESTAMP WITH TIME ZONE,

    -- Maximum number of times the task may fire (NULL = unlimited).
    ADD COLUMN IF NOT EXISTS occurrence_limit INTEGER,

    -- How many times the task has already fired.
    ADD COLUMN IF NOT EXISTS occurrence_count INTEGER NOT NULL DEFAULT 0,

    -- IANA timezone of the user so that "06:30" means local 06:30, not UTC 06:30.
    ADD COLUMN IF NOT EXISTS user_timezone TEXT NOT NULL DEFAULT 'UTC',

    -- Source input mode that originated this task.
    ADD COLUMN IF NOT EXISTS input_mode TEXT NOT NULL DEFAULT 'chat'
        CHECK (input_mode IN ('chat', 'voice', 'conversation'));

-- Fast lookup for recurring tasks that need execution
CREATE INDEX IF NOT EXISTS idx_autonomous_tasks_recurrence
    ON autonomous_tasks(recurrence_type, enabled)
    WHERE recurrence_type <> 'once';

-- Fast lookup for tasks about to expire
CREATE INDEX IF NOT EXISTS idx_autonomous_tasks_end
    ON autonomous_tasks(recurrence_end_at)
    WHERE recurrence_end_at IS NOT NULL AND enabled = true;

COMMENT ON COLUMN autonomous_tasks.recurrence_type    IS 'once|daily|weekdays|weekly|interval|custom';
COMMENT ON COLUMN autonomous_tasks.recurrence_days    IS 'JSON array of ISO weekday numbers 1=Mon…7=Sun';
COMMENT ON COLUMN autonomous_tasks.time_of_day        IS '24-h clock time (UTC) for each recurrence trigger';
COMMENT ON COLUMN autonomous_tasks.recurrence_end_at  IS 'Stop recurring after this timestamp';
COMMENT ON COLUMN autonomous_tasks.occurrence_limit   IS 'Maximum number of executions (NULL = unlimited)';
COMMENT ON COLUMN autonomous_tasks.occurrence_count   IS 'Number of times the task has fired so far';
COMMENT ON COLUMN autonomous_tasks.user_timezone      IS 'IANA timezone for interpreting time_of_day as local time';
COMMENT ON COLUMN autonomous_tasks.input_mode         IS 'How this task was created: chat, voice, or conversation';
