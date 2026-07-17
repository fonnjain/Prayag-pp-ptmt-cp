---
name: Plumbing FG Stock file structure
description: Actual column layout, category strings, and Solvent parsing quirks from the real June 2026 FG Stock upload file.
---

## File facts (June 2026 "FG Stock and Pending Production" file)

- Sheets: `FG Stock`, `Pending prod.`
- **Use `FG Stock` sheet only** — `Pending prod.` mirrors the negative Net Stock values; do not double-count.
- Header row: index 3 (row 4 in 1-based); rows 1-3 are blank/total/month-header.
- Scan confirmed by "Item Code" + "Net Stock" header detection — no hard-coding needed.
- Columns: A=Item Code, B=Item Name, C=Category, D=Packing, R=Net Stock (index 17)

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
