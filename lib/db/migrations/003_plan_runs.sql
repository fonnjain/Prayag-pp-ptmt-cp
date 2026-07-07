CREATE TABLE IF NOT EXISTS plan_runs (
  id SERIAL PRIMARY KEY,
  month TEXT NOT NULL,
  as_of_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status TEXT NOT NULL DEFAULT 'draft',
  factors_json JSONB NOT NULL DEFAULT '{}',
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS plan_run_inputs (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES plan_runs(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  colour TEXT NOT NULL,
  avg_3mo_sale REAL NOT NULL DEFAULT 0,
  stock REAL NOT NULL DEFAULT 0,
  pending_current REAL NOT NULL DEFAULT 0,
  pending_last_month REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS plan_run_results (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES plan_runs(id) ON DELETE CASCADE,
  item_code TEXT NOT NULL,
  colour TEXT NOT NULL,
  category TEXT NOT NULL,
  buffer_req REAL NOT NULL DEFAULT 0,
  min_production REAL NOT NULL DEFAULT 0,
  production_plan REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS pending_snapshots (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES plan_runs(id) ON DELETE CASCADE,
  cat_no TEXT NOT NULL,
  colour TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS plan_run_inputs_run_id_idx ON plan_run_inputs(run_id);
CREATE INDEX IF NOT EXISTS plan_run_results_run_id_idx ON plan_run_results(run_id);
CREATE INDEX IF NOT EXISTS pending_snapshots_run_id_idx ON pending_snapshots(run_id);
CREATE INDEX IF NOT EXISTS plan_runs_month_idx ON plan_runs(month);
