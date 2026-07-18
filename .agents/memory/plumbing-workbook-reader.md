---
name: Plumbing workbook reader architecture
description: Plumbing plan is now built entirely from the daily-production workbook by header-name mapping — no item_master, no uploads.
---

## Architecture (post-refactor)

`buildPlumbingPlanItemsFromWorkbook(month)` in `routes/plan.ts` handles all Plumbing plan building.
`buildPlanItems` early-returns to this function when `segment === "Plumbing"`.

### Data sources for Plumbing

| Input | Source |
|---|---|
| Avg 3-Mo Sale | Workbook column "LAST 3 MONTH AVG SALE" (already monthly avg) |
| Stock | Workbook column "STOCK AS ON \<date\>" |
| Pending Order | Workbook column "PENDING ORDER" (not LAST MONTH) |
| Pending-LM | Workbook column "PENDING ORDER LAST MONTH" |
| Live Order | Order Sheet 26-27 via `fetchLiveOrderTotals(month, "PLUMBING")` |
| BOM weight | BOM sheet via `fetchPlumbingBomWeights()` |
| Buffer multiplier | `buffer_categories` table (DB) |

**item_master is NOT queried for Plumbing.**
**plumbing_fg_stock upload is NOT used for plan building** (may still exist in upload UI).

### Workbook reading: `fetchPlumbingPlanData(month)` in `lib/sheets.ts`

Reads tabs CPVC, UPVC, SWR, AGRI from `PLUMBING_DAILY_WORKBOOK_IDS[month]`.

Column detection (all by header text, row scan first 15 rows):
- `avg3moCol`: `/last\s*3\s*month\s*avg|3.*month.*avg.*sale/i`
- `stockCol`: `/stock\s*as\s*on/i`
- `pendingLmCol`: `/pending.*last\s*month|last\s*month.*pending/i`
- `pendingCol`: `/pending\s*order/i` AND NOT `last\s*month` AND index ≠ pendingLmCol
- `codeCol`: `/item\s*code|old.*item|erp.*code/i`
- `typeCol`: `/^type$/i` header first; then scan first 20 data rows for PIPE/FITTING/FITTINGS/SOLVENT

Type → category: `${material} Pipe|Fitting|Solvent`
Items with unrecognized type are skipped (totals/blanks).

### avg3MoSale → avg3MoSaleTotal3Mo

`calc.ts` computes `avg3MoSale = avg3MoSaleTotal3Mo / 3`.
Workbook value is already the monthly average.
So: `avg3MoSaleTotal3Mo = workbookAvg3Mo * 3` in the ItemSourceRow.

### AGRI correction

The master's AGRI tab has Stock and Buffer columns SWAPPED vs SWR.
Header-name mapping corrects this → AGRI Pipe ≈20,299, AGRI Fitting ≈54,590.
The master's positional figures (9,688 / 14,814) are WRONG for AGRI.
Excel export adds an italic note to AGRI tabs documenting the correction.

**Why:** The user confirmed: "the spreadsheet cannot be fixed. Best is to take header name in AGRI."
