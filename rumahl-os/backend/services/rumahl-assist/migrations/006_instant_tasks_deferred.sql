-- rumahl Assist – Migration 006: Instant Tasks – deferred status
--
-- Extends the instant_tasks table so that long-running tasks can be marked
-- as "deferred" instead of failing.  The worker keeps running; when it
-- finally completes it queues a notification so the result is delivered even
-- if the SSE listener has disconnected.

-- Widen the status check constraint to accept the new "deferred" value.
ALTER TABLE instant_tasks DROP CONSTRAINT IF EXISTS instant_tasks_status_check;
ALTER TABLE instant_tasks
    ADD CONSTRAINT instant_tasks_status_check
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'deferred'));

-- Track whether the result should be delivered as a notification once it arrives.
ALTER TABLE instant_tasks
    ADD COLUMN IF NOT EXISTS notify_on_complete BOOLEAN NOT NULL DEFAULT FALSE;

-- Timestamp when the deferred marker was set (useful for ETA display).
ALTER TABLE instant_tasks
    ADD COLUMN IF NOT EXISTS deferred_at TIMESTAMP WITH TIME ZONE;
