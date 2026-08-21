-- Monthly operational state is segment-specific. Existing rows are PTMT by
-- default; the composite keys allow Plumbing rows without collisions.
ALTER TABLE plant_configs
  ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'PTMT';
ALTER TABLE plant_configs DROP CONSTRAINT IF EXISTS plant_configs_pkey;
ALTER TABLE plant_configs ADD CONSTRAINT plant_configs_pkey PRIMARY KEY (month, segment);

ALTER TABLE plant_ingestion_cache
  ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'PTMT';
ALTER TABLE plant_ingestion_cache DROP CONSTRAINT IF EXISTS plant_ingestion_cache_pkey;
ALTER TABLE plant_ingestion_cache ADD CONSTRAINT plant_ingestion_cache_pkey PRIMARY KEY (month, segment);

ALTER TABLE plant_source_configs
  ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'PTMT';
ALTER TABLE plant_source_configs DROP CONSTRAINT IF EXISTS plant_source_configs_pkey;
ALTER TABLE plant_source_configs ADD CONSTRAINT plant_source_configs_pkey PRIMARY KEY (month, segment);

ALTER TABLE monitoring_config
  ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'PTMT';
ALTER TABLE monitoring_config DROP CONSTRAINT IF EXISTS monitoring_config_pkey;
ALTER TABLE monitoring_config ADD CONSTRAINT monitoring_config_pkey PRIMARY KEY (month, segment);