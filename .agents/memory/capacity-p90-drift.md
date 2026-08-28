---
name: PTMT p90 drift and historical cache
description: Capacity comparison drift uses monthly p90, while historical workbook snapshots should be reused during recomputation.
---

PTMT Jan-to-latest capacity drift is a monthly p90 comparison, not a mean comparison; historical workbook reads should reuse ingestion snapshots during a full recompute to avoid Sheets quota fan-out.

**Why:** Capacity decisions are driven by the tail of observed daily output, and historical workbooks do not change often enough to justify rereading every month on each recompute. Mean drift can hide a material tail change, while parallel historical reads can produce incomplete persisted comparisons when Sheets quotas are exhausted.

**How to apply:** Keep both full-window and recent-window p90 values visible, show the Jan-to-latest p90 drift by category, and treat a large drift as a review signal rather than automatically removing a business override.