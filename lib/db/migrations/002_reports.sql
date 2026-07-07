CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL,
  month TEXT NOT NULL,
  snapshot_date TEXT,
  filename TEXT NOT NULL,
  data_base64 TEXT NOT NULL,
  content_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS reports_month_idx ON reports (month);
CREATE INDEX IF NOT EXISTS reports_type_month_idx ON reports (type, month);
