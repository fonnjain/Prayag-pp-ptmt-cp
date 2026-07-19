---
name: Plumbing per-item buffer multiplier — sheet column layout and three-tier model
description: Each material tab stores a per-item buffer multiplier in a column adjacent to TYPE; how to detect it and apply override/sheet/default priority.
---

## Rule — per-item sheet multiplier
Each material tab has a dedicated multiplier column. Sheet formula: `Buffer = Avg3Mo × (cell)`.
Confirmed layout (2026-07):
| Tab  | multiplierCol relative to typeCol | Typical values |
|------|----------------------------------|----------------|
| CPVC | typeCol − 1  (col C)            | Pipe/Fitting=1.5, Solvent=2.0 |
| UPVC | typeCol − 1  (col E)            | Pipe=1.2 or 1.5 per-item, Fitting=1.5, Solvent=2.0 |
| SWR  | typeCol − 1  (col D)            | Pipe=1.0, Fitting=1.2, Solvent=1.0 |
| AGRI | typeCol + 1  (col E)            | all 1.5 |

**Detection in code:** scan typeCol±1 and typeCol±2; pick first column where ≥60% of a 40-row sample are numeric in [0.5, 3.0]. AGRI tries typeCol+1 first because the multiplier sits between type and code (code is at typeCol+2).

## Three-tier multiplier priority (plan.ts)
1. `overrideMultiplier` from DB (user set in UI) — always wins
2. `row.sheetMultiplier` — per-item value from the workbook
3. `bufferDefaultMap.get(category)` — DB fallback/seed

## Category-level DB defaults (fallback when sheet cell blank)
- CPVC Pipe/Fitting = 1.5×, CPVC Solvent = 2.0×
- UPVC Pipe = 1.2×, UPVC Fitting = 1.5×, UPVC Solvent = 2.0×
- SWR Pipe = 1.0×, SWR Fitting = 1.2×, SWR Solvent = 1.0×
- AGRI all = 1.5×
SWR is locked at 1.0 (Pipe/Solvent) by migration 011 — do not change.

**Why:** Using a single category multiplier from the DB was producing wrong totals: CPVC Solvent items at 2.0×, UPVC Pipe mix of 1.2/1.5, SWR Fitting at 1.2 — none of which match a uniform category default.

**How to apply:** Buffer validate check uses ±1.0 tolerance for AI-computed categories (DB drifts) and exact=0 for SWR. Golden category totals use ±5% tolerance for the same reason.
