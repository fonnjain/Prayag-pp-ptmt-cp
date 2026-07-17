---
name: Plumbing monitoring tab
description: /monitoring/plumbing route — plan-targets-only overview page; PTMT/Plumbing tabs in header; sidebar switches to Plumbing nav.
---

## Rule

The Production Monitoring app has a PTMT/Plumbing segment toggle in the header.
PTMT tab → /monitoring/plant (all existing pages unchanged).
Plumbing tab → /monitoring/plumbing (single overview page).

## Implementation

- **Header tabs**: `<a href="/monitoring/plant">PTMT</a>` / `<a href="/monitoring/plumbing">Plumbing</a>` in AppLayout using `isPlumbingPage = location === "/plumbing"`.
- **Sidebar**: When `isPlumbingPage`, shows "PLUMBING" section with "Plan Overview" link only. "PTMT MON" → "PLUMBING MON" in sidebar header.
- **Route**: `/plumbing` in App.tsx Router → `<PlumbingMonitoring month={month} />`.
- **Page**: `artifacts/production-monitoring/src/pages/plumbing.tsx` — amber "Live actuals not yet connected" banner; "Load plan data" button calls `/api/plan/validate?segment=Plumbing`; formula reference card; link to Planning app.

## What the Plumbing page shows

- Plan targets table (Production Required per category) from validate endpoint's `categoryTotals`
- Formula reference (standard vs swragri)
- KG target reference (~391,404 kg total)
- Link to Production Planning app for item-level detail, weekly release, export

## Live actuals status

Daily Production PLUMBING machine feed not yet wired. When wired, the Plumbing pages (velocity, attainment, warnings) should mirror the PTMT plant pages, scoped to Plumbing categories.
