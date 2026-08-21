-- Migration 007: Self-Evolution System for ORA AI
-- Enables ORA to plan, implement and track its own improvements via pi.dev

-- Evolution cycles: records of complete self-evolution runs
CREATE TABLE IF NOT EXISTS evolution_cycles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'running',
    phase_results JSONB DEFAULT '[]',
    summary TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Code change proposals: specific code modifications ORA wants to make
CREATE TABLE IF NOT EXISTS code_change_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    rationale TEXT NOT NULL DEFAULT '',
    file_path TEXT NOT NULL,
    change_type TEXT NOT NULL DEFAULT 'Modify',
    old_code TEXT,
    new_code TEXT NOT NULL DEFAULT '',
    expected_impact JSONB DEFAULT '{}',
    risk_level TEXT NOT NULL DEFAULT 'Medium',
    status TEXT NOT NULL DEFAULT 'Draft',
    review_notes TEXT,
    applied_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Knowledge base: learned patterns and best practices
CREATE TABLE IF NOT EXISTS knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    topic TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'self-evolution',
    tags TEXT[] DEFAULT '{}',
    confidence DOUBLE PRECISION DEFAULT 0.5,
    times_applied INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prompt templates for versioned prompt management
CREATE TABLE IF NOT EXISTS prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    content TEXT NOT NULL,
    variables TEXT[] DEFAULT '{}',
    metadata JSONB,
    is_active BOOLEAN DEFAULT true,
    performance_score DOUBLE PRECISION DEFAULT 0.5,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prompt task results for performance tracking
CREATE TABLE IF NOT EXISTS prompt_task_results (
    id SERIAL PRIMARY KEY,
    template_id UUID REFERENCES prompt_templates(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    success BOOLEAN NOT NULL,
    tokens_used INTEGER DEFAULT 0,
    duration_ms BIGINT DEFAULT 0,
    user_rating DOUBLE PRECISION,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Evolution proposals: ideas that ORA generates or receives about improving itself
CREATE TABLE IF NOT EXISTS evolution_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title TEXT NOT NULL,
    description TEXT,
    category TEXT NOT NULL DEFAULT 'feature',
    priority INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'proposed',
    rationale TEXT,
    estimated_effort TEXT,
    created_by TEXT NOT NULL DEFAULT 'ora',
    provider_used TEXT,
    model_used TEXT,
    implementation_plan JSONB,
    files_to_modify TEXT[],
    tests_required BOOLEAN DEFAULT true,
    approved_by TEXT,
    approved_at TIMESTAMPTZ,
    rejected_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Evolution implementations: actual code changes made during self-evolution
CREATE TABLE IF NOT EXISTS evolution_implementations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID REFERENCES evolution_proposals(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    change_type TEXT NOT NULL,
    old_content TEXT,
    new_content TEXT NOT NULL,
    diff_text TEXT,
    commit_message TEXT,
    implemented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    tests_passed BOOLEAN,
    test_results JSONB,
    verified_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Self-reflection log: ORA's learning from its own behavior
CREATE TABLE IF NOT EXISTS self_reflections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reflection_type TEXT NOT NULL,
    context TEXT NOT NULL,
    observation TEXT NOT NULL,
    lesson_learned TEXT,
    action_items JSONB,
    knowledge_updated BOOLEAN DEFAULT false,
    related_task_id UUID,
    related_proposal_id UUID REFERENCES evolution_proposals(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Self-evolution settings/preferences
CREATE TABLE IF NOT EXISTS evolution_settings (
    id SERIAL PRIMARY KEY,
    setting_key TEXT UNIQUE NOT NULL,
    setting_value JSONB NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert default evolution settings
INSERT INTO evolution_settings (setting_key, setting_value, description) VALUES
('auto_approve_threshold', '{"max_priority": 3}', 'Auto-approve proposals with priority <= this value'),
('require_tests', 'true', 'Require tests for all self-modifications'),
('rollback_on_failure', 'true', 'Automatically rollback if post-change tests fail'),
('evolution_interval_minutes', '1440', 'How often ORA should evaluate itself (default: daily)'),
('max_concurrent_proposals', '3', 'Maximum number of in-progress proposals at once'),
('allowed_categories', '["feature", "bugfix", "optimization"]', 'Categories ORA can propose without user approval'),
('pidev_enabled', 'true', 'Whether pi.dev provider is enabled for self-evolution')
ON CONFLICT (setting_key) DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_evolution_cycles_created ON evolution_cycles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_code_change_proposals_status ON code_change_proposals(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_topic ON knowledge_base(topic);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_confidence ON knowledge_base(confidence DESC);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_active ON prompt_templates(is_active);
CREATE INDEX IF NOT EXISTS idx_evolution_proposals_status ON evolution_proposals(status);
CREATE INDEX IF NOT EXISTS idx_evolution_proposals_category ON evolution_proposals(category);
CREATE INDEX IF NOT EXISTS idx_evolution_implementations_proposal ON evolution_implementations(proposal_id);
CREATE INDEX IF NOT EXISTS idx_self_reflections_type ON self_reflections(reflection_type);
CREATE INDEX IF NOT EXISTS idx_self_reflections_created ON self_reflections(created_at DESC);
