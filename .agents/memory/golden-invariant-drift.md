---
name: Golden invariant drift
description: Planning golden constants contain component-to-total and row-level identity mismatches that must be separated from live input drift.
---

Before attributing a regression to live inputs, validate that every golden aggregate equals its components and that row-level identities hold.

**Why:** The PTMT August max golden differs by 8 pieces between category and grand totals, while Plumbing pieces, KG, weekly, and corrective replan sets also contain mismatches; a non-self-consistent baseline cannot be reproduced from inputs.

**How to apply:** Run component-sum and identity checks for every golden family before changing formulas or targets. Report arithmetic defects separately from stale-input and roster residuals; quarantine only comparisons in invalid families, while retaining independent live-data and dynamic-invariant checks.