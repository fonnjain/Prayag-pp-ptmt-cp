CREATE TABLE IF NOT EXISTS plan_run_supersessions (
  id SERIAL PRIMARY KEY,
  month TEXT NOT NULL,
  segment TEXT NOT NULL,
  production_run_id INTEGER NOT NULL REFERENCES plan_runs(id),
  temporary_run_id INTEGER NOT NULL REFERENCES plan_runs(id),
  reason TEXT NOT NULL,
  requested_by_user_id INTEGER NOT NULL REFERENCES users(id),
  requested_by_email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  superseding_run_id INTEGER REFERENCES plan_runs(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS plan_run_supersessions_production_run_idx
  ON plan_run_supersessions (production_run_id);

CREATE INDEX IF NOT EXISTS plan_run_supersessions_month_segment_idx
  ON plan_run_supersessions (month, segment);