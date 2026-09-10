ALTER TABLE plan_runs
  ADD COLUMN IF NOT EXISTS supersedes_run_id INTEGER;