---
name: Planning versus machine source registries
description: PTMT planning and machine monitoring use different workbook families, and historical ingestion caches must be cleared when a planning source is registered.
---

PTMT planning capacity must read a workbook with a `Production` or `P-DATA` tab. The machine app's Date Sheet & Monthly Report workbook is valid evidence for machine run-hours and kg output, but is not a substitute for planning piece-level actuals.

**Why:** A missing planning month can be mistaken for zero production when all categories are absent together; registering the machine workbook produces a named no-tab failure rather than usable planning rows. Historical ingestion intentionally reuses cached snapshots, so a newly registered source otherwise remains invisible to recompute.

**How to apply:** Verify the machine registry independently through monitoring quality, find the corresponding planning workbook in Drive, register it in the PTMT planning source registry, and delete that month/segment's ingestion cache before recomputing. Missing or invalid PTMT sources must propagate as a named `CAPACITY_SOURCE_UNAVAILABLE` error, never as an empty month.