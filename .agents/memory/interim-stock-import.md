---
name: Interim stock + PTMT pending import from master workbook
description: Why opening stock and PTMT last-month pending are read from the monthly master with FIXED column positions, the absolute-index gotcha, and the MASTER_SOURCES routing map.
---

# Interim master-derived sources (stock + PTMT pending)

Opening stock (both divisions) and PTMT last-month pending are NOT in the
upstream source files — the planner maintains them in the monthly MASTER
workbook. Until dedicated sheets exist, they are read from the current month's
master via `source_config` rows whose `file_id` is that master, routed through a
fixed-position mapper (not the header-alias `mapRows`), because the master tabs
are headerless.

**Routing is data-driven via `MASTER_SOURCES[division][handler]`** in
ingestion.ts (a `{startIdx, code, colour, qty}` map). The pull loop does
`masterColFor(division, handler)` → if present, `mapFromMaster(...)`, else
`mapRows(...)`. `mapFromMaster` emits stock rows (asOn) or pending rows
(period='last_month', planMonth) based on `handler`. **Blank/non-numeric qty is
kept as 0** (a real "no stock / no pending" value), NOT rejected — this keeps the
master roster complete (see roster-scope.md). CP pending is a REAL per-month
sheet (alias mapper), so it is intentionally NOT in MASTER_SOURCES.

**Absolute-index gotcha (the thing to get right):** the pull loop reads each tab
as the WHOLE range `${tab}!A1:Z200000`, so the stock mapper's column indices are
ABSOLUTE A1 columns (A=0, B=1, … K=10, Q=16, S=18), NOT range-relative. The
spec's verified table gives ranges relative to a slice (`TOP ITEM!B4:K`,
`Sheet3!Q3:S`); do not copy those relative indices — translate to absolute.

Mappings (verified):
- PTMT stock: tab `TOP ITEM`, data from row 4 (idx 3): item_code=B(1),
  colour=C(2), qty=K(10). Keys item_code+colour.
- PTMT pending (last_month): SAME tab `TOP ITEM`, same rows, qty=J(9) (col J,
  one left of stock's K). Both PTMT stock and pending point at the same master
  file+tab — they differ only by `data_type`, so the source_config unique key
  (division,data_type,file_id,tab_pattern) does not collide.
- CP stock: tab `Sheet3`, data from row 3 (idx 2): item_code=Q(16), qty=S(18),
  colour='' (keys item_code only). NEVER read Sheet8 — that block is
  pending-last-month, not stock. CP pending stays a real per-month sheet.
- `as_on` / `plan_month` = first day of plan month. Upsert keys
  (item_code,colour,as_on,division) / (item_code,colour,period,plan_month,division).
- Sanity sums (June 2026): PTMT stock ≈ 26,566, PTMT pending_last ≈ 72,263;
  CP stock ≈ 42,381. A wildly different total means a wrong column/tab/index.

**Spec self-conflict:** the spec's illustrative Node snippet used a colour index
of 2 within a B-relative range (= col D), conflicting with the verified table's
"colour = col C". Trust the verified TABLE (colour=C), not the snippet.

**Monthly rotation:** the master changes each month. The TS seed uses
`onConflictDoNothing`, so swapping the master means EDITING the division's `stock`
row's file_id (via the Settings screen / source_config), not adding a new row.

**Retirement:** when a real opening-stock sheet/export arrives, point the `stock`
source_config row at it and retire the fixed-position mapper; `stock_opening`
and the engine do not change.
