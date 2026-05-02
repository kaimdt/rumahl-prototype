-- ORA AI Database Schema
-- Phase 1: Conversations, Autonomous Tasks, and Provider Configuration

-- Conversation threads (non-per-chat model)
CREATE TABLE IF NOT EXISTS conversation_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_activity TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    context JSONB DEFAULT '{}',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_conversation_threads_user ON conversation_threads(user_id);
CREATE INDEX idx_conversation_threads_active ON conversation_threads(active);
CREATE INDEX idx_conversation_threads_last_activity ON conversation_threads(last_activity DESC);

-- Messages in continuous conversation
CREATE TABLE IF NOT EXISTS conversation_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID REFERENCES conversation_threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    provider TEXT, -- which AI provider generated this
    initiated_by TEXT CHECK (initiated_by IN ('user', 'ai', 'system')),
    timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_conversation_messages_thread ON conversation_messages(thread_id, timestamp DESC);
CREATE INDEX idx_conversation_messages_provider ON conversation_messages(provider);
CREATE INDEX idx_conversation_messages_initiated ON conversation_messages(initiated_by);

-- Autonomous tasks
CREATE TABLE IF NOT EXISTS autonomous_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_type TEXT NOT NULL, -- 'reminder', 'monitor', 'suggest', 'notify', 'calendar', 'automation'
    name TEXT NOT NULL,
    description TEXT,
    schedule TEXT, -- cron expression or interval
    enabled BOOLEAN DEFAULT true,
    assigned_provider TEXT, -- which AI provider should handle this
    config JSONB DEFAULT '{}',
    last_executed_at TIMESTAMP WITH TIME ZONE,
    next_execution_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_autonomous_tasks_enabled ON autonomous_tasks(enabled);
CREATE INDEX idx_autonomous_tasks_type ON autonomous_tasks(task_type);
CREATE INDEX idx_autonomous_tasks_next_execution ON autonomous_tasks(next_execution_at) WHERE enabled = true;

-- Task executions
CREATE TABLE IF NOT EXISTS task_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id UUID REFERENCES autonomous_tasks(id) ON DELETE CASCADE,
    executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    provider_used TEXT,
    result JSONB DEFAULT '{}',
    success BOOLEAN DEFAULT true,
    error_message TEXT,
    execution_duration_ms INTEGER,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_task_executions_task ON task_executions(task_id, executed_at DESC);
CREATE INDEX idx_task_executions_success ON task_executions(success);

-- Provider configurations (multi-provider support)
CREATE TABLE IF NOT EXISTS provider_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider_type TEXT NOT NULL CHECK (provider_type IN ('openai', 'anthropic', 'local', 'desktop')),
    purpose TEXT NOT NULL, -- 'chat', 'calendar', 'automation', 'monitoring', 'voice', 'general'
    config JSONB NOT NULL DEFAULT '{}', -- api_key, base_url, model, etc.
    priority INTEGER DEFAULT 0, -- higher priority = preferred for this purpose
    enabled BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_provider_configs_purpose ON provider_configs(purpose, priority DESC) WHERE enabled = true;
CREATE INDEX idx_provider_configs_type ON provider_configs(provider_type);

-- Proactive notifications queue
CREATE TABLE IF NOT EXISTS notification_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    message TEXT NOT NULL,
    priority INTEGER DEFAULT 0, -- higher = more urgent
    notification_type TEXT DEFAULT 'info', -- 'info', 'warning', 'reminder', 'alert'
    delivered BOOLEAN DEFAULT false,
    delivered_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    deliver_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB DEFAULT '{}'
);

CREATE INDEX idx_notification_queue_user ON notification_queue(user_id, delivered);
CREATE INDEX idx_notification_queue_deliver_at ON notification_queue(deliver_at) WHERE delivered = false;
CREATE INDEX idx_notification_queue_priority ON notification_queue(priority DESC, delivered) WHERE delivered = false;

-- AI insights and patterns (for learning user behavior)
CREATE TABLE IF NOT EXISTS ai_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    insight_type TEXT NOT NULL, -- 'pattern', 'suggestion', 'anomaly', 'optimization'
    title TEXT NOT NULL,
    description TEXT,
    confidence REAL CHECK (confidence >= 0 AND confidence <= 1),
    entities_involved TEXT[] DEFAULT '{}',
    suggested_action JSONB,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'applied', 'dismissed', 'expired')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_ai_insights_type ON ai_insights(insight_type, status);
CREATE INDEX idx_ai_insights_created ON ai_insights(created_at DESC);

-- Provider routing rules
CREATE TABLE IF NOT EXISTS provider_routing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_pattern TEXT NOT NULL, -- regex or keyword pattern
    preferred_provider_id UUID REFERENCES provider_configs(id) ON DELETE CASCADE,
    fallback_provider_ids UUID[] DEFAULT '{}',
    enabled BOOLEAN DEFAULT true,
    priority INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_provider_routing_enabled ON provider_routing_rules(enabled, priority DESC);

-- Conversation context snapshots (for maintaining state)
CREATE TABLE IF NOT EXISTS conversation_context_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID REFERENCES conversation_threads(id) ON DELETE CASCADE,
    snapshot_data JSONB NOT NULL,
    entity_states JSONB DEFAULT '{}',
    user_preferences JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_context_snapshots_thread ON conversation_context_snapshots(thread_id, created_at DESC);

-- Add trigger to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_autonomous_tasks_updated_at BEFORE UPDATE ON autonomous_tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_provider_configs_updated_at BEFORE UPDATE ON provider_configs
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Insert default provider configurations
INSERT INTO provider_configs (provider_type, purpose, priority, config) VALUES
    ('local', 'general', 100, '{"base_url": "http://127.0.0.1:11434", "model": "llama3.2"}'),
    ('local', 'chat', 90, '{"base_url": "http://127.0.0.1:11434", "model": "llama3.2"}'),
    ('local', 'monitoring', 80, '{"base_url": "http://127.0.0.1:11434", "model": "llama3.2"}')
ON CONFLICT DO NOTHING;

-- Insert sample autonomous tasks
INSERT INTO autonomous_tasks (task_type, name, description, schedule, enabled, assigned_provider, config) VALUES
    ('monitor', 'Home Status Monitor', 'Monitor home status and alert on anomalies', '*/15 * * * *', true, 'local', '{"check_entities": ["climate", "door", "window"]}'),
    ('calendar', 'Calendar Check', 'Check calendar for upcoming events', '0 * * * *', true, 'local', '{"lookahead_hours": 24}'),
    ('suggest', 'Automation Suggester', 'Suggest new automations based on patterns', '0 0 * * *', true, 'local', '{"min_confidence": 0.7}')
ON CONFLICT DO NOTHING;

COMMENT ON TABLE conversation_threads IS 'Continuous conversation threads (non-per-chat model)';
COMMENT ON TABLE conversation_messages IS 'All messages in conversations, including AI-initiated ones';
COMMENT ON TABLE autonomous_tasks IS 'Tasks that ORA AI executes autonomously';
COMMENT ON TABLE task_executions IS 'History of autonomous task executions';
COMMENT ON TABLE provider_configs IS 'Multi-provider configuration for parallel AI usage';
COMMENT ON TABLE notification_queue IS 'Queue for proactive AI-initiated notifications';
COMMENT ON TABLE ai_insights IS 'AI-generated insights and suggestions';
COMMENT ON TABLE provider_routing_rules IS 'Rules for routing tasks to appropriate AI providers';
