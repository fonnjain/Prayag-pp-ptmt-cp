---
name: Divergent line and pending exposure
description: Safe handling of the preserved workspace snapshot and the August 2026 live-pending deployment finding.
---

The branch `workspace-line-2026-08-25` is a content-preservation snapshot, not a history-preserving merge branch: its tree combines the local line's Order Sheet TYPE/API-key/corrective work with the GitHub line's shared files, while local commit `6a67c7c` remains workspace-only. Compare the full tree and review overlapping `sheets.ts` changes before any reconciliation.

As of 2026-08-25, production reported deployed SHA `c3e7dfd`; there were zero PTMT or Plumbing plan runs created after that deployment, so the live-pending planning change had not produced an exposed plan. Do not roll back or switch the planning source, and do not create a new plan until the pending-order business question is answered.

Corrective runs created after the deployment had `pending_at_plan = 0`, so `deltaNewOrders` equals the current pending total and must not be interpreted as genuine new demand or a PLAN_DRIFT surge. The observed `pending_now` values were PTMT 6,132 and Plumbing 83,887 (about 55% of the 152,625 sheet total), indicating partial Plumbing parser coverage. This is an annotation for interpretation, not a correction to the frozen runs.

**Why:** The deployed SHA settles which line is live, while frozen run records settle exposure. Treating a content snapshot as a mergeable history or reading zero-baseline corrective deltas as new demand can cause an unnecessary rollback or a false demand-surge diagnosis.

**How to apply:** Preserve both lines before reconciliation; use `/api/healthz` plus the remote branch to identify production; query plan runs after the deployment before changing code; leave existing frozen runs intact and annotate only through the authorized corrective-note path.