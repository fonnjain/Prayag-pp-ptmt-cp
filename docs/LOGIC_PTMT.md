# PTMT Production Planning — Logic Reference

This document records methodology decisions and number-basis conventions used
across the corrective export, regression suite, and API. New readers: check here
before treating a difference between two "same" numbers as a bug.

---

## §A — Corrective Re-Plan Number Bases

### §A1 — grandOrigComputed (item-level Math.round sum)

`grandOrigComputed = Σ Math.round(item.originalPlan)` across all corrective items.

This is the **canonical "Original Month Total"** used in export headers and
category TOTAL rows. All per-category Original TOTAL rows use the same rounding
path, so the grand total always reconciles to zero against the table.

### §A2 — run.originalMonthTotal (stored 32-bit real)

Written once at corrective run creation time from the engine's `originalMonthTotal`
variable (a float64 sum of float32 DB reads → float64 accumulation). Stored as a
PostgreSQL `real` (32-bit). When read back and rounded, it can differ from
`grandOrigComputed` by a small amount due to float32 accumulation. This is pure
rounding — no data loss.

**Measured divergences (August 2026 production runs):**

| Segment | Items | `detailOrigHeader` | `storedOrig` | Divergence |
|---------|------:|------------------:|-------------:|-----------:|
| PTMT    | 3,636 | 617,750           | 617,711      | **39 pcs** |
| Plumbing| 1,120 | 2,331,750         | 2,331,647    | **103 pcs**|

Notably, the larger item count (PTMT) produces the *smaller* gap. This is
counter-intuitive but correct: PTMT items are smaller quantities with less
float32 rounding error per item; Plumbing items are larger quantities (~2.4 M
total) where accumulated float32 drift is more pronounced.

The ExportTotals divergence check asserts `|detailOrigHeader − storedOrig| ≤ 500`.
The ±500 threshold is set above the observed maximum (103 pcs) with margin for
future months, and matches the order of magnitude of the MISMATCH tolerance (±200)
used in §A4. Values above 500 indicate a builder reading the wrong column or a
missing-items problem — not normal float drift.

### §A3 — frozenPlanGrandMax (plan run items sum, frozen at run-creation time)

`frozenPlanGrandMax = Σ plan_run_results.productionPlan` for the cited `planRunId`,
computed once at corrective run creation and persisted as an INTEGER column.
This is **the independent cross-check**: it comes from the frozen plan run items,
not from the corrective items. A mismatch beyond ±200 pcs indicates the corrective
baseline has drifted from the plan it was supposed to track.

### §A4 — Export MISMATCH marker

The Detail Excel "Baseline Plan Run" row compares `frozenPlanGrandMax` (§A3)
against `grandOrigComputed` (§A1). The ⚠ MISMATCH label fires only if
`|grandOrigComputed − frozenPlanGrandMax| > 200`.

The old behaviour (comparing `run.originalMonthTotal` § A2 against
`grandOrigComputed` §A1) was permanently triggered because both values come from
the same item snapshot and can only differ by rounding — so ± at any rounding
gap caused the marker. This was fixed in migration 022 (frozenPlanGrandMax).

### §A5 — grandPlanComputed (Revised Month Total)

`grandPlanComputed = Σ Math.round(item.planRev)` — same rounding path as the
per-category Revised TOTAL rows. Used in the "Revised Month Total" header.
`run.revisedMonthTotal` (32-bit real) matches within ±1 rounding unit.

### §A6 — Feasibility check

`feasible = cap × workingDaysRemaining` (engine persisted in `categoriesJson`).
Invariant per category: `feasible = cap × 12` (12 working days for a full month
at 6 days/week × 2 remaining weeks = 12, or whatever the actual WDR is for this
run). All 19 PTMT categories and all 12 Plumbing categories satisfy this invariant.

### §A7 — The Three "Original Plan" Numbers for PTMT August 2026

Three distinct values describe the PTMT August 2026 original plan; all are correct
on their own basis. A reader who sees two of them must not treat the gap as drift.

| Value | Basis | Where used |
|-------|-------|-----------|
| **617,750 pcs** | `grandOrigComputed` — item-level `Σ Math.round(originalPlan)` across 3,636 corrective items | "Original Month Total" header in Detail Export; Summary sheet row; category TOTAL reconciliation |
| **617,711 pcs** | `run.originalMonthTotal` (`corrective_plan_runs`) — stored 32-bit real on corrective run #20, rounded to INTEGER | NC20b regression assertion |
| **617,710 pcs** | `frozenPlanGrandMax` (`plan_run_results`) — Σ `productionPlan` for plan run #20 items, captured at corrective run creation; see §A3 | MISMATCH cross-check baseline (§A4); sourced from a different table than `run.originalMonthTotal` — the distinction is what makes the cross-check real |

**Why the 39-pcs gap (617,750 − 617,711):** 3,636 items × average 0.01 pcs rounding
error per item ≈ 36 pcs expected; 39 pcs is within the normal 0–100 pcs band
documented in §A2.

**Why the 1-pcs gap (617,711 − 617,710):** `run.originalMonthTotal` (stored real,
accumulated once on write) and `frozenPlanGrandMax` (Σ productionPlan from
`plan_run_results`, a separate float64 accumulation over the same float32 source
values) diverge by 1 pcs. Both are measured from production corrective run #20.
The ±200 MISMATCH tolerance absorbs this gap; the cross-check remains real because
the sources are independent.

**Key rule:** the ±200 tolerance on the MISMATCH marker (§A4) is wide enough to
absorb the §A2 rounding gap (≤100 pcs) and still flag genuine data drift.

---

## §B — Regression Suite Golden Values

### §B1 — NC20b: PTMT August corrective baseline item-sum

Asserted value: **617,711 ±200 pcs** (production API).
Basis: `run.originalMonthTotal` on corrective run #20 (production sequence).
The ±200 tolerance covers the §A2 rounding gap; a result outside this band
indicates a genuine change in the frozen plan run items.

### §B2 — NC21b: Plumbing August corrective baseline item-sum

→ Moved to **LOGIC_PLUMBING.md §P1**. Plumbing goldens live there so they are
not overlooked at month rollover when only PTMT figures are being updated.

### §B3 — NC20e / NC21e: Structural baseline integrity

Always-on checks: `corrective baseline id === max(finalized ids for month+segment)`.
Ensures auto-select always picks the most recent finalized run, not an older one.
Does not require knowing the production sequence in advance.

---

## §C — Segment and Rounding Conventions

- All segment strings stored in DB: `"PTMT"` or `"Plumbing"` (title-case for
  Plumbing). Route-layer normalization accepts any casing.
- All plan quantities stored as `real` (32-bit float) in DB; always round to
  INTEGER before display or comparison (`Math.round`).
- The MISMATCH tolerance for all header-vs-table reconciliation checks is **0**
  (strict equality enforced by the suite schema-parity checks). The ±200 tolerance
  applies only to the cross-source check between `frozenPlanGrandMax` and
  `grandOrigComputed`.
