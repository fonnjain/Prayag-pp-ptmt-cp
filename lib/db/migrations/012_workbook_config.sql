CREATE TABLE IF NOT EXISTS workbook_config (
  id TEXT PRIMARY KEY,
  division TEXT NOT NULL,
  month TEXT NOT NULL,
  workbook_id TEXT NOT NULL,
  label TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
