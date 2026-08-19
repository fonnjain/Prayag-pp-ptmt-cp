ALTER TABLE plan_runs ADD COLUMN IF NOT EXISTS effective_from TEXT;
ALTER TABLE plant_plan_uploads ADD COLUMN IF NOT EXISTS effective_from TEXT;
ALTER TABLE corrective_plan_runs ADD COLUMN IF NOT EXISTS effective_from TEXT;

CREATE TABLE IF NOT EXISTS plant_plan_versions (
  id SERIAL PRIMARY KEY,
  month TEXT NOT NULL,
  segment TEXT NOT NULL DEFAULT 'PTMT',
  kind TEXT NOT NULL,
  source_id INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  source_label TEXT,
  targets_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS plant_plan_versions_source_unique
  ON plant_plan_versions (kind, source_id);

-- Existing rows are legacy history. The earliest issued plan starts the month;
-- later records use their recorded creation/as-of date until an operator
-- explicitly corrects an effective date.
WITH ranked AS (
  SELECT id, month,
         row_number() OVER (PARTITION BY month, segment ORDER BY created_at, id) AS version_number,
         created_at
  FROM plan_runs
  WHERE status = 'finalized'
)
UPDATE plan_runs r
SET effective_from = CASE
  WHEN ranked.version_number = 1 THEN ranked.month || '-01'
  ELSE to_char(ranked.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
END
FROM ranked
WHERE r.id = ranked.id AND r.effective_from IS NULL;

UPDATE plant_plan_uploads
SET effective_from = to_char(uploaded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
WHERE effective_from IS NULL;

UPDATE corrective_plan_runs
SET effective_from = COALESCE(as_of_date, to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'))
WHERE effective_from IS NULL;