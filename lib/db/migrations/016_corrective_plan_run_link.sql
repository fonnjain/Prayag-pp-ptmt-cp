-- Corrective runs cite the immutable plan run they measured against.
-- NULL = baseline was a live rebuild (no finalized plan run existed at the time).
ALTER TABLE corrective_plan_runs
  ADD COLUMN IF NOT EXISTS plan_run_id INTEGER REFERENCES plan_runs(id) ON DELETE SET NULL;
