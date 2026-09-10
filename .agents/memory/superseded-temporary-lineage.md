---
name: Superseded Temporary lineage
description: Preserve replacement-plan lineage when a finalized Temporary baseline is marked superseded.
---

A deliberate baseline supersession changes the old Temporary run's status for operational selection, but must not make that frozen run unusable as the lineage source for its approved replacement.

**Why:** The supersession action is intentionally performed before the replacement Temporary Plan is created; a finalized-only parent guard would leave the month without a replacement path after the old baseline is safely abandoned.

**How to apply:** Keep PL.1 scoped to finalized Production Plans, and allow a superseded Temporary parent in the explicit replacement path while continuing to reject drafts or unrelated runs.