-- Add SWR Solvent as a 9th Plumbing planning category.
-- SWR Solvent (solvent cement) is a manufactured product that appears on the
-- daily production master Col S alongside SWR Pipe and SWR Fitting.
-- July 2026 verified Production Required = 1,255 pcs.

INSERT INTO buffer_categories (name, segment, multiplier)
VALUES ('SWR Solvent', 'Plumbing', 1.5)
ON CONFLICT (name) DO NOTHING;

INSERT INTO weekly_release_bands (category_name, segment, w1_upper, w2_upper, w3_upper, w4_upper)
VALUES ('SWR Solvent', 'Plumbing', 0.3, 0.5, 0.8, 1.5)
ON CONFLICT (category_name) DO NOTHING;
