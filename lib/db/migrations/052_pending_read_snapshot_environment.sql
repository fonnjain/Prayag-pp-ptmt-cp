-- Backfill environment provenance for databases where migration 051 was
-- applied before the snapshot column was added to the schema.
ALTER TABLE pending_read_snapshots
  ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'development';