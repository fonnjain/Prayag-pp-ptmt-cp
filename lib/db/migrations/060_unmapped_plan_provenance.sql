ALTER TABLE plan_run_results
  ADD COLUMN IF NOT EXISTS item_name TEXT,
  ADD COLUMN IF NOT EXISTS source_role TEXT,
  ADD COLUMN IF NOT EXISTS unmapped_reason TEXT;