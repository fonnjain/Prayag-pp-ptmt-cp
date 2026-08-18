# Plumbing Production Planning — Logic Reference

This document records Plumbing-segment methodology decisions and measured golden
values. Keep Plumbing goldens here — not in LOGIC_PTMT.md — so they are not
missed at month rollover.

Cross-segment methodology (rounding, MISMATCH tolerance, segment conventions)
lives in LOGIC_PTMT.md §A and §C.

---

## §P1 — NC21b: Plumbing August 2026 corrective baseline item-sum

Asserted value: **2,331,647 ±200 pcs** (production API).
Basis: `run.originalMonthTotal` (stored 32-bit real, rounded to INTEGER) on the
Plumbing/2026-08 corrective run citing plan run #21.

### Three distinct values (same pattern as LOGIC_PTMT.md §A7)

| Value | Basis |
|-------|-------|
| **2,331,647 pcs** | `run.originalMonthTotal` — stored real, rounded to INTEGER |
| **2,331,648 pcs** | `frozenPlanGrandMax` (`plan_run_results`) — Σ `productionPlan` for plan run #21 items; first measured on corrective run #16 |
| **2,331,750 pcs** | `detailOrigHeader` — per-item `Math.round(originalPlan)` sum read from the Detail Excel "Orig Month Total" header cell |

**Why the 1-pcs gap (2,331,648 − 2,331,647):** two independent float64
accumulations of the same float32 source values — same cause as the PTMT 1-pcs
gap documented in LOGIC_PTMT.md §A7. Both are within the ±200 MISMATCH tolerance.

**Why the 103-pcs gap (`detailOrigHeader` 2,331,750 − `storedOrig` 2,331,647):**
float32 accumulation over 1,120 items where individual quantities are large
(Plumbing items average ~2,082 pcs vs PTMT's ~170 pcs). This is the §A2
float32-band gap for Plumbing, measured against the August 2026 production run.
The ExportTotals check (±500) was calibrated above this value with explicit margin.
See LOGIC_PTMT.md §A2 for the cross-segment divergence table and threshold derivation.

---

## §P2 — NC21e: Structural baseline integrity (Plumbing)

Always-on check: Plumbing corrective `baselinePlanRunId === max(finalized
Plumbing plan run ids for 2026-08)`. Does not require knowing the production
sequence in advance. See LOGIC_PTMT.md §B3 for the shared methodology.

---

## §P3 — Plan item counts (Plumbing August 2026)

Standard export: **1,120 items** across 12 category sheets (CPVC/UPVC/SWR/AGRI
× Pipe/Fitting/Solvent). Per-category breakdown:

| Category | Items |
|----------|-------|
| CPVC Pipe | 40 |
| CPVC Fitting | 244 |
| CPVC Solvent | 9 |
| UPVC Pipe | 52 |
| UPVC Fitting | 242 |
| UPVC Solvent | 30 |
| SWR Pipe | 160 |
| SWR Fitting | 134 |
| SWR Solvent | 3 |
| AGRI Pipe | 123 |
| AGRI Fitting | 82 |
| AGRI Solvent | 1 |

AGRI explanatory note row sits **after** all item rows (blank separator first)
so downstream row-iterators do not count it as an item. The regression suite
(NC AGRI item-count guard) asserts exact counts per category.
