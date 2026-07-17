---
name: Plumbing golden values
description: July 2026 Production Required golden values for Plumbing — 12 categories, ONE formula for all, grand total 1,922,309 pcs.
---

## Verified July 2026 values

| Category      | Prod Required |
|---------------|-------------:|
| CPVC Pipe     |      130,451 |
| CPVC Fitting  |      763,253 |
| CPVC Solvent  |       16,539 |
| UPVC Pipe     |       51,899 |
| UPVC Fitting  |      633,038 |
| UPVC Solvent  |          542 |
| SWR Pipe      |       64,515 |
| SWR Fitting   |      236,315 |
| SWR Solvent   |        1,255 |
| AGRI Pipe     |        9,688 |
| AGRI Fitting  |       14,814 |
| AGRI Solvent  |            0 |
| **TOTAL**     |  **1,922,309** |

## Formula — ONE formula for ALL 12 categories

```
MaxProduction = max(BufferReq − Stock + PendingLM + Pending, 0)
BufferReq = Avg3MoSale × bufferMultiplier
```

**Why one formula:** A previous "swragri" variant (`max(stock + pending − buffer + lastMo, 0)`)
was implemented based on incorrect instructions; it is wrong and has been removed (migration 011).
The per-item `max(…,0)` clamp makes negative items contribute 0, which is equivalent to
"sum only positive items" (master's SUMIFS > 0) without a separate code path.

## Buffer multipliers

| Material | Default | Applied (DB) |
|---|---|---|
| CPVC | 1.5× | AI-tuned ~1.23–1.30 |
| UPVC | 1.5× | AI-tuned ~1.23–1.29 |
| AGRI | 1.5× | AI-tuned ~1.27–1.60 |
| **SWR** | **1.0×** | **1.0× (fixed by migration 011)** |

SWR was incorrectly seeded at 1.5× (migrations 006/007). Migration 011 corrects this.
Multipliers stored in `buffer_categories.multiplier` (editable via Suggested/Override/Applied UI).

## Stock / Pending-LM from FG Stock upload

`plumbing_fg_stock` Net Stock column (signed):
- Net Stock > 0 → Stock = value; Pending-LM = 0
- Net Stock < 0 → Stock = 0; Pending-LM = |value|
- Net Stock = 0 → skip

Column name fallbacks tried: "Net Stock", "Net-Stock", "Net stock", "NetStock".

## 12 categories

4 materials (CPVC, UPVC, SWR, AGRI) × 3 types (Pipe, Fitting, Solvent).
Solvent rows detected via item name (SOLVENT/CEMENT keyword) before Pipe/Fitting check.
AGRI Solvent = 0 is correct — no items in positive territory this month.
