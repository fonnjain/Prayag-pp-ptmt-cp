CREATE TABLE IF NOT EXISTS plant_monitoring_snapshots (
  month TEXT PRIMARY KEY,
  plan_run_id INTEGER REFERENCES plan_runs(id),
  actuals_json JSONB NOT NULL DEFAULT '[]',
  targets_json JSONB NOT NULL DEFAULT '[]',
  bundle_json JSONB NOT NULL DEFAULT '{}',
  weekly_json JSONB NOT NULL DEFAULT '{}',
  source_info_json JSONB NOT NULL DEFAULT '{}',
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);