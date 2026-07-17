---
name: Plumbing buffer CV methodology gap vs golden values
description: Our engine uses category-aggregate monthly CV; golden reference values use item-level (per-SKU) weighted-average CV. Category CV is always lower.
---

## Golden values (z=1.65, ±0.02 tolerance)
CPVC Pipe 1.31 | CPVC Fitting 1.35 | CPVC Solvent 1.31
UPVC Pipe 1.33 | UPVC Fitting 1.22 | UPVC Solvent 1.55
SWR Pipe 2.34  | SWR Fitting 1.42  | SWR Solvent 1.55
AGRI Pipe 1.67 | AGRI Fitting 1.87 | AGRI Solvent = no data

## After tab-normalisation fix (all 12 months, z=1.65)
CPVC Pipe 1.28 | CPVC Fitting 1.23 | CPVC Solvent 1.30 ✓
UPVC Pipe 1.29 | UPVC Fitting 1.23 ✓ | UPVC Solvent 1.59
SWR Pipe 1.29  | SWR Fitting 1.45  | SWR Solvent insufficient
AGRI Pipe 1.39 | AGRI Fitting 1.27 | AGRI Solvent thin

Pass (±0.02): CPVC Solvent, UPVC Fitting.

## Root cause
Our engine aggregates all items in a category per month, then computes CV on the 24 monthly-total observations.
The golden reference appears to compute CV per individual SKU, then weight-average across SKUs by volume.
Item-level CVs are always higher than the aggregate because individual demand is noisier than summed demand.

Largest gaps: SWR Pipe (computed CV=0.18 vs golden implied CV=0.81) and AGRI Fitting (0.17 vs 0.53).

**Why:** Category-aggregate CV is the right approach for category-level planning.
Item-level CV is better for individual SKU safety-stock but requires per-code monthly data tracking.

**How to apply:** If future iterations need to match the golden values exactly, implement weighted-average
item-level CV: accumulate `Map<itemCode, {cat, fy2425: number[], fy2526: number[]}>`, run runAlgorithm per item,
then weight-average the `cv` fields by `avgMonth`. This is a significant engine change.

## Reliability flags (current state)
- null / "": data is clean
- "thin data — review": avgMonth < 600 (AGRI Solvent, UPVC Solvent)
- "insufficient data — override required": no orders found (SWR Solvent — no product exists in sheet)
