-- Baseline provenance for live pending reconciliation.
-- The historical 7,944-piece observation is retained as unreproducible
-- documentation only; it has no capture_id and cannot be used as an active
-- expectation.
ALTER TABLE pending_read_snapshots
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'development';

CREATE TABLE IF NOT EXISTS pending_read_baselines (
  id                              SERIAL PRIMARY KEY,
  baseline_key                   TEXT NOT NULL UNIQUE,
  segment                        TEXT NOT NULL,
  source_role                    TEXT NOT NULL,
  status                         TEXT NOT NULL,
  capture_id                     INTEGER REFERENCES pending_read_snapshots(id),
  environment                    TEXT NOT NULL,
  source_kind                    TEXT NOT NULL,
  source_name                    TEXT NOT NULL,
  source_spreadsheet_id          TEXT,
  source_tab_name                TEXT,
  observed_at                    TIMESTAMP WITH TIME ZONE,
  source_quantity                REAL NOT NULL,
  joined_quantity                REAL NOT NULL,
  explained_exclusion_quantity   REAL NOT NULL,
  unexplained_residual           REAL NOT NULL,
  unmatched_quantity             REAL NOT NULL,
  resolution_loss_quantity       REAL NOT NULL,
  fingerprint                    TEXT,
  rationale                      TEXT NOT NULL,
  created_at                     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- The historical observation below is deliberately unreproducible: it has no
-- persisted capture and therefore no valid exclusion fingerprint. Production
-- may already have this table with fingerprint marked NOT NULL, so normalize
-- that older shape before the guarded insert can run.
ALTER TABLE pending_read_baselines
  ALTER COLUMN fingerprint DROP NOT NULL;

CREATE INDEX IF NOT EXISTS pending_read_baselines_segment_status_idx
  ON pending_read_baselines(segment, source_role, status);

INSERT INTO pending_read_baselines (
  baseline_key,
  segment,
  source_role,
  status,
  capture_id,
  environment,
  source_kind,
  source_name,
  source_spreadsheet_id,
  source_tab_name,
  observed_at,
  source_quantity,
  joined_quantity,
  explained_exclusion_quantity,
  unexplained_residual,
  unmatched_quantity,
  resolution_loss_quantity,
  fingerprint,
  rationale
)
SELECT
  'Plumbing:pending_current_live:historical-7944',
  'Plumbing',
  'pending_current_live',
  'unreproducible',
  NULL,
  'unknown',
  'pending_order_live_sheet',
  'Pending order / report',
  '1dmt6uHOdZSIT0wgNkSfuK8W8d0YO8STW51PVOAAFHvY',
  'report',
  NULL,
  7944,
  2495,
  5449,
  0,
  5449,
  0,
  NULL,
  'Historical live observation retained for audit only. The original source rows and the reported exclusion fingerprint were never persisted, the source state no longer exists, and this row must not be used as an active regression baseline.'
WHERE NOT EXISTS (
  SELECT 1
  FROM pending_read_baselines
  WHERE baseline_key = 'Plumbing:pending_current_live:historical-7944'
);