---
name: Manual plan parity boundary
description: August reference comparisons can expose differences outside current pending even when the pending source is aligned.
---

The August Prayag reference and the live app can disagree on stock, pending-last-month, and per-item buffer values; matching current pending alone does not prove item parity.

**Why:** the manual exports and live uploads are independently maintained and can represent different snapshots. Treat every comparison mismatch as evidence, not as permission to change the formula or silently update goldens.

**How to apply:** keep plan-source changes scoped, preserve live diagnostics, and review item/category comparison tables before changing multipliers, stock joins, or reference goldens.