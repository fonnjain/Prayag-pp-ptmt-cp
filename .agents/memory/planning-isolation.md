---
name: Planning input isolation
description: Plan-build path reads stock from uploads while current pending comes from the segmented live report; all sheet reads remain allow-listed.
---

**Rule:** The plan BUILD path reads stock and last-month pending from uploads, but reads current pending from the segmented live Pending order / report sheet using `Bal. Qty`. Every sheet read inside a planning context must be allow-listed: sales history (avg-3-month), Plumbing workbook roster/avg/multiplier columns, BOM weights, and current pending. Computed Production-Required/Min/Max columns must never be read from any sheet.

**Why:** Silent sheet fallbacks and zero-defaults produced under-planned months. Current pending is intentionally the live report so plan and corrective calculations share the same pending universe; stock and historical inputs remain upload-backed for reproducibility.

**How to apply:**
- Guard infra lives in sheets.ts: `runInPlanningContext` + allowed-read scopes; choke point in proxyJson/driveProxyJson throws `PlanningIsolationError` naming the call site; disallowed fetchers also assert at entry. Any NEW sheet fetcher must either be wrapped in an allowed scope (if planning needs it) or get a named guard.
- Order column is display-only: annotated via `annotateLiveOrders` OUTSIDE the planning context on /plan + excel/pdf export routes; sheet outage → order shows 0, plan totals unaffected.
- Current pending reads the global live report with segment filters PTMT/PT and PLUMBING/P/PL/AGRI, balance-only columns (never invoice `Quantity`); the workbook `PENDING ORDER` column and DATA.xlsx pending upload are not plan sources.
- A successful live read with zero or empty recognized rows remains a diagnostic result; unavailable or unparseable reads fail loudly rather than becoming an implicit zero.
- `/plan/validate` runs live self-tests: simulated missing upload (AsyncLocalStorage-scoped, never global), live pending diagnostics, and a disallowed-read probe; PTMT also checks avg-3-mo band 0.4–2.5× vs prior month.
- Non-planning reads unchanged: monitoring actuals, corrective Sheet3, machine capacity — they never run inside a planning context.
- Present-but-malformed uploads are also guarded: schema (expected header names) + join-coverage checks throw `PlanningInputError` instead of yielding zero-stock plans.
