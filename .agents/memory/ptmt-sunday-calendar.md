---
name: PTMT Sunday-aware fitting
description: Shared operating-day semantics between monitoring and PTMT Pass 2.
---

## Rule
PTMT Pass 2 must receive the observed positive-production Sunday dates from the stored PTMT actuals snapshot and use the shared working-days calendar. Persist and display `workingDays` and `workedSundayDates` with every fitted plan so monitoring and Pass 2 can be reconciled; future Sundays are not assumed until actual production is ingested.

**Why:** August 2026 had four worked Sundays and 30 operating days. Excluding those Sundays understates capacity; assuming them before ingestion overstates an open month.

**How to apply:** Derive `workedSundayDates` from positive actual rows, pass them into Pass 2, and keep the dates visible in the audit. For September 2026 the current stored snapshot has no actual rows, so the honest current basis is 26 days; a later snapshot with four worked Sundays produces 30 days.