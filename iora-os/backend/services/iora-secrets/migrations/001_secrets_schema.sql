-- IORA Secrets Schema
-- Encrypted storage for sensitive data

CREATE TABLE IF NOT EXISTS secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    encrypted_value BYTEA NOT NULL,
    encryption_nonce BYTEA NOT NULL,
    secret_type VARCHAR(50) NOT NULL,  -- api_key, password, token, certificate
    allowed_services JSONB DEFAULT '[]'::jsonb,
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),
    rotation_count INTEGER DEFAULT 0,
    last_rotated_at TIMESTAMP
);

CREATE INDEX idx_secrets_name ON secrets(name);
CREATE INDEX idx_secrets_type ON secrets(secret_type);
CREATE INDEX idx_secrets_expires_at ON secrets(expires_at) WHERE expires_at IS NOT NULL;

-- Audit log for all secret access
CREATE TABLE IF NOT EXISTS secret_access_log (
    id SERIAL PRIMARY KEY,
    secret_id UUID REFERENCES secrets(id) ON DELETE CASCADE,
    service_name VARCHAR(255) NOT NULL,
    access_type VARCHAR(50) NOT NULL,  -- read, update, delete, rotate
    success BOOLEAN NOT NULL,
    error_message TEXT,
    ip_address VARCHAR(45),
    timestamp TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_access_log_secret_id ON secret_access_log(secret_id);
CREATE INDEX idx_access_log_service ON secret_access_log(service_name);
CREATE INDEX idx_access_log_timestamp ON secret_access_log(timestamp DESC);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_secrets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER secrets_updated_at_trigger
    BEFORE UPDATE ON secrets
    FOR EACH ROW
    EXECUTE FUNCTION update_secrets_updated_at();
