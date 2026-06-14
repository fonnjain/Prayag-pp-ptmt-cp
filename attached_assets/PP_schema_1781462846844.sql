-- ============================================================
-- Prayag Production Planning — PostgreSQL schema (complete)
-- Single source of truth. Duplication prevented by UNIQUE keys + upsert.
-- division is 'PTMT' or 'CP' throughout.
-- ============================================================

CREATE TABLE items (
  id BIGSERIAL PRIMARY KEY,
  item_code TEXT NOT NULL,
  division  TEXT NOT NULL CHECK (division IN ('PTMT','CP')),
  name TEXT,
  model TEXT,                      -- CP only (e.g. 'MARCUS(68)'), NULL for PTMT
  grp TEXT, type TEXT, category TEXT,
  unit TEXT, alt_unit TEXT, material_center TEXT,
  mrp NUMERIC, sale_rate NUMERIC, hsn TEXT, gst TEXT,
  active BOOLEAN DEFAULT TRUE,
  UNIQUE (item_code, division)
);

CREATE TABLE sales (
  id BIGSERIAL PRIMARY KEY,
  invoice_no TEXT, sale_date DATE,
  item_code TEXT NOT NULL, colour TEXT DEFAULT '',
  qty NUMERIC, rate NUMERIC, amount NUMERIC,
  customer TEXT, grp TEXT, station TEXT, state TEXT,
  month TEXT, division TEXT NOT NULL CHECK (division IN ('PTMT','CP')),
  UNIQUE (invoice_no, item_code, colour, division)
);

CREATE TABLE orders (
  id BIGSERIAL PRIMARY KEY,
  doc_no TEXT, order_date DATE, customer TEXT, location TEXT,
  item_code TEXT NOT NULL, item_name TEXT, colour TEXT DEFAULT '',
  unit TEXT, qty NUMERIC, rate NUMERIC, taxable_value NUMERIC,
  month TEXT, division TEXT NOT NULL CHECK (division IN ('PTMT','CP')),
  UNIQUE (doc_no, item_code, colour, division)
);

CREATE TABLE production (
  id BIGSERIAL PRIMARY KEY,
  prod_date DATE NOT NULL, item_code TEXT NOT NULL, colour TEXT DEFAULT '',
  qty NUMERIC, sub_group TEXT, grp TEXT, month TEXT,
  division TEXT NOT NULL CHECK (division IN ('PTMT','CP')),
  UNIQUE (prod_date, item_code, colour, division)
);

CREATE TABLE pending_orders (
  id BIGSERIAL PRIMARY KEY,
  item_code TEXT NOT NULL, colour TEXT DEFAULT '',
  qty NUMERIC, amount NUMERIC,
  period TEXT NOT NULL CHECK (period IN ('current','last_month')),
  plan_month DATE NOT NULL,
  division TEXT NOT NULL CHECK (division IN ('PTMT','CP')),
  UNIQUE (item_code, colour, period, plan_month, division)
);

CREATE TABLE stock_opening (
  id BIGSERIAL PRIMARY KEY,
  item_code TEXT NOT NULL, colour TEXT DEFAULT '',
  qty NUMERIC, center TEXT, as_on DATE NOT NULL,
  division TEXT NOT NULL CHECK (division IN ('PTMT','CP')),
  UNIQUE (item_code, colour, as_on, division)
);

-- CP article split (model -> articles to make)
CREATE TABLE articles (
  id BIGSERIAL PRIMARY KEY,
  article_code TEXT NOT NULL, article_name TEXT,
  division TEXT NOT NULL CHECK (division IN ('PTMT','CP')),
  UNIQUE (article_code, division)
);
CREATE TABLE model_articles (
  id BIGSERIAL PRIMARY KEY,
  division TEXT NOT NULL CHECK (division IN ('PTMT','CP')),
  model TEXT NOT NULL, article_code TEXT NOT NULL,
  price NUMERIC, receive BOOLEAN DEFAULT TRUE,
  UNIQUE (division, model, article_code)
);

-- ---------- settings ----------
-- The multiplier is a VARIABLE. These are only DEFAULT suggestions;
-- the value actually used is whatever the planner entered, stored on plan_runs.
CREATE TABLE buffer_defaults (
  id BIGSERIAL PRIMARY KEY,
  division TEXT NOT NULL, category TEXT, scenario TEXT,  -- 'MIN'/'MAX'/'SINGLE'
  plan_month DATE, multiplier NUMERIC,
  include_current_pending BOOLEAN DEFAULT TRUE, floor0 BOOLEAN DEFAULT TRUE,
  UNIQUE (division, category, scenario, plan_month)
);

CREATE TABLE calendar_settings (
  id BIGSERIAL PRIMARY KEY,
  division TEXT NOT NULL, plan_month DATE NOT NULL,
  working_days INT DEFAULT 26,
  last3_from DATE, last3_to DATE, last_month TEXT, stock_as_on DATE,
  UNIQUE (division, plan_month)
);

-- Google connector config (file IDs + tab patterns), incl. fiscal-year file rule
CREATE TABLE source_config (
  id BIGSERIAL PRIMARY KEY,
  division TEXT NOT NULL, data_type TEXT NOT NULL,
  file_id TEXT NOT NULL, tab_pattern TEXT,
  applies_from DATE, applies_to DATE, notes TEXT,
  UNIQUE (division, data_type, file_id, tab_pattern)
);

-- ---------- engine output (versioned) ----------
CREATE TABLE plan_runs (
  id BIGSERIAL PRIMARY KEY,
  division TEXT NOT NULL, plan_month DATE NOT NULL, version INT NOT NULL,
  working_days INT,
  multiplier_min NUMERIC, multiplier_max NUMERIC,    -- the variable(s) used
  multiplier_mode TEXT,                              -- 'single'|'min_max'|'per_category'
  params JSONB,                                      -- per-category overrides etc.
  report_model TEXT, report_tier TEXT,               -- narrative provenance
  created_by TEXT, created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (division, plan_month, version)
);

CREATE TABLE plan_lines (
  id BIGSERIAL PRIMARY KEY,
  plan_run_id BIGINT NOT NULL REFERENCES plan_runs(id) ON DELETE CASCADE,
  item_code TEXT, colour TEXT DEFAULT '', model TEXT, category TEXT, report TEXT,
  last3_sale NUMERIC, run_rate NUMERIC, last_month_sale NUMERIC,
  avg_sale_annual NUMERIC, sale_2m NUMERIC, sale_10m NUMERIC,
  pending_current NUMERIC, pending_last NUMERIC, opening_stock NUMERIC,
  multiplier NUMERIC, buffer_target NUMERIC,
  min_required NUMERIC, max_required NUMERIC,
  order_as_on NUMERIC, production_as_on NUMERIC, production_left NUMERIC,
  coverage_pct NUMERIC, urgent_flag BOOLEAN, value_amount NUMERIC
);

-- ---------- ingestion / dedup / sanity / audit ----------
CREATE TABLE import_batches (
  id BIGSERIAL PRIMARY KEY,
  division TEXT, data_type TEXT, plan_month DATE,
  source_file_id TEXT, content_hash TEXT,            -- skip identical re-pulls
  rows_added INT, rows_updated INT, rows_skipped INT, rows_rejected INT,
  sanity_verdict TEXT,                               -- ok|warn|block
  sanity_summary TEXT,
  sanity_model TEXT, sanity_tier TEXT,               -- model ACTUALLY used (footer fallback)
  sanity_downgraded BOOLEAN DEFAULT FALSE,           -- deep->fast fallback happened
  pulled_by TEXT, pulled_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (division, data_type, plan_month, content_hash)
);

CREATE TABLE validation_findings (
  id BIGSERIAL PRIMARY KEY,
  import_batch_id BIGINT REFERENCES import_batches(id) ON DELETE CASCADE,
  severity TEXT CHECK (severity IN ('info','warning','blocker')),
  type TEXT, message TEXT, detail JSONB,
  source TEXT,                                       -- 'deterministic'|'claude_sanity'
  model TEXT, tier TEXT, downgraded BOOLEAN DEFAULT FALSE,  -- AI provenance
  created_at TIMESTAMPTZ DEFAULT now()
);

-- one-time legacy import guard
CREATE TABLE import_ledger (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL, scope TEXT NOT NULL,         -- e.g. ('sales','2024-04..2026-03')
  done_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (source, scope)
);

-- generated reports (PDF) provenance
CREATE TABLE reports (
  id BIGSERIAL PRIMARY KEY,
  plan_run_id BIGINT REFERENCES plan_runs(id) ON DELETE CASCADE,
  period_type TEXT, model TEXT, tier TEXT, downgraded BOOLEAN DEFAULT FALSE,
  pdf_path TEXT, created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email TEXT UNIQUE, name TEXT,
  role TEXT CHECK (role IN ('admin','planner','viewer'))
);

-- helpful indexes
CREATE INDEX ix_sales_lookup  ON sales(division, item_code, colour, sale_date);
CREATE INDEX ix_orders_lookup ON orders(division, item_code, colour, month);
CREATE INDEX ix_prod_lookup   ON production(division, item_code, colour, prod_date);
CREATE INDEX ix_planlines_run ON plan_lines(plan_run_id);
CREATE INDEX ix_findings_batch ON validation_findings(import_batch_id);
