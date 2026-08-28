---
name: Pending alias parity
description: Pending code and colour aliases must govern every consumer of the pending source.
---

Pending identity normalization is part of the source contract, not only a diagnostic convenience. Any alias or placeholder-colour rule used to classify a pending row must be applied before aggregation, plan lookup, provenance capture, and reconciliation.

**Why:** A diagnostic-only alias can produce a zero-residual “joined” report while the production formula still looks up the raw key and silently drops the quantity.

**How to apply:** Reuse the canonical pending identity for current and last-month sources in both segments, and assert that the resulting plan-field quantity equals the diagnostic joined quantity before returning a plan.