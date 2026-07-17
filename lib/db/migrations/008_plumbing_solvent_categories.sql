-- Add the 3 remaining Solvent categories so Plumbing has 12 planning lines:
-- 4 materials (CPVC, UPVC, SWR, AGRI) × 3 types (Pipe, Fitting, Solvent).
-- SWR Solvent was seeded in migration 007; CPVC/UPVC/AGRI Solvent are new.
--
-- July 2026 verified Production Required (PCS):
--   CPVC Solvent = 16,539 | UPVC Solvent = 542 | AGRI Solvent = 0
-- Grand total across all 12 lines = 1,922,309 pcs.

INSERT INTO buffer_categories (name, segment, multiplier) VALUES
  ('CPVC Solvent', 'Plumbing', 1.5),
  ('UPVC Solvent', 'Plumbing', 1.5),
  ('AGRI Solvent', 'Plumbing', 1.5)
ON CONFLICT (name) DO NOTHING;

INSERT INTO weekly_release_bands (category_name, segment, w1_upper, w2_upper, w3_upper, w4_upper) VALUES
  ('CPVC Solvent', 'Plumbing', 0.3, 0.5, 0.8, 1.5),
  ('UPVC Solvent', 'Plumbing', 0.3, 0.5, 0.8, 1.5),
  ('AGRI Solvent', 'Plumbing', 0.3, 0.5, 0.8, 1.5)
ON CONFLICT (category_name) DO NOTHING;
