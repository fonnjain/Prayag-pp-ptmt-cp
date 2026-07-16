---
name: Segment discriminator pattern
description: How PTMT and Plumbing segments coexist in the planning DB, API, and UI without touching each other.
---

## Rule
Every planning table has `segment TEXT NOT NULL DEFAULT 'PTMT'`. All DB reads in `buildPlanItems` and route handlers filter `WHERE segment = $segment`. PTMT behavior is unchanged because all defaults are 'PTMT'.

**Why:** Two product divisions (PTMT bathroom fittings, Plumbing pipes/fittings) share the same calc engine but have independent item masters, buffer categories, weekly release bands, and upload files.

## How to apply

### DB
- Migration pattern: `ADD COLUMN IF NOT EXISTS segment TEXT NOT NULL DEFAULT 'PTMT'` then seed Plumbing rows with explicit `'Plumbing'`.
- All seeding SQL uses `ON CONFLICT ... DO NOTHING` so re-running migrations is safe.

### API upload kinds
- PTMT: `current_stock`, `pending_orders`, `last_month_pending`
- Plumbing: `plumbing_current_stock`, `plumbing_pending_orders`, `plumbing_last_month_pending`
- In `buildPlanItems`: `const uploadPrefix = segment === "Plumbing" ? "plumbing_" : ""`

### Live order totals
- `fetchLiveOrderTotals(month, group='PTMT')` — filter Combined tab by GROUP column
- Plumbing ERP GROUP value: "PLUMBING"; PTMT: "PTMT"

### seasonality-engine.ts mapGroupToCategory
- Plumbing rules checked FIRST (CPVC/UPVC/SWR/AGRI + FITTING/FTG → 8 categories)
- Then PTMT rules (Ball Cock, Cabinet, etc.)

### UI
- `SegmentContext` at `src/contexts/segment-context.tsx` wraps entire app (inside QueryClientProvider, outside Router)
- `SegmentToggle` in sidebar: amber=PTMT, blue=Plumbing; navigates to /summary on switch
- Sidebar categories list uses `useListBufferCategories({ segment })` — NOT a hardcoded array
- All pages import `useSegment()` and pass `{ segment }` to API hooks and export URLs
- Corrective Plan is PTMT-only (not shown in Plumbing sidebar action links)

## Plumbing seed data
- 8 buffer_categories: CPVC/UPVC/SWR/AGRI × Pipe/Fitting, multiplier=1.5
- 8 weekly_release_bands: cover bands 0.3/0.5/0.8/1.5 months
- Daily workbook IDs in PLUMBING_DAILY_WORKBOOK_IDS map in sheets.ts
- Item master seeding: done at upload-time (plumbing_current_stock upload upserts item_master via inferPlumbingCategory)

## kg-from-BOM (Plumbing only)
- BOM sheet: 1R7k5O6w4qaT74G-5X2VXBtD7-Fg3uByvIw3-TeViMmA, tab "Combined" or "NEW"
- CRITICAL: master's own kg column is ~1000× too low — never copy it
- fetchPlumbingBomWeights() reads ITEM CODE → Weight/pcs, 15-min cache
- weightKg = maxProduction × weight_per_pcs; noBomWeight=true when no BOM entry (show 0 kg, never drop)
- /plan/bom-quality endpoint: lists missing-BOM items with missingPct (~3% expected)
- PTMT plan items never carry weightKg or noBomWeight (these fields are Plumbing-only)

## Validate endpoint isolation
- /plan/validate MUST filter itemMasterTable and bufferCategoriesTable by segment='PTMT'
  (originally read ALL rows — would mix segments once Plumbing data exists)

## Upload kinds
- uploads.ts VALID_KINDS must include: plumbing_current_stock, plumbing_pending_orders, plumbing_last_month_pending
- plumbing_current_stock handler: extract rows AND upsert item_master(segment='Plumbing') via inferPlumbingCategory
