-- Add segment discriminator to all planning tables
-- Default 'PTMT' so every existing row is automatically backfilled

ALTER TABLE item_master
  ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'PTMT';

ALTER TABLE buffer_categories
  ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'PTMT';

ALTER TABLE weekly_release_bands
  ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'PTMT';

ALTER TABLE category_capacity
  ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'PTMT';

ALTER TABLE plan_runs
  ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'PTMT';

-- ── Seed Plumbing buffer categories ───────────────────────────────────────────
-- 8 categories organised by MATERIAL × TYPE.
-- multiplier=1.5 is a sensible starting default; users can override or trigger
-- auto-recompute once Plumbing order history is mapped.

INSERT INTO buffer_categories (name, segment, multiplier) VALUES
  ('CPVC Pipe',    'Plumbing', 1.5),
  ('UPVC Pipe',    'Plumbing', 1.5),
  ('SWR Pipe',     'Plumbing', 1.5),
  ('AGRI Pipe',    'Plumbing', 1.5),
  ('CPVC Fitting', 'Plumbing', 1.5),
  ('UPVC Fitting', 'Plumbing', 1.5),
  ('SWR Fitting',  'Plumbing', 1.5),
  ('AGRI Fitting', 'Plumbing', 1.5)
ON CONFLICT (name) DO NOTHING;

-- ── Seed Plumbing weekly release bands ────────────────────────────────────────
-- Cover bands: W1 < 0.3 months, W2 0.3–0.5, W3 0.5–0.8, W4 0.8–1.5
-- (items with cover ≥ 1.5 are unscheduled — already well-stocked)

INSERT INTO weekly_release_bands (category_name, segment, w1_upper, w2_upper, w3_upper, w4_upper) VALUES
  ('CPVC Pipe',    'Plumbing', 0.3, 0.5, 0.8, 1.5),
  ('UPVC Pipe',    'Plumbing', 0.3, 0.5, 0.8, 1.5),
  ('SWR Pipe',     'Plumbing', 0.3, 0.5, 0.8, 1.5),
  ('AGRI Pipe',    'Plumbing', 0.3, 0.5, 0.8, 1.5),
  ('CPVC Fitting', 'Plumbing', 0.3, 0.5, 0.8, 1.5),
  ('UPVC Fitting', 'Plumbing', 0.3, 0.5, 0.8, 1.5),
  ('SWR Fitting',  'Plumbing', 0.3, 0.5, 0.8, 1.5),
  ('AGRI Fitting', 'Plumbing', 0.3, 0.5, 0.8, 1.5)
ON CONFLICT (category_name) DO NOTHING;
