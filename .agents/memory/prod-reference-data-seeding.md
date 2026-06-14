---
name: Production reference-data seeding
description: Why required reference/config rows must be seeded on server boot, not via a manual SQL seed.
---

# Production reference-data seeding

Required reference/config rows (e.g. `source_config` — the Google Sheets file IDs the
ingestion service selects from) MUST be seeded idempotently on API-server boot, not only
via a manual `psql -f lib/db/seeds/*.sql` run.

**Why:** Replit's publish flow applies the dev→prod *schema* diff but never copies table
*rows*. A manual dev-only seed leaves production's table empty. With empty `source_config`,
a data pull selects no sources → inserts nothing → the engine produces 0 lines → the plan
and Excel export are blank, while every endpoint still returns 200 (silent failure).

**How to apply:**
- Seed in `artifacts/api-server/src/services/seed.ts`, called from `index.ts` and `await`ed
  *before* `app.listen` so the first `/data/pull` can't race an unseeded table.
- Use `insert(...).onConflictDoNothing()` against the table's natural unique key
  (`source_config_uq` = division, data_type, file_id, tab_pattern) — never DELETE+INSERT —
  so it never wipes edits made through the Settings screen and is safe on every boot.
- Seed failures are logged, not fatal (server still starts); watch for `source_config seed failed`.

Related guard: `buildPlan()` throws `EmptyPlanError` (→ HTTP 409) when the engine yields 0
lines, so an empty/blank plan run is never silently persisted regardless of why data is missing.
