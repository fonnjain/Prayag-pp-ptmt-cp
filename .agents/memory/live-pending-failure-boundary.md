---
name: Live pending failure boundary
description: Corrective replans must distinguish unavailable live pending reads from valid zero-pending results.
---

The corrective engine must reject when the authoritative live pending source cannot be fetched; it must never substitute empty totals that produce a plausible `0 - pendingAtPlan` delta. A successful read with zero recognized rows or zero quantities remains valid and carries diagnostics.

**Why:** Pending is an input to corrective demand changes, so a transport or source failure can otherwise silently understate new orders while looking like a normal result.

**How to apply:** Keep the source contract and accepted fields unchanged; use a structured source-specific error with diagnostics at every corrective route boundary, while allowing successful empty/zero reads through.