ALTER TABLE plant_month_snapshots
  ADD COLUMN IF NOT EXISTS plan_status TEXT NOT NULL DEFAULT 'finalized';

ALTER TABLE plant_month_snapshots
  ADD COLUMN IF NOT EXISTS plan_status_reason TEXT;

ALTER TABLE plant_month_snapshots
  ADD COLUMN IF NOT EXISTS plan_evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb;