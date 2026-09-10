CREATE TABLE IF NOT EXISTS plumbing_bom_overrides (
  id SERIAL PRIMARY KEY,
  item_code TEXT NOT NULL,
  weight_kg_per_piece NUMERIC(12, 6) NOT NULL,
  category TEXT NOT NULL,
  pieces_recovered NUMERIC(14, 2) NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  source_last_modified TEXT NOT NULL,
  seeded_on TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT plumbing_bom_overrides_item_code_unique UNIQUE (item_code)
);