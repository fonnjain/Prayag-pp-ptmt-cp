---
name: Shared production-code normalization
description: Production-to-plan joins must use one punctuation-insensitive code normalizer across Sheet3, capacity, and related actuals paths.
---

## Rule
Use one shared production-code normalization function for every join between
daily production actuals and plan/reference item codes. Normalize for matching
only; preserve raw spellings for plan identity, audit, and source evidence.

**Why:** AGRI Fitting production appeared as zero when the Sheet3 reader
normalized `A465`/`A-465` but the capacity join used raw exact codes. Duplicating
the rule lets the two paths drift again.

**How to apply:** Reuse the shared helper in new actuals, capacity, corrective,
monitoring, and plan-to-actual joins. Add a regression test for punctuation,
spacing, and case variants whenever the matching rule changes.