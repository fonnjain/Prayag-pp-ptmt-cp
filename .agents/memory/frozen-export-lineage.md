---
name: Frozen export lineage
description: Rules for finalized production, temporary, and machine-scheduled exports
---

Finalized exports must read persisted plan-run results, never rebuild from live inputs. A finalized Production run may be the only retained source for a legacy Temporary export when it contains the frozen demand fields; use those fields explicitly rather than treating fitted production quantities as demand.

**Why:** Older Plumbing runs can be finalized without a separate temporary-run lineage, while the production result still retains the demand snapshot needed for reproducible export.

**How to apply:** Prefer a finalized Temporary run; otherwise use a finalized Production run only for its persisted temporary fields. For machine-scheduled Plumbing exports, derive weekly pieces from non-idle block-hour shares with largest-remainder rounding so Σ W1..W4 remains exactly equal to scheduled Production Plan.