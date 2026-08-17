-- Persist the frozen plan run's grand-max (Σ productionPlan from plan_run_results)
-- on the corrective run so exports can cross-check the corrective baseline against
-- the original frozen plan rather than against the same-source stored real column.
-- NULL on legacy rows; populated on every new corrective run when planRunId is set.
ALTER TABLE corrective_plan_runs
  ADD COLUMN IF NOT EXISTS frozen_plan_grand_max INTEGER;
