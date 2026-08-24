CREATE TABLE IF NOT EXISTS plan_run_input_snapshots (
  id SERIAL PRIMARY KEY,
  run_id INTEGER NOT NULL REFERENCES plan_runs(id) ON DELETE CASCADE,
  segment TEXT NOT NULL,
  source_role TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  source_upload_id INTEGER,
  source_filename TEXT,
  source_uploaded_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  parsed_rows_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  diagnostics_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT plan_run_input_snapshots_run_role_unique UNIQUE (run_id, source_role)
);

CREATE INDEX IF NOT EXISTS plan_run_input_snapshots_run_id_idx
  ON plan_run_input_snapshots(run_id);