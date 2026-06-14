-- Seed source_config with the live Google Sheets file IDs (PTMT + CP).
-- Idempotent: re-runnable via `psql "$DATABASE_URL" -f lib/db/seeds/source_config.sql`.
--
-- Conventions used by the ingestion service:
--   data_type  : substring-matched to a handler (sales/orders/production/pending/rate_list).
--   tab_pattern: '' = read the workbook's first/default tab;
--                '{month}' = resolve the tab for the active plan month (per-month tabs).
--   applies_from / applies_to drive the fiscal-year rule:
--     April plan -> Sale 25-26 (bounded window wins); May/Jun -> Sale 26-27 (open-ended).

INSERT INTO source_config (division, data_type, file_id, tab_pattern, applies_from, applies_to, notes) VALUES
  ('CP',   'sales',      '1rW9fvrdcmTy7Yd6RVV5dVpvZQ5knZMeKoMx8enZ6j24', '',        '2026-05-01', NULL,         'Sale 26-27 — sales FY26-27 (May/Jun 3-month & last-month windows)'),
  ('CP',   'sales',      '1chx0hL67Vpz_uQMxFfQe1JBUVrCmdBFxfFaMvcd_-vE', '',        '2026-04-01', '2026-04-30', 'Sale 25-26 — sales FY25-26 (April plan only)'),
  ('CP',   'orders',     '1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A', '{month}', NULL,         NULL,         'Order Sheet 26-27 — per-month tabs (Apr/May/Jun)'),
  ('CP',   'production', '1xXY0XWG5f3Gz16qg-Y6O6szCnks1MbUT6VUd8Pa9eAk', '{month}', NULL,         NULL,         'CP PRODUCTION 26-27 — daily actual production, tabs Apr-26/MAY-26/JUN-26'),
  ('CP',   'pending',    '1cZQ1pdeAsoVj5aNS__D1aG84Dx5TmXH6lnybGMMGPMA', '{month}', NULL,         NULL,         'CP pending-order source (Sheet8 import)'),
  ('CP',   'rate_list',  '1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4', '',        NULL,         NULL,         'rate list — item master / average rate (reference)'),
  ('PTMT', 'sales',      '1rW9fvrdcmTy7Yd6RVV5dVpvZQ5knZMeKoMx8enZ6j24', '',        '2026-05-01', NULL,         'Sale 26-27 — sales FY26-27 (May/Jun 3-month & last-month windows)'),
  ('PTMT', 'sales',      '1chx0hL67Vpz_uQMxFfQe1JBUVrCmdBFxfFaMvcd_-vE', '',        '2026-04-01', '2026-04-30', 'Sale 25-26 — sales FY25-26 (April plan only)'),
  ('PTMT', 'orders',     '1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A', '{month}', NULL,         NULL,         'Order Sheet 26-27 — per-month tabs (Apr/May/Jun)'),
  ('PTMT', 'production', '1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw', '{month}', NULL,         NULL,         'PTMT ANUJ — daily actual production (PTMT)'),
  ('PTMT', 'rate_list',  '1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4', '',        NULL,         NULL,         'rate list — item master / average rate (reference)')
ON CONFLICT (division, data_type, file_id, tab_pattern)
DO UPDATE SET applies_from = EXCLUDED.applies_from,
              applies_to   = EXCLUDED.applies_to,
              notes        = EXCLUDED.notes;
