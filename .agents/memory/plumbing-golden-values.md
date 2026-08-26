---
name: Plumbing golden values
description: How Plumbing plan golden values are structured, what legitimate drift looks like, and how to diagnose vs update.
---

## Current snapshot
- Reference month: **2026-07**, snapshot taken **2026-08-25**
- Grand total: **2,026,860** pieces · KG grand total: **458,986** kg
- 12 categories; ONE formula for all: `max(buffer − stock + lmPending + pending, 0)`
- CPVC 40/244/9 items · UPVC 52/242/30 · SWR 160/134/3 · AGRI 123/82/1
- FG Stock file: 1,042 rows (June file, uploaded 2026-07-17)
- SWR multiplier = 1.0× (NOT 1.5×)

## Tolerance tiers in plumbing-golden.ts
- Category plan totals: `PLUMBING_GOLDEN_TOLERANCE = 0.001` (±0.1%)
- KG per category: `PLUMBING_KG_TOLERANCE = 0.01` (±1%)
- Weekly per-category and plant: `PLUMBING_WEEKLY_TOLERANCE = 0.01` (±1%)
- Grand total check: uses PLUMBING_GOLDEN_TOLERANCE (±0.1%)

## Diagnosing golden drift — two cases

**Case 1 (legitimate):** avg3MoSale rolling window advanced, FG Stock file unchanged.
- Signs: item counts all intact, FG Stock row count unchanged, movement non-uniform (some cats flat or up), W1+W2+W3+W4=planTotal sum invariants still pass
- Action: update PLUMBING_GOLDEN + PLUMBING_GRAND_TOTAL + KG + weekly to current actuals

**Case 2 (regression):** pipeline reading fewer rows than before.
- Signs: ANY item count dropped below reference, or FG Stock row count shrank, or ALL categories uniformly down by the same proportion
- Action: DO NOT update goldens — fix the data path so missing items are read again

**Why:** updating goldens to match a data-loss bug silently launders the regression into the new baseline. Item counts are the smoking-gun check (exact, not ±%).

Pending-driven golden boundary: the plan, KG, and weekly expectations are not source-drift warnings when their old values were captured before live pending balances entered the formula. Re-derive those expectations from a complete current run and record the pending-balance reason with the observation; do not widen their tolerances to preserve the old baseline.

## How to take a new snapshot
1. Confirm item counts match reference (CPVC 40/244/9 · UPVC 52/242/30 · SWR 160/134/3 · AGRI 123/82/1)
2. Confirm FG Stock row count = 1,042 (or re-verify after a new upload)
3. Run `curl .../api/plan/validate?segment=Plumbing&month=2026-07` and extract actuals
4. Update all arrays/constants in `artifacts/api-server/src/lib/plumbing-golden.ts` in one pass
5. Re-run the suite — plan, KG, weekly, item-count, and source-completeness checks should pass; unrelated live-baseline drift must remain explicitly visible.
