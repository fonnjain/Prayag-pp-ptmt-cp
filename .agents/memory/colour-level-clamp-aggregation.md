---
name: Colour-level clamp aggregation
description: Why code-level Prayag totals can differ from app totals even when all inputs match.
---

The app computes `max(buffer - stock + pendingLastMonth + pendingCurrent, 0)` per code-and-colour row, then sums those clamped rows. Prayag supplies one code-level row and effectively clamps after the code-level totals are combined. Negative colour residuals therefore cannot offset positive colour plans in the app total.

**Why:** The September fresh comparison showed positive differences such as code 123: the app total exceeded Prayag by 4,105.01 solely because BLUE and WHITE were negative before clamping. The remaining 0.02 was rounding.

**How to apply:** Compare Prayag and app at code grain by aggregating app rows after per-colour clamping. Keep the colour-level rows for execution and audit, but classify these positive differences as expected clamp effects rather than formula mismatches.