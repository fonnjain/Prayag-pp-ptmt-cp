---
name: External scheduler promotion boundary
description: Design rule for keeping Prayag scheduler responses separate from frozen plan quantities and preserving explicit quantity bases.
---

External machine-scheduler responses must not silently mutate a frozen plan. Demand/owed quantity, executable scheduled quantity, unfinished capacity residual, and data-limited quantity need separate explicit bases; a later scheduler response belongs to its own lifecycle and export surface.

**Why:** A scheduler can return a different executable result after a plan is finalized, and gross/net reconciliation plus data-limited rows do not share the same conservation basis. Overwriting the frozen row makes historical capacity figures ambiguous.

**How to apply:** Treat Prayag as the authoritative executable machine-plan source when available, retain the local cascade only as a labelled estimate, and never use that estimate as a silent fallback for missing, failed, partial, stale, or not-yet-generated external results.