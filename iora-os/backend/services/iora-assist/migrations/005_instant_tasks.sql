-- IORA Assist – Migration 005: Instant Tasks
-- Instant Tasks are fire-and-forget jobs that the AI creates when it cannot
-- answer a question directly (e.g. "Wie ist das Wetter?", "Was sind aktuelle
-- Nachrichten?").  A background worker picks them up, runs the appropriate
-- tool (search, scrape, AI synthesis, …), and delivers the result in real-time
-- via SSE.

CREATE TABLE IF NOT EXISTS instant_tasks (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Who created this task (session token or user_id, nullable for anon)
    session_id      TEXT,
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,

    -- What kind of work to do
    -- "search"      → internet search via DuckDuckGo / search engine
    -- "weather"     → weather look-up
    -- "news"        → news aggregation
    -- "music"       → music / media search
    -- "generic"     → AI decides how to handle it
    task_type       TEXT NOT NULL DEFAULT 'generic'
                        CHECK (task_type IN ('search', 'weather', 'news', 'music', 'generic')),

    -- The raw query or instruction from the AI / user
    query           TEXT NOT NULL,

    -- Optional extra parameters (e.g. {"location":"Berlin"} for weather)
    params          JSONB NOT NULL DEFAULT '{}',

    -- Processing state
    status          TEXT NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),

    -- The result once completed
    result_text     TEXT,
    result_data     JSONB,

    -- Error description if status = 'failed'
    error_message   TEXT,

    created_at      TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    started_at      TIMESTAMP WITH TIME ZONE,
    completed_at    TIMESTAMP WITH TIME ZONE
);

-- The background worker polls for pending tasks
CREATE INDEX IF NOT EXISTS idx_instant_tasks_pending
    ON instant_tasks(status, created_at)
    WHERE status = 'pending';

-- Let the SSE endpoint and the poller look up a single task quickly
CREATE INDEX IF NOT EXISTS idx_instant_tasks_session
    ON instant_tasks(session_id)
    WHERE session_id IS NOT NULL;

COMMENT ON TABLE  instant_tasks              IS 'Fire-and-forget tasks resolved in real-time by the background worker';
COMMENT ON COLUMN instant_tasks.task_type    IS 'search|weather|news|music|generic';
COMMENT ON COLUMN instant_tasks.query        IS 'The natural-language query the worker must resolve';
COMMENT ON COLUMN instant_tasks.status       IS 'pending|processing|completed|failed';
COMMENT ON COLUMN instant_tasks.result_text  IS 'Human-readable answer synthesised by the AI from tool results';
COMMENT ON COLUMN instant_tasks.result_data  IS 'Structured data returned by the tool (search hits, weather JSON, …)';
