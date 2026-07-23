---
name: Replan invariant rounding
description: How to keep producedCapped + remaining = plan exact in computeCorrectiveReplan, and when to refresh point-in-time goldens.
---

## The rule

In `computeCorrectiveReplan` (routes/plan.ts):

1. **Round planTotal at retrieval** — `item.maxProduction` values are floats; their per-category sum is also float.  
   Use `Math.round(planByCategory.get(category) ?? 0)` before anything else.

2. **Derive `remaining` from planTotal**, never compute it independently:  
   ```ts
   const producedCapped = Math.round(rawProducedCapped);
   const remaining = planTotal - producedCapped;   // invariant holds exactly
   ```  
   If you `Math.round()` both `producedCapped` and `remaining` separately they can differ from `planTotal` by ±1 due to independent rounding, breaking the exact-equality structural invariant check.

**Why:** The validate-replan endpoint checks `c.producedCapped + c.remaining === c.plan` (exact). Float `c.plan` vs integer sum causes a false fail even when the logic is correct (observed: SWR Fitting 236,319.8 vs 236,320; AGRI Fitting 54,587 vs 54,588).

## Point-in-time golden refresh

`PLUMBING_REPLAN_GOLDEN` and its total constants in `plumbing-golden.ts` are snapshots of Sheet3 (the live production log). They will drift whenever:
- More working days are recorded (produced goes up, remaining goes down)
- The workbook plan formula is re-run (stock/pending/buffer changes → c.plan changes slightly)

**When to refresh:** whenever the produced totals drift >1% from the goldens. The checks use ±1% tolerance for produced/remaining/shortfall and ±5% for capPerDay/feasible. Mid-month (after ~5+ new days) the golden refresh is required.

**How:** call `GET /api/plan/validate-replan?month=YYYY-MM&workingDaysRemaining=N`, read the JSON, paste new values into the golden table. Then re-run the regression to confirm all 272 checks pass.

Last refresh: 23-Jul-2026 (workingDaysRemaining=15 fixed; W1+W2 only in Sheet3).

## Two sources of drift in replan goldens

`produced` and `remaining` have TWO independent drift causes:

1. **Sheet3 filling in** — as W3/W4 days are recorded, `produced` grows and `remaining` shrinks.  
   Pattern: `produced_new = sum(W1_mon + W2_mon + W3_mon + ...)` from monitoring golden values.

2. **Live pending delta** — `planRev = maxProduction + max(deltaNewOrders_live, 0)`. Orders fulfilled between the snapshot date and today lower `deltaNewOrders`, so `planRev` (and hence `remaining`) changes.  
   To diagnose: compute `planRev = got_produced + got_remaining` per category and compare to `maxProduction` from the plan total. The excess is the live deltaNewOrders.

3. **DB-seeded cap/day** — `capPerDay` comes from `capacity_categories` table (seeded on API boot). If the DB is reset (new session), the seed may produce different values than the previous snapshot. AGRI Fitting changed from 5,950 → 2,600 between sessions.

**Quickest fix:** read "got" values directly from the regression failure output and paste them into the golden table. All three sources of drift show up together in a single regression run.
