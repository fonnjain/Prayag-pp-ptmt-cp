-- Fix SWR buffer multiplier from 1.5 → 1.0.
-- SWR uses a 1× buffer (BufferReq = Avg-3-Month × 1.0), not 1.5× like CPVC/UPVC/AGRI.
-- Verified: SWR item PW11 has Avg3Mo 14,761 and master Buffer 14,761 = ×1.0.
-- Migrations 006/007 incorrectly seeded all Plumbing materials at 1.5.
-- The multiplier column is the "Applied" value read by the plan engine;
-- it remains editable per category via the Suggested/Override/Applied model.
UPDATE buffer_categories
SET multiplier = 1.0
WHERE segment = 'Plumbing'
  AND name IN ('SWR Pipe', 'SWR Fitting', 'SWR Solvent');
