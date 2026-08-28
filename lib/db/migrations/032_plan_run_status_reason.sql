ALTER TABLE plan_runs
  ADD COLUMN IF NOT EXISTS plan_status_reason TEXT;