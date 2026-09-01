---
name: Historical reporting fallback
description: How historical plan reporting should behave when live inputs or legacy scheduler evidence are unavailable.
---

Finalized plan runs are the source of truth for historical Summary and plan-item reads; do not rebuild a closed month from current uploads, MRP holds, or live workbooks. If a legacy Plumbing finalized run has no persisted pipe/fitting scheduler results, reporting can use its raw frozen plan rows, while production exports retain the stricter scheduler reconciliation requirement.

**Why:** Historical figures must remain viewable and reproducible after live sources advance or disappear, without weakening the integrity contract for exported production schedules.

**How to apply:** Prefer persisted finalized runs for closed-month reporting. Add compatibility fallbacks only to read/display paths, not to export or publish validation paths.