CREATE TABLE IF NOT EXISTS account_users (
    id UUID PRIMARY KEY,
    email VARCHAR(320) NOT NULL,
    email_normalized VARCHAR(320) UNIQUE NOT NULL,
    display_name VARCHAR(120) NOT NULL,
    password_hash TEXT NOT NULL,
    email_verified_at TIMESTAMPTZ,
    status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deleted')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS account_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
    token_hash CHAR(64) UNIQUE NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_agent TEXT,
    ip_address INET,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_organizations (
    id UUID PRIMARY KEY,
    slug VARCHAR(80) UNIQUE NOT NULL,
    name VARCHAR(160) NOT NULL,
    created_by UUID NOT NULL REFERENCES account_users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_organization_members (
    organization_id UUID NOT NULL REFERENCES account_organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
    role VARCHAR(24) NOT NULL CHECK (role IN ('owner', 'admin', 'developer', 'viewer')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS account_registry_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES account_users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES account_organizations(id) ON DELETE CASCADE,
    name VARCHAR(120) NOT NULL,
    token_hash CHAR(64) UNIQUE NOT NULL,
    scopes TEXT[] NOT NULL DEFAULT '{}',
    expires_at TIMESTAMPTZ,
    last_used_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS account_audit_log (
    id BIGSERIAL PRIMARY KEY,
    actor_user_id UUID REFERENCES account_users(id) ON DELETE SET NULL,
    event_type VARCHAR(100) NOT NULL,
    subject_type VARCHAR(60) NOT NULL,
    subject_id TEXT,
    ip_address INET,
    user_agent TEXT,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_account_sessions_user ON account_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_account_sessions_expiry ON account_sessions(expires_at) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_account_members_user ON account_organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_account_registry_tokens_user ON account_registry_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_account_audit_actor_time ON account_audit_log(actor_user_id, created_at DESC);
