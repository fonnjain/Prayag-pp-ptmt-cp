---
name: Plumbing FG Stock file structure
description: Actual Plumbing FG Stock layout, source-category quirks, sign semantics, and month relationship used by the planner.
---

## File facts (June 2026 "FG Stock and Pending Production" file)

- Sheets: `FG Stock`, `Pending prod.`
- **Use `FG Stock` sheet only** — `Pending prod.` mirrors the negative Net Stock values; do not double-count.
- Header row: index 3 (row 4 in 1-based); rows 1-3 are blank/total/month-header.
- Scan confirmed by "Item Code" + "Net Stock" header detection — no hard-coding needed.
- Columns: A=Item Code, B=Item Name, C=Category, D=Packing, R=Net Stock (index 17)

## Two-tab selection guard

The generic worksheet scanner must treat `Net Stock` as a header hint. Otherwise it can fail to recognize the later-row `FG Stock` header and select the sibling `Pending Prod.` tab, which exposes the mirrored negative quantities as if they were the source.

**Why:** The workbook can contain both tabs with `Item Code` and `Net Stock`; preferred worksheet names only work after both sheets are recognized as content candidates.

**How to apply:** For future FG Stock uploads, verify the selected worksheet is `FG Stock`, never `Pending Prod.`, and confirm the positive/negative/net totals before any plan or policy check.

## Category strings that appear (actual values)

| Actual string     | Maps to        |
|-------------------|----------------|
| CPVC-PIPE         | CPVC Pipe      |
| CPVC-FG / CPVC FG / CPVC FITTING / cpvc fg / CPVC FG | CPVC Fitting |
| UPVC-PIPE / UPVC PIPE / UPVC PIPE FG | UPVC Pipe / Fitting* |
| UPVC-FG / UPVC FG / UPVC -FG / UPVC FITTING | UPVC Fitting |
| SWR-PIPE          | SWR Pipe       |
| SWR-FG / SWR FG   | SWR Fitting    |
| Agri-Pipe / AGRI-PIPE / AGRI PIPE | AGRI Pipe |
| AGRI-FG / AGRI FG | AGRI Fitting   |
| **CPVC-TRADING**  | CPVC Solvent ← only if item name has SOLVENT/CEMENT |
| **UPVC-TRADING**  | UPVC Solvent ← only if item name has SOLVENT/CEMENT |
| **Agri-Trading**  | AGRI Solvent ← only if item name has SOLVENT/CEMENT |
| SWR-TRADING       | null (Rubber Lubricants — not Solvent) |
| WATER TANK / PPR / Colum Pipe / Trading | null (excluded) |

*UPVC PIPE FG (2 rows) ends with " FG" → classified as UPVC Fitting by isFitting logic.

## Critical: Solvent items are under TRADING categories

Solvent cement is a **traded** (not manufactured) item in the ERP. Its FG Stock category
is `CPVC-TRADING`, `UPVC-TRADING`, or `Agri-Trading` — NOT a dedicated "Solvent" category.

**Fix**: `inferPlumbingCategory(rawCategory, itemName)` now:
1. Checks TRADING rows first.
2. If item name contains SOLVENT or CEMENT → maps to material Solvent (material from category string).
3. Otherwise → null (skip).

`extractRows` for `plumbing_fg_stock` must include `"Item Name"` in the output row so
`upsertPlumbingItemMaster` can pass it to `inferPlumbingCategory`.

## Actual Solvent items found (June 2026)

| Code  | Category    | Item Name                        | Net Stock |
|-------|-------------|----------------------------------|-----------|
| S3    | CPVC-TRADING | CPVC SOLVENT CEMENT 59 ML TIN   | 57        |
| EWS04 | CPVC-TRADING | CPVC SOLVENT -118ML-TIN (PR)    | 88        |
| EWS05 | CPVC-TRADING | CPVC SOLVENT -237ML-TIN (PR)    | 168       |
| S11   | UPVC-TRADING | UPVC SOLVENT AQUA-CLEAR 20 ML   | 0 (skip)  |
| S13   | UPVC-TRADING | UPVC SOLVENT CEMENT 59 ML TIN   | 9,816     |
| S45   | Agri-Trading | 250 ML TIN PVC SOLVENT CEMENT   | -837      |
| S46   | Agri-Trading | 500 ML TIN PVC SOLVENT CEMENT   | 490       |
| S47   | Agri-Trading | 1000 ML TIN PVC SOLVENT CEMENT  | 355       |

**No SWR Solvent items** in this file — SWR-TRADING rows are Rubber Lubricants.
SWR Solvent plan value comes entirely from sales (avg × buffer) + pending orders.

## Net Stock sign convention (confirmed)
- Positive → opening stock on 1st of planning month
- Negative → |value| = pending-LM (oversold / dummy stock)
- Zero → skipped by extractRows (`if netStock === 0 continue`)

## Dummy-stock provenance clarification
- Plumbing has no separate dummy-stock upload; its negative `Net Stock` path is still consumed as `pendingOrderLastMonth`.
- The plan provenance label `dummyStock: not-used` describes only the absent separate input and must not be read as a segment-wide gate disabling negative-Net-Stock consumption.

**Why:** PB9.1 separated a misleading provenance label from the active negative-stock parser; conflating them would make every Plumbing plan appear to omit its pending-last-month term.

**How to apply:** When auditing Plumbing dummy stock, inspect `pendingLmMap` and the roster join separately from the provenance metadata, and report source total versus joined plan total.

## Durable source rules confirmed for the September 2026 audit

- For Plumbing, the FG Stock source month is the month before the planning month. An August-named/source workbook feeds the September plan; this differs from PTMT.
- The planning taxonomy is 15 material/type lines when including CPVC and UPVC `FITTINGS` separately from `FITTING`; the current app canonicalizes both source spellings into singular `Fitting`.
- The live FG Stock source exposes 17 raw category values. Matching is case-insensitive. `TRADING` is not inherently Solvent: only named Solvent/Cement rows under a known material map to a Solvent category; other Trading rows are excluded.
- Plumbing pending scope includes `PLUMBING`, `PL`, and `AGRI` source segments. `PT` is PTMT evidence, not Plumbing demand.
- A real multiplier of 2.0 exists for CPVC Solvent; multiplier validation must not cap values at 1.5. HDPE has no effective FG Stock/planning tab in the September source.

**Why:** Prayag’s source files use a month-lagged FG Stock filename, separate `FITTINGS`/`FITTING` lines, mixed raw category vocabulary, and three Plumbing pending segment labels. Treating these as PTMT-like conventions creates silent stale-input or category-zero errors.

**How to apply:** Keep source-period interpretation segment-specific, preserve raw-category diagnostics, and compare Plumbing at the app’s canonical category grain only after documenting any source-level taxonomy collapse.
