-- rumahl Assist – Migration 002: AI Memory & Active Tasks
-- Adds persistent AI memory and user-requested active task support

-- ─── AI Memory ───────────────────────────────────────────────────────────────
-- Persistent key-value store for facts the AI should remember across sessions.
CREATE TABLE IF NOT EXISTS ai_memories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,                                     -- NULL = global / shared memory
    key TEXT NOT NULL,                                -- short label, e.g. "user_name"
    value TEXT NOT NULL,                              -- the remembered content
    category TEXT NOT NULL DEFAULT 'fact'
        CHECK (category IN ('fact', 'preference', 'instruction', 'context')),
    importance INTEGER NOT NULL DEFAULT 5
        CHECK (importance BETWEEN 1 AND 10),
    source TEXT NOT NULL DEFAULT 'ai'
        CHECK (source IN ('ai', 'user', 'system')),
    tags TEXT[] NOT NULL DEFAULT '{}',
    last_accessed TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    UNIQUE (COALESCE(user_id::TEXT, 'global'), key)
);

CREATE INDEX IF NOT EXISTS idx_ai_memories_user     ON ai_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_memories_category ON ai_memories(category);
CREATE INDEX IF NOT EXISTS idx_ai_memories_key      ON ai_memories(key);
CREATE INDEX IF NOT EXISTS idx_ai_memories_tags     ON ai_memories USING GIN(tags);
CREATE INDEX IF NOT EXISTS idx_ai_memories_importance ON ai_memories(importance DESC);

CREATE TRIGGER update_ai_memories_updated_at
    BEFORE UPDATE ON ai_memories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ─── Active Tasks (user-requested, one-shot) ─────────────────────────────────
-- Extend autonomous_tasks with columns needed for user-requested, time-triggered tasks.
ALTER TABLE autonomous_tasks
    ADD COLUMN IF NOT EXISTS user_id    UUID,
    ADD COLUMN IF NOT EXISTS trigger_at TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS is_one_shot BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS origin     TEXT NOT NULL DEFAULT 'system'
        CHECK (origin IN ('system', 'user', 'ai')),
    ADD COLUMN IF NOT EXISTS priority   INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_autonomous_tasks_user    ON autonomous_tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_autonomous_tasks_trigger ON autonomous_tasks(trigger_at)
    WHERE enabled = true AND is_one_shot = true;
CREATE INDEX IF NOT EXISTS idx_autonomous_tasks_origin  ON autonomous_tasks(origin);
