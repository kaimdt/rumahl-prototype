-- Presence-based automation rules
-- rumahl can autonomously control devices based on person movement patterns

CREATE TABLE IF NOT EXISTS automation_rules (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    rule_type TEXT NOT NULL,               -- 'presence_light', 'arrival_light', 'departure_light', 'custom'
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    trigger_config JSONB NOT NULL,         -- defines when rule fires
    condition_config JSONB NOT NULL DEFAULT '{}',   -- optional conditions
    action_config JSONB NOT NULL,          -- what to do
    cooldown_seconds INTEGER NOT NULL DEFAULT 60,   -- prevent rapid re-triggering
    last_triggered_at TIMESTAMPTZ,
    trigger_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Example trigger_config for arrival_light:
-- {"person_entity_id": "person.alice", "event": "arriving", "minutes_before_arrival": 5}
-- Example action_config:
-- {"entity_id": "light.alice_room", "service": "light/turn_on", "data": {"brightness": 200}}

CREATE INDEX IF NOT EXISTS idx_automation_rules_type ON automation_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_automation_rules_enabled ON automation_rules(enabled);

-- Automation execution log
CREATE TABLE IF NOT EXISTS automation_executions (
    id BIGSERIAL PRIMARY KEY,
    rule_id TEXT NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    triggered_by TEXT NOT NULL,            -- what triggered this execution
    trigger_data JSONB,                    -- context data at trigger time
    success BOOLEAN NOT NULL,
    result JSONB,                          -- response from HA service call
    error TEXT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_executions_rule ON automation_executions(rule_id);
CREATE INDEX IF NOT EXISTS idx_automation_executions_time ON automation_executions(executed_at DESC);
