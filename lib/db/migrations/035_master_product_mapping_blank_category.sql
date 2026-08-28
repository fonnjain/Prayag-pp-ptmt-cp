UPDATE master_product_category_mappings
SET raw_category = ''
WHERE raw_category IS NULL;

ALTER TABLE master_product_category_mappings
  ALTER COLUMN raw_category SET DEFAULT '',
  ALTER COLUMN raw_category SET NOT NULL;