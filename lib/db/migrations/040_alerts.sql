CREATE TABLE IF NOT EXISTS alert_thresholds (
  code TEXT NOT NULL,
  segment TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  value REAL NOT NULL,
  default_value REAL NOT NULL,
  unit TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'segment',
  observed_min REAL,
  observed_max REAL,
  would_fire_count INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (code, segment)
);

CREATE TABLE IF NOT EXISTS alert_records (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL,
  segment TEXT NOT NULL,
  month TEXT NOT NULL,
  severity TEXT NOT NULL,
  state TEXT NOT NULL,
  title TEXT NOT NULL,
  action TEXT NOT NULL,
  message TEXT NOT NULL,
  value REAL,
  threshold REAL,
  difference REAL,
  quantity REAL NOT NULL DEFAULT 0,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_evaluated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by TEXT,
  muted_until TIMESTAMPTZ,
  mute_reason TEXT,
  suppressed_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (code, segment, month)
);
CREATE INDEX IF NOT EXISTS alert_records_segment_month_idx ON alert_records (segment, month);

CREATE TABLE IF NOT EXISTS alert_events (
  id SERIAL PRIMARY KEY,
  alert_id INTEGER NOT NULL REFERENCES alert_records(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  segment TEXT NOT NULL,
  month TEXT NOT NULL,
  state TEXT NOT NULL,
  value REAL,
  threshold REAL,
  difference REAL,
  quantity REAL NOT NULL DEFAULT 0,
  message TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor TEXT,
  action TEXT NOT NULL DEFAULT 'evaluated'
);
CREATE INDEX IF NOT EXISTS alert_events_segment_month_idx ON alert_events (segment, month);
CREATE INDEX IF NOT EXISTS alert_events_occurred_at_idx ON alert_events (occurred_at);