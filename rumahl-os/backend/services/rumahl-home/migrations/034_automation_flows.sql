-- Package 4: visual automation flow metadata.
-- Existing presence rules remain compatible; their legacy JSON objects are
-- normalized by the API into flow nodes when they are read.
ALTER TABLE automation_rules
    ADD COLUMN IF NOT EXISTS flow_version INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_automation_rules_updated
    ON automation_rules(updated_at DESC);
