-- Seed source_config with the live Google Sheets file IDs (PTMT + CP).
-- Idempotent full refresh: re-runnable via
--   psql "$DATABASE_URL" -f lib/db/seeds/source_config.sql
--
-- Conventions used by the ingestion service:
--   data_type  : substring-matched to a handler (sales/orders/production/pending/rate_list).
--   tab_pattern: '' = read the workbook's first/default tab;
--                '{month}' = resolve the tab for the active plan month (per-month tabs);
--                a literal name (e.g. 'Combined') = read that exact tab.
--   applies_from / applies_to : optional [from, to] plan-month window (null = open).
--
-- Tab choices are driven by how the engine reads each table:
--   * sales      -> 'Combined' full-history tab; the engine date-filters sales over
--                   windows up to 12 months, so BOTH fiscal-year workbooks are loaded
--                   (always-applicable) and the date windows do the selection.
--   * orders     -> 'Combined' open order book; the engine sums all order rows.
--   * production -> plan-month tab (CP: Apr-26/MAY-26/JUN-26); PTMT keeps everything
--                   on its first 'Production' tab, so '' + date filter on prod_date.
--   * pending    -> plan-month tab (CP pending: Apr/May/June).
--   * rate_list  -> first tab (item master / rates, reference metadata).

DELETE FROM source_config;

INSERT INTO source_config (division, data_type, file_id, tab_pattern, applies_from, applies_to, notes) VALUES
  ('CP',   'sales',      '1rW9fvrdcmTy7Yd6RVV5dVpvZQ5knZMeKoMx8enZ6j24', 'Combined', NULL, NULL, 'Sale 26-27 — sales FY26-27 (Combined, full history)'),
  ('CP',   'sales',      '1chx0hL67Vpz_uQMxFfQe1JBUVrCmdBFxfFaMvcd_-vE', 'Combined', NULL, NULL, 'Sale 25-26 — sales FY25-26 (Combined, history tail for 12-month window)'),
  ('CP',   'orders',     '1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A', 'Combined', NULL, NULL, 'Order Sheet 26-27 — Combined open order book'),
  ('CP',   'production', '1xXY0XWG5f3Gz16qg-Y6O6szCnks1MbUT6VUd8Pa9eAk', '{month}',  NULL, NULL, 'CP PRODUCTION 26-27 — daily actual production, tabs APR-26/MAY-26/JUN-26'),
  ('CP',   'pending',    '1cZQ1pdeAsoVj5aNS__D1aG84Dx5TmXH6lnybGMMGPMA', '{month}',  NULL, NULL, 'CP pending orders — per-month tabs (Apr/May/June)'),
  ('CP',   'rate_list',  '1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4', '',         NULL, NULL, 'rate list — item master / rates (reference)'),
  ('PTMT', 'sales',      '1rW9fvrdcmTy7Yd6RVV5dVpvZQ5knZMeKoMx8enZ6j24', 'Combined', NULL, NULL, 'Sale 26-27 — sales FY26-27 (Combined, full history)'),
  ('PTMT', 'sales',      '1chx0hL67Vpz_uQMxFfQe1JBUVrCmdBFxfFaMvcd_-vE', 'Combined', NULL, NULL, 'Sale 25-26 — sales FY25-26 (Combined, history tail for 12-month window)'),
  ('PTMT', 'orders',     '1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A', 'Combined', NULL, NULL, 'Order Sheet 26-27 — Combined open order book'),
  ('PTMT', 'production', '1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw', '',         NULL, NULL, 'PTMT ANUJ — daily actual production on first Production tab'),
  ('PTMT', 'rate_list',  '1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4', '',         NULL, NULL, 'rate list — item master / rates (reference)'),
  -- C1.1 interim opening-stock: read from the current month's MASTER workbook
  -- (fixed columns; update file_id each month). CP=Sheet3 Q/S (NOT Sheet8);
  -- PTMT=TOP ITEM B/C/K.
  ('CP',   'stock',      '1AkCWb20qLSjPdQ51nTOi2jZ5vM9FXjVr2bDBpIdrNTw', 'Sheet3',   NULL, NULL, 'interim: opening stock from current month MASTER (Production Plan CP JUN 2026), Sheet3 col S'),
  ('PTMT', 'stock',      '170xrcWDdTMvTLSJyCw3yGBWxqOOSfZkesGWunqKr8Rw', 'TOP ITEM', NULL, NULL, 'interim: opening stock from current month MASTER (Daily Production PTMT JUN 2026), TOP ITEM col K'),
  -- Corrected logic interim PTMT last-month pending: same MASTER TOP ITEM tab,
  -- col J. CP pending is a real per-month sheet (above), NOT a master source.
  ('PTMT', 'pending',    '170xrcWDdTMvTLSJyCw3yGBWxqOOSfZkesGWunqKr8Rw', 'TOP ITEM', NULL, NULL, 'interim: last-month pending from current month MASTER (Daily Production PTMT JUN 2026), TOP ITEM col J');
