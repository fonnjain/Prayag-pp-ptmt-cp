ALTER TABLE corrective_plan_runs
  ADD COLUMN IF NOT EXISTS temporary_corrective_total REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS corrective_production_total REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cannot_be_made_total REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feasibility_json JSONB;

ALTER TABLE corrective_plan_items
  ADD COLUMN IF NOT EXISTS temporary_corrective REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS corrective_production REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cannot_be_made REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cannot_be_made_reason TEXT;