ALTER TABLE uploaded_files
  ADD COLUMN IF NOT EXISTS source_metadata JSONB;