-- Migration 045: Device agents (Package 3 — reachability probes)
--
-- Extends the device registry with an optional agent configuration for
-- reachability checks: `tcp` (host:port connect) or `http` (GET URL).
-- SSH/SNMP agents are planned follow-ups; the schema is forward-compatible.

ALTER TABLE device_registry ADD COLUMN IF NOT EXISTS agent_type TEXT;
ALTER TABLE device_registry ADD COLUMN IF NOT EXISTS agent_config JSONB NOT NULL DEFAULT '{}';
