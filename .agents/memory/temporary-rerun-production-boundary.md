---
name: Temporary rerun production boundary
description: Finalized Production Plans close Temporary reruns for the same month and segment.
---

Once a finalized Production Plan exists for a month and segment, a finalized Temporary Plan must not be rerun. The boundary is enforced when creating the rerun, not only when a later corrective recompute starts; the response names the Production Plan and fitting date, while months without a finalized Production Plan remain rerunnable.

**Why:** A Temporary rerun after Production creates a competing baseline and can make operational screens disagree about which plan governs the month.

**How to apply:** Keep the check server-side with no admin bypass or query-parameter override, and mirror it in the Runs UI with an explanatory disabled state.