ALTER TABLE plan_runs
  ADD COLUMN IF NOT EXISTS provenance_json JSONB;