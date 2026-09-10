# Project

This workspace has been reset and is ready for a new project.

## Production data safety

- Production PostgreSQL backup schedule and retention are not exposed to the Agent API; verify them in Database → Production → Restore settings before an incident.
- The "External database detected" banner is expected and must never be acted on. This project uses Neon via `DATABASE_URL`. Removing it disconnects production.

## Plumbing notes

- The September 2026 Plumbing roster comes from the MATERIAL tabs (CPVC, UPVC, SWR, AGRI, HDPE), not the production-planning tabs. It has thirteen categories, including HDPE Pipe and AGRI Solvent; AGRI is planned for September (205 items, 66,595 pieces).
- The Plumbing stock join is CODE-ONLY. `plumbingStockJoinDiagnostics()` compares normalised item codes against the typed workbook roster. The FG Stock `Category` column is NOT used to resolve item type — the plan builder takes type from the workbook row. Unmatched stock rows fail on item code, never on category label.
- The FG Stock category column is a data-quality note, not a join defect: it carries changing label vocabularies across uploads, including `cpvc fg` and `.`, but it is not in the join path and needs no fix.
- The Plumbing corrective scheduler excludes rows whose rounded corrective remainder is below one piece at the scheduler boundary and reports them in `schedulerAudit`. On the July live rebuild, fitting demand row `A-443` / `AGRI Fitting` carries `remainingToProduce = 0.35`, so it is reported as one excluded sub-one-piece row rather than sent as `qty_pcs = 0`. Fractional colour-level plan quantities remain valid upstream; the machine validator stays strict.

## Prayag machine scheduler contract

- The current scheduler contract is `POST /data-api/v1/schedule`. It is a non-persistent machine-scheduling service: the local `plan_runs` record is our persistence of a preview, not a Prayag plan run.
- Prayag is authoritative for any future executable Plumbing machine plan. The local cascade routes at machine/material grain and answers a different, explicitly labelled estimate question; it must never silently substitute for a missing, failed, partial, stale, or not-yet-generated Prayag result.
- Machine routing correction: `MC8` is not locked out and has one AGRI route. `MC7` is the unusable machine with configured hours but zero routing rows.
- Prayag's capacity model is machine-hours, not a pieces-per-day capacity table. Pipe demand is converted through BOM kilograms and kg/hour; fitting demand uses item-machine cycle/cavity rates. Local pieces-per-day rates are separate sanity-check observations and must not be presented as the Prayag fit model.
- The August benchmark previously described as 112 lines, 1,003,518 pieces, 80.8%, and 99.59% is **unevidenced** and not reproducible from Prayag's current non-persistent contract. Keep it marked as unevidenced rather than using it as a benchmark.

## Prayag roster and source reconciliation

- The September 2026 PTMT roster comes from REPORT 1–9 at item-code and colour grain, not the category tabs. The grain is not uniform: REPORT 2 is code-level with blank colours, so joins fall back to code-only for those rows.
- Prayag clamps per colour in the REPORT tabs; the app's colour-level clamp matches the actual plan and is not a method difference.
- September source reporting targets are 1,866,432 Plumbing pieces across 1,136 MATERIAL-tab rows. The dated PTMT SUMMARY snapshot read on 2026-09-09 covers REPORT 1–7 only: 597,023 target pieces across the 3,426 REPORT rows; REPORT 8 and REPORT 9 are explicitly not produced by Prayag and have no target. AGRI and HDPE remain inside the Plumbing total; Unmapped is reported separately.

## User preferences

(none yet)
