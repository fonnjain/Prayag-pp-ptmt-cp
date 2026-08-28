-- Canonicalize Excel numeric-code signatures and no-colour placeholders in the
-- existing planning roster. Remove the known bad 186 Cocks Standard category
-- before normalizing so the canonical-code unique key cannot collide.
DELETE FROM item_master
WHERE segment = 'PTMT'
  AND category = 'Cocks Standard'
  AND REGEXP_REPLACE(UPPER(TRIM(item_code)), '\.0$', '') = '186';

-- Keep one deterministic row when a code/color/category is duplicated after
-- canonicalization. Prefer an already-canonical code, then the oldest row.
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY
        segment,
        category,
        REGEXP_REPLACE(UPPER(TRIM(item_code)), '\.0$', ''),
        CASE
          WHEN UPPER(TRIM(colour)) IN ('0', '.', 'NORMAL') THEN ''
          ELSE REGEXP_REPLACE(UPPER(TRIM(colour)), '[.[:space:]]+', ' ', 'g')
        END
      ORDER BY
        CASE
          WHEN UPPER(TRIM(item_code)) = REGEXP_REPLACE(UPPER(TRIM(item_code)), '\.0$', '')
            THEN 0
          ELSE 1
        END,
        id
    ) AS row_number
  FROM item_master
)
DELETE FROM item_master AS duplicate
USING ranked
WHERE duplicate.id = ranked.id
  AND ranked.row_number > 1;

UPDATE item_master
SET
  item_code = REGEXP_REPLACE(UPPER(TRIM(item_code)), '\.0$', ''),
  colour = CASE
    WHEN UPPER(TRIM(colour)) IN ('0', '.', 'NORMAL') THEN ''
    ELSE REGEXP_REPLACE(UPPER(TRIM(colour)), '[.[:space:]]+', ' ', 'g')
  END;