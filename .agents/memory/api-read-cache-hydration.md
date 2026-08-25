---
name: Read-only API cache hydration
description: Persistence requirement for open-month local projections served by the versioned read-only API.
---

**Rule:** Hydrate and persist each segment's actuals cache independently of the workbook-heavy plan rebuild. A read-only projection may use only the persisted local cache; it must not call Google Sheets on demand.

**Why:** Plan-tab reads can fail transiently because of Sheets quota limits even after the production actuals source was read successfully. If persistence waits for the full monitoring computation, a valid local plan becomes an avoidable 503.

**How to apply:** On startup and before segment monitoring computation, fetch the segment's authoritative actuals, upsert the month/segment cache row, then allow plan-building and dashboard warm-ups to proceed. Keep the operation non-blocking for health/readiness and surface refresh failures explicitly.