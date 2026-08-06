-- Deterministic content fingerprint used by the duplicate-run guard:
-- a new corrective run whose fingerprint matches the latest run for the same
-- segment+month is reused instead of inserted.
ALTER TABLE corrective_plan_runs
  ADD COLUMN IF NOT EXISTS fingerprint TEXT;

CREATE INDEX IF NOT EXISTS idx_corrective_runs_seg_month_id
  ON corrective_plan_runs (segment, month, id DESC);
