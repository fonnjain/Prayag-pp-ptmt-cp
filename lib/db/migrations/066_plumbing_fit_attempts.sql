CREATE TABLE IF NOT EXISTS plumbing_fit_attempts (
  id SERIAL PRIMARY KEY,
  source_run_id INTEGER NOT NULL REFERENCES plan_runs(id) ON DELETE CASCADE,
  request_fingerprint TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'running',
  failed_kind TEXT,
  error_text TEXT,
  pipe_requested_at TIMESTAMPTZ,
  pipe_responded_at TIMESTAMPTZ,
  fitting_requested_at TIMESTAMPTZ,
  fitting_responded_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  pipe_request_json JSONB,
  pipe_response_json JSONB,
  fitting_request_json JSONB,
  fitting_response_json JSONB,
  warnings_json JSONB,
  summary_json JSONB,
  production_run_id INTEGER REFERENCES plan_runs(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plumbing_fit_attempts_source_run_idx
  ON plumbing_fit_attempts(source_run_id);