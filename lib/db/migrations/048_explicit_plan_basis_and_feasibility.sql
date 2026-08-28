ALTER TABLE plan_run_results
  ADD COLUMN IF NOT EXISTS demand_plan REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feasibility_status TEXT NOT NULL DEFAULT 'not-scheduled';

-- Backfill the new demand field from the pre-existing result value. Existing
-- rows are preserved as historical snapshots; new fitted runs write demand and
-- executable production separately.
UPDATE plan_run_results
SET demand_plan = production_plan
WHERE demand_plan = 0 AND production_plan <> 0;

ALTER TABLE corrective_plan_runs
  ADD COLUMN IF NOT EXISTS not_scheduled_total REAL NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unfulfillable_total REAL NOT NULL DEFAULT 0;

ALTER TABLE corrective_plan_items
  ADD COLUMN IF NOT EXISTS feasibility_status TEXT NOT NULL DEFAULT 'not-scheduled';

-- Existing corrective residuals were all represented as cannot-be-made. Keep
-- that audit history explicitly unfulfillable rather than guessing a
-- not-scheduled state for legacy rows.
UPDATE corrective_plan_items
SET feasibility_status = CASE
  WHEN cannot_be_made > 0 THEN 'unfulfillable'
  WHEN corrective_production > 0 OR temporary_corrective = 0 THEN 'fitted'
  ELSE 'not-scheduled'
END
WHERE feasibility_status = 'not-scheduled';

UPDATE corrective_plan_runs
SET unfulfillable_total = cannot_be_made_total
WHERE unfulfillable_total = 0 AND cannot_be_made_total <> 0;