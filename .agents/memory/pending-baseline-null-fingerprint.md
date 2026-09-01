---
name: Unreproducible pending baseline fingerprint
description: Why the historical pending baseline intentionally stores a NULL exclusion fingerprint.
---

The audit-only historical pending baseline is intentionally representable with `capture_id = NULL` and `fingerprint = NULL`: the original source rows and exclusion ledger were never persisted, so no computed fingerprint would be truthful. Migration 051 drops `NOT NULL` before inserting that row; migration 053 repeats the constraint repair for databases that had already recorded an older form of migration 051.

**Why:** A fabricated fingerprint would make an unreproducible historical observation look evidence-backed and could incorrectly make it the active baseline.

**How to apply:** Keep the row marked `unreproducible`, exclude it from active-baseline selection, and require a captured, reconciled snapshot before computing a fingerprint. Treat later live reads as new point-in-time evidence rather than backfilling the old row.