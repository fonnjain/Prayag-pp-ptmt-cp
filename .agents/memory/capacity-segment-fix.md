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
Plumbing production actuals feed (equivalent of PTMT ANUJ) is not wired yet.
All Plumbing capacity rows start as thin-data (isThinData=1, suggestedCapacity=0).
Users must set Override values manually until the actuals feed is connected.
