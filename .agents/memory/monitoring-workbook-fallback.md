---
name: Monitoring workbook fallback
description: Monitoring-only workbook reads may use the latest prior source with visible provenance, while planning and corrective reads stay exact-month strict.
---

Monitoring workbook resolution must try the requested month first, then walk backward through prior months only for monitoring reads. The returned source month and warning must travel through API payloads and visible monitoring UI, and fallback calculations must use the source month for date grouping and plan context. Planning uploads and corrective replan readers remain strict and must never inherit this fallback.

**Why:** Operational monitoring remains useful while a new month's workbook is late, but using stale actuals silently in planning or corrective decisions would change production commitments.

**How to apply:** Add fallback only behind monitoring-specific readers; preserve the strict resolver for plan creation, validation, corrective replans, and fresh snapshot capture. Keep monitoring pages from short-circuiting on plan-run month availability before they can show the source warning.