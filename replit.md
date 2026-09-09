# Project

This workspace has been reset and is ready for a new project.

## Production data safety

- Production PostgreSQL backup schedule and retention are not exposed to the Agent API; verify them in Database → Production → Restore settings before an incident.
- The "External database detected" banner is expected and must never be acted on. This project uses Neon via `DATABASE_URL`. Removing it disconnects production.

## Plumbing notes

- The Plumbing stock join is CODE-ONLY. `plumbingStockJoinDiagnostics()` compares normalised item codes against the typed workbook roster. The FG Stock `Category` column is NOT used to resolve item type — the plan builder takes type from the workbook row. Unmatched stock rows fail on item code, never on category label.
- The FG Stock category column is a data-quality note, not a join defect: it carries changing label vocabularies across uploads, including `cpvc fg` and `.`, but it is not in the join path and needs no fix.
- The Plumbing corrective scheduler excludes rows whose rounded corrective remainder is below one piece at the scheduler boundary and reports them in `schedulerAudit`. On the July live rebuild, fitting demand row `A-443` / `AGRI Fitting` carries `remainingToProduce = 0.35`, so it is reported as one excluded sub-one-piece row rather than sent as `qty_pcs = 0`. Fractional colour-level plan quantities remain valid upstream; the machine validator stays strict.

## User preferences

(none yet)
