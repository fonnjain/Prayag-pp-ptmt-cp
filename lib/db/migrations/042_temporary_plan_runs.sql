ALTER TABLE plan_runs
  ADD COLUMN IF NOT EXISTS plan_type TEXT NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS temporary_run_id INTEGER;

CREATE INDEX IF NOT EXISTS plan_runs_temporary_run_id_idx
  ON plan_runs(temporary_run_id);