CREATE TABLE IF NOT EXISTS desktop_commands (
    id SERIAL PRIMARY KEY,
    device_id TEXT NOT NULL,
    command TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'acknowledged')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_desktop_commands_device_id_status ON desktop_commands(device_id, status);
