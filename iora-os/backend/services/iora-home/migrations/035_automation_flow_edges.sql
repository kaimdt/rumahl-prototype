-- Package 4: persist the authored automation graph instead of reconstructing
-- a linear chain from node arrays on every read.
ALTER TABLE automation_rules
    ADD COLUMN IF NOT EXISTS flow_edges JSONB NOT NULL DEFAULT '[]'::jsonb;
