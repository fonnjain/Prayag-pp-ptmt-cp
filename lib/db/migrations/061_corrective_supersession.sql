-- Record the Production Plan that a corrective run supersedes.
-- Existing rows are backfilled only where plan_run_id unambiguously points to
-- a finalized Production Plan. Legacy live/temporary references remain NULL.
ALTER TABLE corrective_plan_runs
  ADD COLUMN IF NOT EXISTS supersedes_production_run_id INTEGER;

UPDATE corrective_plan_runs AS corrective
SET supersedes_production_run_id = corrective.plan_run_id
FROM plan_runs AS production
WHERE corrective.supersedes_production_run_id IS NULL
  AND corrective.plan_run_id IS NOT NULL
  AND production.id = corrective.plan_run_id
  AND production.plan_type = 'production'
  AND production.status = 'finalized';