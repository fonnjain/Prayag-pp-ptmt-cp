-- Migration 001: add plant-level AI analysis persistence tables

CREATE TABLE IF NOT EXISTS ai_plant_analyses (
  id            SERIAL PRIMARY KEY,
  month         TEXT NOT NULL,
  snapshot_date TEXT,
  depth         TEXT NOT NULL DEFAULT 'standard',
  model         TEXT NOT NULL,
  packet_hash   TEXT NOT NULL,
  packet_json   JSONB NOT NULL,
  result_json   JSONB,
  created_at    TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_plant_analyses_month_idx
  ON ai_plant_analyses (month);

CREATE INDEX IF NOT EXISTS ai_plant_analyses_packet_hash_idx
  ON ai_plant_analyses (packet_hash);

CREATE TABLE IF NOT EXISTS ai_plant_analysis_messages (
  id          SERIAL PRIMARY KEY,
  analysis_id INTEGER NOT NULL,
  role        TEXT NOT NULL,
  content     TEXT NOT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ai_plant_analysis_messages_analysis_id_idx
  ON ai_plant_analysis_messages (analysis_id);
