---
name: Same-day plan revisions
description: Canonical selection and audit rules for multiple plan sources sharing an effective date.
---

When legacy plan sources share an effective date, select the source with the latest original issuance timestamp, not the order in which version snapshots were created. Preserve every non-canonical source in timeline audit metadata. If two sources share an exact issuance timestamp, use the source ID as the named deterministic tie-breaker.

**Why:** Version-table hydration can happen later and in a different order from the historical revisions. Choosing the last hydrated row silently assigns production to an arbitrary revision.

**How to apply:** Use plan-run/corrective creation timestamps and upload timestamps as source issuance times. Surface the selection reason and superseded sources in monitoring audit data and weekly provenance labels. For legacy zeroed W1–W4 result columns, replace the timeline's zeroed target allocation from the run's frozen inputs plus retained weekly release bands before weekly reporting consumes it.