# PTMT and Plumbing monitoring parity boundaries

The shared plant monitoring lifecycle is now the source of truth for both
supported reporting segments:

- lifecycle states: future, open, grace, and closed
- working-day resolution and completed-month observed-day precedence
- finalized-plan lookup and issued-plan timeline provenance
- immutable monthly monitoring snapshots in `plant_month_snapshots`
- shared bundle, weekly-summary, trend, snapshot-backfill, and cache paths
- segment-isolated configuration, source, ingestion, and snapshot keys

## Plumbing functionality intentionally retained

These Plumbing pages are operationally specific and are not duplicates of the
shared PTMT monitoring surface:

- `plumbing-machine-release` — PIPE/MOULD machine cascade and release detail
- `plumbing-operations` — Plumbing execution operations
- `plumbing-quality` — Plumbing quality and machine-specific quality detail

Their source contracts and domain-specific calculations should remain intact
while the shared plant lifecycle supplies their month/freeze boundary.

## Overlapping System B candidates for later retirement

The following pages overlap the shared plant monitoring surface and should be
retired or redirected only after product-owner sign-off and frontend migration
checks:

- `plumbing-attainment`
- `plumbing-velocity`
- `plumbing-warnings`
- `plumbing-recommendations`
- `plumbing-trend`
- `plumbing-reports`
- `plumbing-config`

This commit documents the candidates only. It does not delete pages, endpoints,
or links, and it does not add CP to the segment registry.