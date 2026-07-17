-- Add segment column to corrective_plan_runs for Plumbing vs PTMT runs
ALTER TABLE corrective_plan_runs
  ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'PTMT';
