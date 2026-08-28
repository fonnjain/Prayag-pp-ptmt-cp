ALTER TABLE item_master
  ADD COLUMN IF NOT EXISTS classification_status TEXT NOT NULL DEFAULT 'classified',
  ADD COLUMN IF NOT EXISTS classification_source TEXT,
  ADD COLUMN IF NOT EXISTS classification_note TEXT;

UPDATE item_master
SET
  classification_status = CASE
    WHEN NULLIF(TRIM(category), '') IS NULL THEN 'unclassified'
    ELSE 'classified'
  END,
  classification_source = CASE
    WHEN NULLIF(TRIM(category), '') IS NULL THEN NULL
    ELSE COALESCE(classification_source, 'seed')
  END,
  classification_note = CASE
    WHEN NULLIF(TRIM(category), '') IS NULL THEN 'No reviewed category is available.'
    ELSE classification_note
  END;

ALTER TABLE item_master
  ALTER COLUMN category SET DEFAULT 'Unclassified';

ALTER TABLE buffer_categories
  DROP CONSTRAINT IF EXISTS buffer_categories_name_unique;

CREATE UNIQUE INDEX IF NOT EXISTS buffer_categories_segment_name_unique
  ON buffer_categories (segment, name);

INSERT INTO buffer_categories (segment, name, multiplier)
VALUES
  ('PTMT', 'Unclassified', 1),
  ('Plumbing', 'Unclassified', 1),
  ('CP', 'Unclassified', 1)
ON CONFLICT (segment, name) DO NOTHING;

CREATE TABLE IF NOT EXISTS product_classification_audit (
  id SERIAL PRIMARY KEY,
  segment TEXT NOT NULL,
  item_code TEXT NOT NULL,
  colour TEXT NOT NULL DEFAULT '',
  previous_category TEXT,
  previous_status TEXT,
  new_category TEXT NOT NULL,
  new_status TEXT NOT NULL,
  reason TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS product_classification_audit_product_idx
  ON product_classification_audit (segment, item_code, colour);

CREATE INDEX IF NOT EXISTS product_classification_audit_changed_at_idx
  ON product_classification_audit (changed_at);