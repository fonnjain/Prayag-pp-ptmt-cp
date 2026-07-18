---
name: Plumbing workbook reader architecture
description: Correct two-source architecture — FG Stock upload for stock/pendingLM, workbook for avg3Mo/pending/type. Both are required.
---

## Architecture (two required sources)

`buildPlumbingPlanItemsFromWorkbook(month)` in `routes/plan.ts` handles all Plumbing plan building.
`buildPlanItems` early-returns to this function when `segment === "Plumbing"`.

### Source 1 — FG Stock UPLOAD (`plumbing_fg_stock`) — REQUIRED

Uploaded file: "FG Stock and Pending Production month of June.xlsx" → worksheet "FG Stock"

Parsed columns (by header name, with position fallback):
- `"Item Code"` → item code
- `"Net Stock"` → signed number
  - **Positive** → `stock` (opening stock on 1st of month)
  - **Negative** → `|value|` = `pendingOrderLastMonth`
  - Zero rows are skipped at upload time (uploads.ts)

Built into Maps in `buildPlumbingPlanItemsFromWorkbook`:
- `stockMap: Map<normalizedCode, number>`
- `pendingLmMap: Map<normalizedCode, number>`

**Without this upload, stock=0 and pendingLM=0 for all items → plan comes out EMPTY.**

### Source 2 — Daily-Production Workbook (Google Sheets) — for avg3Mo, pending, TYPE

`fetchPlumbingPlanData(month)` in `lib/sheets.ts`.
Reads tabs CPVC, UPVC, SWR, AGRI from `PLUMBING_DAILY_WORKBOOK_IDS[month]`.

Column detection (all by header text, never position):
- `avg3moCol`: `/last\s*3\s*month\s*avg|3.*month.*avg.*sale/i`
- `pendingLmCol`: `/pending.*last\s*month|last\s*month.*pending/i` (read but NOT used in plan)
- `stockCol`: `/stock\s*as\s*on/i` (read but NOT used in plan — FG upload is authoritative)
- `pendingCol`: `/pending\s*order/i` AND NOT `last\s*month` AND index ≠ pendingLmCol
- `codeCol`: `/item\s*code|old.*item|erp.*code/i`
- `typeCol`: `/^type$/i` header first; then scan first 20 data rows for PIPE/FITTING/FITTINGS/SOLVENT

Type → category: `${material} Pipe|Fitting|Solvent`
Items with unrecognized type are skipped (totals/blanks).

**Do NOT copy the workbook's finished "Production Required" column — that would inherit the AGRI error.**

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

## Formula

```
Buffer Req (per item) = Avg3Mo × multiplier
Production Required   = max( (Buffer − Stock) + PendingLM + Pending , 0 )
Category total        = sum of per-item values
```

Multipliers: CPVC 1.5×, UPVC 1.5×, AGRI 1.5×, SWR 1.0× (migration 011).

## Verification targets

CPVC Pipe 130,451 · CPVC Fitting 763,253 · CPVC Solvent 16,539
UPVC Pipe 51,899 · UPVC Fitting 633,038 · UPVC Solvent 542
SWR Pipe 64,515 · SWR Fitting 236,315 · SWR Solvent 1,255
AGRI Pipe ≈20,299 · AGRI Fitting ≈54,590 · AGRI Solvent 0
Grand total 1,922,309 pcs
