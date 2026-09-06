CREATE TABLE IF NOT EXISTS ptmt_buffer_multipliers (
  id SERIAL PRIMARY KEY,
  month TEXT NOT NULL,
  category TEXT NOT NULL,
  multiplier REAL,
  suggested_multiplier REAL,
  override_multiplier REAL,
  z_score REAL,
  cv_value REAL,
  data_quality TEXT,
  source_observations INTEGER NOT NULL DEFAULT 0,
  last_computed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ptmt_buffer_multipliers_month_category_unique UNIQUE (month, category)
);