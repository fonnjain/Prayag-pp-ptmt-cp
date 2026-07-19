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

Last refresh: 19-Jul-2026 (workingDaysRemaining=15 fixed).
