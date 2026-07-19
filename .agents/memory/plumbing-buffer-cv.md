---
name: Plumbing buffer CV methodology & golden-value brittleness
description: Buffer multipliers are AI-computed (corrective engine) and drift over time; golden values and tests must account for this.
---

## Rule
Buffer multipliers for CPVC / UPVC / AGRI are computed by the corrective engine and stored in buffer_categories.multiplier. They are NOT fixed at 1.5×. SWR is locked at 1.0× by migration 011 (overrideMultiplier pattern).

**Why:** The AI runs a CV-based calculation; as more sales data arrives, multipliers converge. Category production totals change proportionally, so hardcoded ±1% golden values break whenever the AI reruns.

**How to apply:**
- Golden category totals: capture actuals at a point in time and use ±5% tolerance.
- Buffer check: SWR exact = 1.0, CPVC/UPVC/AGRI use ±0.3 tolerance around current DB value.
- When updating golden values: run `/api/plan/validate?month=…&segment=Plumbing`, copy actuals into PLUMBING_GOLDEN, update PLUMBING_GRAND_TOTAL, update PLUMBING_BUFFER_DEFAULTS expected values.
- Re-capture date is documented inline in plumbing-golden.ts header comment.

## codeCol positional fallback (sheets.ts)
- Header-regex detection rarely finds codeCol for this workbook (no "item code" header).
- Fallback: codeCol = typeCol+1 for CPVC/UPVC/SWR; typeCol+2 for AGRI (extra item-name column between type and code in AGRI tab).
- Do NOT use value-scanning heuristics (length checks, letter tests): early rows are blank section-header rows and item "codes" can be long descriptions.
