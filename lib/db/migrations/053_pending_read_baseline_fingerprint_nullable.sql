-- Migration 051 may already be recorded in databases where the historical
-- baseline row existed and masked the incompatible NOT NULL constraint.
-- Keep the audit-only unreproducible row representable everywhere.
ALTER TABLE pending_read_baselines
  ALTER COLUMN fingerprint DROP NOT NULL;