---
name: Temporary plan export
description: Frozen Temporary and Production Plan exports must use persisted run rows and preserve the two-stage planning boundary.
---

Temporary Plans are demand-true snapshots; their export must read the frozen run inputs/results and must not rebuild the plan from current uploads or live Sheets data. Production exports may include the cited Temporary Plan as lineage context, while the production summary remains the persisted machine-feasible run.

**Why:** Rebuilding during export would make an audited snapshot change when live inputs drift, defeating the purpose of frozen runs and making Temporary-to-Production reconciliation impossible.

**How to apply:** Add export routes against `plan_run_inputs`/`plan_run_results`; keep external machine scheduling as a separate period-based payload rather than implementing a local Pass 2 fitter.