---
name: Capacity table segment isolation fix
description: How the Production Capacity table is scoped by segment, and the Plumbing seed bootstrapping
---

## Rule
Every DB query against `category_capacity` and `buffer_categories` tables must
include a `WHERE segment = ?` clause when serving a segment-specific request.

## What was wrong
- `GET /capacity/categories` had no segment filter — returned all 7 PTMT rows
  to the Plumbing tab.
- `computeCategoryCapacity` used PTMT-only SEED_VALUES and no segment param.
- `seedCategoryCapacity` bailed out early if ANY rows existed, so Plumbing
  rows were never seeded once PTMT rows were present.
- `POST /buffer-categories/recompute` returned all categories without filtering.

## How it works now
- `GET /capacity/categories?segment=PTMT` → 7 PTMT rows.
- `GET /capacity/categories?segment=Plumbing` → 12 Plumbing rows (all zeros /
  thin-data until Plumbing actuals feed is wired).
- `seedCategoryCapacity()` is idempotent per-category; seeds both PTMT (7) and
  Plumbing (12) on startup.
- `computeCategoryCapacity(trailingDays, segment)` — segment param controls
  item_master filter, buildPlanItems call, and seed value set used.
- Frontend `CapacityTable` uses `useSegment()` hook to pass segment to both
  `useListCategoryCapacities` and `useRecomputeCategoryCapacity`.

## Why
Plumbing tab was showing PTMT categories (Cocks Standard, Ball Cock, etc.)
instead of the 12 Plumbing categories. The GET endpoint was the root cause.

## Plumbing actuals
The Plumbing capacity recompute is now able to consume cached Sheet3 actuals, but
its source boundary is narrower than the monitoring source boundary. It reads
`plant_ingestion_cache` and month-specific `plant_source_configs`; it does not
automatically reuse the monitoring workbook resolver. A recompute can therefore
populate categories from cached months while silently having no rows for older
months whose Plumbing source configs/cache entries are absent.

Category assignment in this path depends on `item_master` code matching. The
Sheet3 reader has punctuation-insensitive normalized codes, but the cached
capacity rows currently retain raw codes and the capacity join does not consume
that normalized value. AGRI Fitting-style `A465`/`A-465` variants can therefore
have real production rows but remain zero in capacity.

**Why:** An all-zero seeded table is not evidence that the source workbooks have
no production. Recompute must be checked for month coverage and unmapped-code
counts before interpreting zero capacity as a business zero.

**How to apply:** Never treat Plumbing capacity as a complete trailing window
until every intended month has an ingestion row and the category join has been
audited. Keep genuinely unmapped or below-threshold categories thin-data rather
than filling them with synthetic rates or overrides.

Before accepting any populated Plumbing rate, validate the unit of Sheet3
quantity against the plan unit. The capacity reader currently has no explicit
kg/piece conversion or unit metadata, so a nonzero p90 can still be unusable
for Pass 2 if Sheet3 is kilograms while demand is pieces. Unmapped production
rows should be reported with code, quantity, and fallback group before any
family/category label is inferred.
