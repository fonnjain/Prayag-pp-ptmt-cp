---
name: Plumbing golden values
description: July 2026 Production Required golden values for Plumbing validate — 12 categories, two formulas, grand total 1,922,309 pcs.
---

## Rule
The Plumbing self-check asserts 12 exact integer golden values (one per planning line).
AGRI Solvent = 0 is correct this month — no items in positive swragri formula territory.

**⚠ Solvent golden values must be re-verified after the TRADING-row fix (see below).**
Previously, Solvent items never entered item_master (TRADING rows were blanket-skipped),
so plan computed 0 for them. Now they are correctly loaded and values will change.

## Verified July 2026 values

| Category      | Prod Required | Formula  |
|---------------|-------------:|----------|
| CPVC Pipe     |      130,451 | standard |
| CPVC Fitting  |      763,253 | standard |
| CPVC Solvent  |       16,539 | standard |
| UPVC Pipe     |       51,899 | standard |
| UPVC Fitting  |      633,038 | standard |
| UPVC Solvent  |          542 | standard |
| SWR Pipe      |       64,515 | swragri  |
| SWR Fitting   |      236,315 | swragri  |
| SWR Solvent   |        1,255 | swragri  |
| AGRI Pipe     |        9,688 | swragri  |
| AGRI Fitting  |       14,814 | swragri  |
| AGRI Solvent  |            0 | swragri  |
| **TOTAL**     |  **1,922,309** |        |

## Two formulas

- **standard** (CPVC, UPVC): `max((BufferReq − Stock) + PendingLM + Pending, 0)`
- **swragri** (SWR, AGRI): `max((Stock + Pending) − BufferReq + PendingLM, 0)`

Routed in `buildPlanItems` by `item.category.startsWith("SWR") || item.category.startsWith("AGRI")`.
SWR/AGRI item codes can be numeric (5111, 5711); stored as strings in item_master — no special handling needed.

## 12 categories: 4 materials × 3 types

Pipe + Fitting + Solvent for CPVC, UPVC, SWR, AGRI.
The 3 Solvent categories added in migration 008 (CPVC, UPVC, AGRI Solvent; SWR Solvent was migration 007).

## Solvent detection in inferPlumbingCategory

Detect SOLVENT/CEMENT **before** generic Pipe/Fitting check. Resolve material first:
- CPVC → "CPVC Solvent"
- UPVC → "UPVC Solvent"
- SWR  → "SWR Solvent"
- AGRI → "AGRI Solvent"
- No recognised material → null (row skipped)

## Source column per master tab

Detect by header label "PRODUCTION REQUIRED FOR JulXX (PCS)" — do NOT hard-code a column letter.
Column shifts: CPVC→O, UPVC→Q, SWR→S, AGRI→S.
