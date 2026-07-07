---
name: Plant bundle in-memory cache
description: In-memory cache for computePlantBundle results; where it lives and how invalidation works.
---

The plant bundle computation (Google Sheets fetch + engine) takes 3-7s with no cache.

**Rule:** The in-memory `bundleCache` Map in `routes/plant.ts` holds computed bundles for 5 min (BUNDLE_CACHE_TTL_MS). `POST /plant/cache/invalidate` clears BOTH the DB ingestion cache AND this Map via `invalidatePlantBundleCache(month)`.

**Why:** The DB ingestion cache (`plantIngestionCacheTable`) only caches raw actuals rows. The bundle computation itself (building categories, warnings, recommendations) adds another 2-4s on top and was uncached.

**How to apply:** If you add a new bundle-level computation or change config that affects the bundle, call `invalidatePlantBundleCache(month)` wherever config is mutated (e.g., plant-config save route).
