---
name: Plan-run input alignment
description: Immutable plan-run inputs omit category, so duplicate item-code/colour keys require ordinal alignment with result rows.
---

When analyzing or reconstructing a plan run, pair `plan_run_inputs` to `plan_run_results` by their insertion ordinal within the run before grouping by category. Do not join only on item code and colour. When converting a frozen Temporary Plan into a Production Plan, preserve that ordinal pairing and keep Temporary Plans out of the governing monitoring timeline.

**Why:** The input schema has no category column, and some PTMT item code/colour pairs legitimately occur in multiple categories. A key-only join multiplies rows and produces false category totals.

**How to apply:** Use `ROW_NUMBER() OVER (PARTITION BY run_id ORDER BY id)` on both tables, join on `run_id` plus ordinal, and keep development and production runs in separate comparisons. Treat Temporary Plans as demand evidence only; create a governing version snapshot when the Production Plan is finalized.