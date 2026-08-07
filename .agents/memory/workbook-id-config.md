---
name: Workbook ID resolution
description: How monthly Google workbook IDs are resolved per division (pin → static map → Drive auto-discovery), and the failure semantics.
---

Resolution priority in `resolveWorkbookForMonth(division, month)` (api-server sheets lib):
1. **DB pin** (`workbook_config` row) — always wins until unpinned; a title/month mismatch is logged loudly but the pin still applies (`titleMonthMatch:false`).
2. **Static map** exact-month entry (PTMT Apr–Jul 26, Plumbing Jul 26).
3. **Drive auto-discovery** by title pattern — PTMT: title contains "PTMT PLAN & ACTUAL" + month token; Plumbing: "Daily Production PLUMBING" + month token. Month/year must appear in the title; newest `modifiedTime` wins.

**Why:** monthly workbooks roll over; reading a prior month's sheet silently presents as stale/zero production. So there is **no fallback to another month** — no match throws `WorkbookResolutionError` naming the searched pattern, and `getWorkbookIdForMonth` now throws instead of returning null.

Failure semantics decided with the user:
- Plumbing Sheet3 read/resolution failures propagate loudly (corrective engine no longer swallows them into `[]` — zero production must never be silent).
- PTMT machine-kg (Report-5) failure must NOT hide piece actuals (which come from the fixed ANUJ mirror); monitoring exposes it via `sourceError` and `dataAvailable` stays true if piece data exists. Note: the "PTMT Date Sheet & Monthly Report" series (real Report-5 format) ended July 2026; the PLAN & ACTUAL workbook's "REPORT 5" tab is a different format that imports from the forbidden Daily Production PTMT sheet — never read that sheet (planning is uploads-only).

**How to apply:** endpoints `GET /workbook-config/resolved?month=` and `POST /workbook-config/refresh` show/refresh resolution for both divisions; pin/unpin via PUT/DELETE `/workbook-config/:id` (id = `<division lowercase>_<YYYY-MM>`; both invalidate resolution + Sheet3 caches). Regression suite WR1/WR2/WR3/WR5 guard month-match, non-stale actuals, monitoring↔corrective reconciliation (±2%, corrective adds new-order items), and the no-match named error. Drive proxy has 429/5xx backoff.
