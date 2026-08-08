-- Persist the engine's per-category results (Cap/Day, feasible, shortfall,
-- capacityMethod) and the run-time working-days-remaining on each corrective
-- run, so Excel/PDF exports reuse the exact values the engine computed instead
-- of re-deriving Cap/Day from the category-capacity table (which reported 0
-- for Plumbing and produced 100%-shortfall exports).
ALTER TABLE corrective_plan_runs
  ADD COLUMN IF NOT EXISTS categories_json JSONB;

ALTER TABLE corrective_plan_runs
  ADD COLUMN IF NOT EXISTS working_days_remaining INTEGER;
