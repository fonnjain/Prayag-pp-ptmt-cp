-- Immutable evidence for the live Pending order report. run_id is nullable
-- because validation reads do not create a plan run; run-linked captures still
-- cascade with their plan run.
CREATE TABLE IF NOT EXISTS pending_read_snapshots (
  id                    SERIAL PRIMARY KEY,
  run_id                INTEGER REFERENCES plan_runs(id) ON DELETE CASCADE,
  capture_context       TEXT NOT NULL,
  segment               TEXT NOT NULL,
  source_role           TEXT NOT NULL DEFAULT 'pending_current_live',
  source_kind           TEXT NOT NULL,
  source_name           TEXT NOT NULL,
  source_spreadsheet_id TEXT,
  source_tab_name       TEXT,
  captured_at           TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  status                TEXT NOT NULL DEFAULT 'captured',
  raw_rows_json         JSONB NOT NULL DEFAULT '[]'::jsonb,
  parsed_rows_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  diagnostics_json      JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_text            TEXT
);

CREATE INDEX IF NOT EXISTS pending_read_snapshots_run_id_idx
  ON pending_read_snapshots(run_id);
CREATE INDEX IF NOT EXISTS pending_read_snapshots_segment_captured_idx
  ON pending_read_snapshots(segment, captured_at);