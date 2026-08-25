---
name: Pending reconciliation drift
description: How to interpret historical pending-to-plan movement and clamp-loss targets when live source data changes.
---

The pending-to-plan reconciliation must hard-fail only on the item-level identity, the listed clamped-item sum, and any unexplained residual. Historical movement and clamp-loss observations are point-in-time diagnostics and should surface as warnings when the live source inputs have changed.

**Why:** The same valid planning formula can produce a different movement/clamp split after live stock, demand, or pending balances drift. Treating an old snapshot as a permanent failure would turn normal source drift into a false parser or formula regression.

**How to apply:** Keep the historical target values and current observed values visible in validation output, but do not let a mismatch alone make the endpoint or CLI regression result fail. Preserve a frozen input snapshot if exact historical reproduction becomes necessary.