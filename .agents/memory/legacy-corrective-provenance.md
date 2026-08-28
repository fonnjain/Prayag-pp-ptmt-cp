---
name: Legacy corrective provenance
description: Corrective targets created before input-snapshot persistence cannot be compared directly with later Temporary Plans without labeling the source state.
---

Legacy corrective runs may contain a revised target and a plan-run reference but no frozen input snapshots. A later Temporary Plan can therefore be valid while differing materially because it uses a newer roster, pending source, or canonicalisation state.

**Why:** August corrective run #18 and the later Temporary Plan used different environments and source states; the old run preserved totals but not enough provenance to reproduce every input.

**How to apply:** Compare quantity basis first, then environment, roster cardinality, stock, pending-current, pending-last-month, sales window, and capacity. Mark missing legacy provenance as unattributed and do not publish on an unexplained delta.