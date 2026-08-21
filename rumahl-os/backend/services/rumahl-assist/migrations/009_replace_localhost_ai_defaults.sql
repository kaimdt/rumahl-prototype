-- Normalize bootstrap local AI provider defaults to IPv4 loopback.
-- ORA Assist is a native rumahl OS service, so this points to the device itself.
UPDATE provider_configs
SET config = jsonb_set(config::jsonb, '{base_url}', '"http://127.0.0.1:11434"'::jsonb)::json
WHERE provider_type IN ('local', 'ollama', 'localai')
  AND config->>'base_url' IN ('http://localhost:11434', 'http://rumahl-ai:11434');
