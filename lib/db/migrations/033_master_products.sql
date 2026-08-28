CREATE TABLE IF NOT EXISTS master_products (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'competition-analysis',
  source_product_id TEXT,
  item_code TEXT NOT NULL,
  product_name TEXT,
  division TEXT NOT NULL,
  segment TEXT,
  category TEXT,
  planning_category TEXT,
  uom TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT master_products_source_item_code_unique UNIQUE (source, item_code)
);

CREATE INDEX IF NOT EXISTS master_products_division_idx ON master_products (division);
CREATE INDEX IF NOT EXISTS master_products_segment_idx ON master_products (segment);
CREATE INDEX IF NOT EXISTS master_products_active_idx ON master_products (is_active);

CREATE TABLE IF NOT EXISTS master_product_category_mappings (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'competition-analysis',
  division TEXT NOT NULL,
  raw_category TEXT,
  segment TEXT NOT NULL,
  planning_category TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT master_product_category_mappings_unique
    UNIQUE (source, division, raw_category)
);

CREATE INDEX IF NOT EXISTS master_product_category_mappings_division_idx
  ON master_product_category_mappings (division);