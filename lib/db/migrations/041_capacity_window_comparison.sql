ALTER TABLE category_capacity
  ADD COLUMN IF NOT EXISTS window_start_date TEXT,
  ADD COLUMN IF NOT EXISTS window_end_date TEXT,
  ADD COLUMN IF NOT EXISTS comparison_json JSONB;