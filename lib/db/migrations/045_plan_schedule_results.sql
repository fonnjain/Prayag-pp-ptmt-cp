CREATE TABLE IF NOT EXISTS plan_schedule_results (
  id SERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL,
  run_id INTEGER NOT NULL REFERENCES plan_runs(id) ON DELETE CASCADE,
  month TEXT NOT NULL,
  segment TEXT NOT NULL,
  kind TEXT NOT NULL,
  week_days INTEGER[] NOT NULL,
  request_json JSONB NOT NULL,
  result_json JSONB NOT NULL,
  demand_pieces REAL NOT NULL DEFAULT 0,
  demand_kg REAL,
  scheduled_pieces REAL NOT NULL DEFAULT 0,
  scheduled_kg REAL,
  unfinished_pieces REAL NOT NULL DEFAULT 0,
  unfinished_kg REAL NOT NULL DEFAULT 0,
  unfinished_hours REAL NOT NULL DEFAULT 0,
  capacity_hours REAL NOT NULL DEFAULT 0,
  scheduled_hours REAL NOT NULL DEFAULT 0,
  idle_hours REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plan_schedule_results_run_created_idx
  ON plan_schedule_results (run_id, created_at DESC);