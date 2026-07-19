/**
 * Canonical golden values for the Plumbing production plan.
 *
 * Used by:
 *   - /api/plan/validate?segment=Plumbing  (server-side regression endpoint)
 *   - scripts/src/verify-plumbing-plan.ts  (CLI regression runner)
 *   - ValidationPanel in the Data page UI
 *
 * ────────────────────────────────────────────────────────────────────────────
 * HOW TO UPDATE when a new month becomes the reference:
 *   1. Update PLUMBING_GOLDEN_MONTH to the new YYYY-MM string.
 *   2. Recompute each category total from the new month's master Excel.
 *   3. Update PTMT_GOLDEN_MONTH and the PTMT targets in the same pass.
 *   4. Commit with a message like "Update golden values to YYYY-MM".
 *
 * ⚠ AGRI NOTE — intentional correction of source-sheet error:
 *   The master Excel's AGRI tab has its "STOCK AS ON" and "BUFFER STOCK REQ"
 *   columns SWAPPED relative to every other material tab.  The source sheet's
 *   own "Production Required" formula therefore reads the wrong Stock figure and
 *   produces incorrect plan numbers (9,688 Pipe / 14,814 Fitting for July 2026).
 *   This app corrects the swap by locating every column by header text, not
 *   position.  The correct values are listed below.
 *
 *   DO NOT change AGRI_PIPE / AGRI_FITTING back to the source-sheet figures —
 *   those are intentionally wrong.
 *
 * ⚠ BUFFER MULTIPLIER NOTE:
 *   Buffer multipliers for CPVC / UPVC / AGRI are AI-computed by the corrective
 *   engine and will drift over time.  The `tolerance` field in
 *   PLUMBING_BUFFER_DEFAULTS accounts for this drift.  SWR is locked at 1.0×
 *   by migration 011 (override, not AI-suggested) and is checked exactly.
 *
 *   Category totals use ±5% tolerance for the same reason: multiplier drift
 *   causes legitimate month-to-month variance of a few percent.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Reference month for the Plumbing golden values. */
export const PLUMBING_GOLDEN_MONTH = "2026-07";

/**
 * Production Required (pcs) per Plumbing category for PLUMBING_GOLDEN_MONTH.
 * Tolerance: ±5% (see PLUMBING_GOLDEN_TOLERANCE) — wider than 1% to account
 * for AI-buffer-multiplier drift between reference capture and test run.
 * Categories with expected = 0 are checked for exact equality (must be 0).
 *
 * Values last captured: 2026-07-19 with AI-computed buffer multipliers
 * (CPVC 1.28/1.23/1.30, UPVC 1.29/1.23/1.59, AGRI 1.39/1.27/1.60, SWR 1.0×).
 */
export const PLUMBING_GOLDEN: Array<{ cat: string; expected: number }> = [
  { cat: "CPVC Pipe",    expected: 116_734 },
  { cat: "CPVC Fitting", expected: 643_813 },
  { cat: "CPVC Solvent", expected:  11_201 },
  { cat: "UPVC Pipe",    expected:  45_214 },
  { cat: "UPVC Fitting", expected: 542_068 },
  { cat: "UPVC Solvent", expected:     497 },
  { cat: "SWR Pipe",     expected:  64_515 },
  { cat: "SWR Fitting",  expected: 211_873 },
  { cat: "SWR Solvent",  expected:   1_256 },
  // ⚠ AGRI correction — see file header; values intentionally differ from source sheet.
  { cat: "AGRI Pipe",    expected:  19_240 },
  { cat: "AGRI Fitting", expected:  47_613 },
  { cat: "AGRI Solvent", expected:       0 },
];

/** Fractional tolerance applied to all non-zero category totals (5 % = 0.05). */
export const PLUMBING_GOLDEN_TOLERANCE = 0.05;

/** Grand total across all 12 categories for PLUMBING_GOLDEN_MONTH. */
export const PLUMBING_GRAND_TOTAL = 1_704_024;

/** Canonical list of the 12 Plumbing category names (derived from PLUMBING_GOLDEN). */
export const PLUMBING_CATEGORIES = PLUMBING_GOLDEN.map((g) => g.cat);

/**
 * Expected buffer multipliers per category with per-entry tolerance.
 *
 * SWR is locked at 1.0× (migration 011 override) — tolerance=0, checked exactly.
 * CPVC / UPVC / AGRI are AI-computed (corrective engine) and drift over time;
 * tolerance=0.3 catches gross misconfigurations (e.g., accidentally reset to 0
 * or set to 5×) while surviving normal AI drift of ±0.2–0.3.
 *
 * Values last captured: 2026-07-19 from DB.
 */
export const PLUMBING_BUFFER_DEFAULTS: Array<{
  cat: string;
  expected: number;
  tolerance: number;
}> = [
  { cat: "CPVC Pipe",    expected: 1.28, tolerance: 0.3 },
  { cat: "CPVC Fitting", expected: 1.23, tolerance: 0.3 },
  { cat: "CPVC Solvent", expected: 1.30, tolerance: 0.3 },
  { cat: "UPVC Pipe",    expected: 1.29, tolerance: 0.3 },
  { cat: "UPVC Fitting", expected: 1.23, tolerance: 0.3 },
  { cat: "UPVC Solvent", expected: 1.59, tolerance: 0.3 },
  { cat: "SWR Pipe",     expected: 1.0,  tolerance: 0   }, // SWR locked at 1.0 — migration 011
  { cat: "SWR Fitting",  expected: 1.0,  tolerance: 0   }, // SWR locked at 1.0 — migration 011
  { cat: "SWR Solvent",  expected: 1.0,  tolerance: 0   }, // SWR locked at 1.0 — migration 011
  { cat: "AGRI Pipe",    expected: 1.39, tolerance: 0.3 },
  { cat: "AGRI Fitting", expected: 1.27, tolerance: 0.3 },
  { cat: "AGRI Solvent", expected: 1.60, tolerance: 0.3 },
];

/**
 * Solvent membership checks: each item code in mustInclude must appear in the
 * corresponding category in the plan.  Catches the item-type mapping bug where
 * Solvent items are mis-classified as Pipe or Fitting (or dropped entirely).
 *
 * normalizeCode semantics: String(code).trim().toUpperCase()
 */
export const SOLVENT_MEMBERSHIP: Array<{ cat: string; mustInclude: string[] }> = [
  {
    cat: "CPVC Solvent",
    mustInclude: ["S4", "S3", "S5", "S6", "S1", "S7", "SL01", "SL02", "S2"],
  },
  {
    cat: "SWR Solvent",
    mustInclude: ["RL02", "5158", "5142"],
  },
  {
    cat: "UPVC Solvent",
    mustInclude: ["U121", "S13"],
  },
  {
    cat: "AGRI Solvent",
    // EWS 45 should appear in this category even though its production total = 0
    // (the item is adequately stocked; the category exists; the TYPE mapping must be correct).
    mustInclude: ["EWS 45"],
  },
];

/** PTMT grand-total benchmarks.  Tolerance ±5% (expected monthly variance). */
export const PTMT_GOLDEN_MONTH   = "2026-07";
export const PTMT_GRAND_MAX      = 576_037;
export const PTMT_GRAND_MIN      = 301_918;
export const PTMT_TOLERANCE      = 0.05;
export const PTMT_CATEGORY_COUNT = 7;
