---
name: Plant bundle in-memory cache
description: In-memory cache for computePlantBundle results; where it lives and how invalidation works.
---

The full PTMT monitoring computation (bundle + weekly summary, Google Sheets fetch + engine) takes 3-7s with no cache.

**Rule:** The in-memory monitoring cache in `routes/plant.ts` holds the complete `{ bundle, weekly }` result for 5 minutes and dedupes concurrent cold callers. `POST /plant/cache/invalidate` clears both the DB ingestion cache and the shared monitoring cache. Startup and completed syncs pre-warm the current PTMT month.

**Why:** The dashboard requests `/plant/bundle` and `/plant/weekly-summary` in parallel. The DB ingestion cache only stores raw actuals, so caching only the bundle made the weekly endpoint rebuild the same plan and Sheet inputs a second time.

**How to apply:** Any endpoint requiring either representation must use the shared getter, not call lifecycle computation directly. If source data or configuration changes, call `invalidatePlantBundleCache(month)`; epoch invalidation prevents an older in-flight calculation from repopulating the cache.
