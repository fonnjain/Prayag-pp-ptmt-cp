CREATE TABLE IF NOT EXISTS plant_month_snapshots (
  id SERIAL PRIMARY KEY,
  month TEXT NOT NULL,
  segment TEXT NOT NULL DEFAULT 'PTMT',
  payload_json JSONB NOT NULL,
  source_plan_versions_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  closed_at TIMESTAMPTZ NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  captured_commit_sha TEXT,
  backfilled BOOLEAN NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX IF NOT EXISTS plant_month_snapshots_month_segment_unique
  ON plant_month_snapshots (month, segment);