---
name: Audit multiplier projection
description: Scope and persistence boundary of the plan builder's audit-only multiplier override map.
---

The PTMT plan builder accepts an optional in-memory category multiplier projection that can take precedence over the normal database/workbook chain, but it is not a table, column, file, or normal persisted plan input.

**Why:** The projection exists to support controlled comparisons without changing real planning data; treating it as durable state would make audit conclusions about old runs unsound.

**How to apply:** Before attributing a plan to the projection, identify the caller and the map contents for that request. Absence of persisted projection state means an old run cannot be proven to have used one beyond its stored factors/results.