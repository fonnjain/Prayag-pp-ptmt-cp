---
name: Planning uploads-only isolation
description: Plan-build path reads stock/pending from uploads only; sheet reads gated by an AsyncLocalStorage allow-list guard in sheets.ts.
---

**Rule:** The plan BUILD path (both segments) reads stock, pending, and pending-last-month ONLY from uploads and fails loudly (422, naming the file) when missing/unparseable. Live sheet reads inside a planning context are limited to an allow-list: sales history (avg-3-month), Plumbing workbook roster/avg/multiplier columns, BOM weights. Computed Production-Required/Min/Max columns must never be read from any sheet.

**Why:** Silent sheet fallbacks and zero-defaults produced under-planned months (silent-zero fault class); the user chose uploads-only with loud failure over freshness.

**How to apply:**
- Guard infra lives in sheets.ts: `runInPlanningContext` + allowed-read scopes; choke point in proxyJson/driveProxyJson throws `PlanningIsolationError` naming the call site; disallowed fetchers also assert at entry. Any NEW sheet fetcher must either be wrapped in an allowed scope (if planning needs it) or get a named guard.
- Order column is display-only: annotated via `annotateLiveOrders` OUTSIDE the planning context on /plan + excel/pdf export routes; sheet outage → order shows 0, plan totals unaffected.
- Plumbing current pending comes from the global DATA.xlsx upload (segments PLUMBING/P/PL/AGRI, balance-only columns — never "Qty"); the workbook PENDING ORDER column is no longer read. This shifted plumbing point-in-time goldens (~−2.4k grand total, re-rolled 2026-08-05).
- Pending=0 is legitimate ONLY for invoice-register layouts (no balance column) — `classifyPendingSource` in plan.ts makes this explicit; unparseable files throw.
- /plan/validate runs live self-tests: simulated missing upload (AsyncLocalStorage-scoped, never global) and a disallowed-read probe; PTMT also checks avg-3-mo band 0.4–2.5× vs prior month.
- Non-planning reads unchanged: monitoring actuals, corrective Sheet3, machine capacity — they never run inside a planning context.
- Present-but-malformed uploads are also guarded: schema (expected header names) + join-coverage checks throw `PlanningInputError` instead of yielding zero-stock plans.
