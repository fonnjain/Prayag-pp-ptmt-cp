CREATE TABLE IF NOT EXISTS mrp_control_sources (
  id SERIAL PRIMARY KEY,
  source_filename TEXT NOT NULL,
  source_sha256 TEXT NOT NULL UNIQUE,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  product_row_count INTEGER NOT NULL DEFAULT 0,
  discontinued_row_count INTEGER NOT NULL DEFAULT 0,
  excluded_row_count INTEGER NOT NULL DEFAULT 0,
  series_value_count INTEGER NOT NULL DEFAULT 0,
  planning_approved BOOLEAN NOT NULL DEFAULT FALSE,
  hold_reason TEXT,
  validation_status TEXT NOT NULL DEFAULT 'valid'
);

CREATE TABLE IF NOT EXISTS mrp_control_rows (
  id SERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES mrp_control_sources(id) ON DELETE CASCADE,
  row_type TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  item_code TEXT NOT NULL,
  division TEXT NOT NULL DEFAULT '',
  series TEXT NOT NULL DEFAULT '',
  product_name TEXT,
  size TEXT,
  mrp TEXT,
  effective_date TEXT,
  previous_mrp TEXT,
  colour_prices JSONB NOT NULL DEFAULT '{}'::jsonb,
  discontinued BOOLEAN NOT NULL DEFAULT FALSE,
  discontinued_from TEXT,
  segment TEXT,
  planning_category TEXT,
  classification_status TEXT NOT NULL DEFAULT 'hold',
  is_loadable BOOLEAN NOT NULL DEFAULT TRUE,
  raw JSONB NOT NULL,
  UNIQUE(source_id, row_type, source_row)
);
CREATE INDEX IF NOT EXISTS mrp_control_rows_source_item_idx ON mrp_control_rows(source_id, item_code);
CREATE INDEX IF NOT EXISTS mrp_control_rows_source_segment_idx ON mrp_control_rows(source_id, segment);

CREATE TABLE IF NOT EXISTS mrp_series_values (
  id SERIAL PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES mrp_control_sources(id) ON DELETE CASCADE,
  series TEXT NOT NULL,
  code_count INTEGER NOT NULL DEFAULT 0,
  sample_codes TEXT,
  UNIQUE(source_id, series)
);