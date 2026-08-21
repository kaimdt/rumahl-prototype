-- Migration 044: Device registry (Package 3 — Devices as first-class citizens)
--
-- Manually curated devices (gaming PC, NAS, TV, printer, ...) with a MAC
-- address for Wake-on-LAN. Auto-discovered network devices stay in
-- rumahl-network-monitor; this registry adds the human layer: friendly name,
-- type, WOL capability and notes.

CREATE TABLE IF NOT EXISTS device_registry (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    device_type TEXT NOT NULL DEFAULT 'computer',
    mac_address TEXT,
    ip_address TEXT,
    wake_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_device_registry_created_by
    ON device_registry(created_by);
