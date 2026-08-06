-- Plant Production Plan Uploads
-- Stores the capacity/labour-feasible plan given back by the plant for a given month.
-- This uploaded plan is the "master" for that period.

CREATE TABLE IF NOT EXISTS plant_plan_uploads (
  id           SERIAL PRIMARY KEY,
  month        TEXT NOT NULL,          -- e.g. '2026-08'
  segment      TEXT NOT NULL DEFAULT 'Plumbing',  -- 'Plumbing' | 'PTMT'
  filename     TEXT NOT NULL,
  item_count   INTEGER NOT NULL DEFAULT 0,
  summary_json JSONB,                  -- per-material summary from the Summary sheet
  uploaded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plant_plan_uploads_month_segment
  ON plant_plan_uploads (month, segment, uploaded_at DESC);

CREATE TABLE IF NOT EXISTS plant_plan_items (
  id             SERIAL PRIMARY KEY,
  upload_id      INTEGER NOT NULL REFERENCES plant_plan_uploads(id) ON DELETE CASCADE,
  item_type      TEXT NOT NULL,        -- 'PIPE' | 'FITTING'
  item_code      TEXT NOT NULL,
  material       TEXT NOT NULL,        -- 'CPVC' | 'SWR' | 'UPVC' | 'AGRI'
  requested_pcs  REAL NOT NULL DEFAULT 0,
  feasible_pcs   REAL NOT NULL DEFAULT 0,
  shortfall_pcs  REAL NOT NULL DEFAULT 0,
  requested_kg   REAL NOT NULL DEFAULT 0,
  feasible_kg    REAL NOT NULL DEFAULT 0,
  shortfall_kg   REAL NOT NULL DEFAULT 0,
  machines       TEXT,
  note           TEXT
);

CREATE INDEX IF NOT EXISTS plant_plan_items_upload_id ON plant_plan_items (upload_id);
