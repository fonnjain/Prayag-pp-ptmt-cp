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
 *   position.  The correct values are 20,299 Pipe and 54,590 Fitting.
 *
 *   DO NOT change AGRI_PIPE / AGRI_FITTING back to the source-sheet figures —
 *   those are intentionally wrong.
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Reference month for the Plumbing golden values. */
export const PLUMBING_GOLDEN_MONTH = "2026-07";

/**
 * Production Required (pcs) per Plumbing category for PLUMBING_GOLDEN_MONTH.
 * Tolerance: ±1% (see PLUMBING_GOLDEN_TOLERANCE).
 * Categories with expected = 0 are checked for exact equality (must be 0).
 */
export const PLUMBING_GOLDEN: Array<{ cat: string; expected: number }> = [
  { cat: "CPVC Pipe",    expected: 130_451 },
  { cat: "CPVC Fitting", expected: 763_253 },
  { cat: "CPVC Solvent", expected:  16_539 },
  { cat: "UPVC Pipe",    expected:  51_899 },
  { cat: "UPVC Fitting", expected: 633_038 },
  { cat: "UPVC Solvent", expected:     542 },
  { cat: "SWR Pipe",     expected:  64_515 },
  { cat: "SWR Fitting",  expected: 236_315 },
  { cat: "SWR Solvent",  expected:   1_255 },
  // ⚠ AGRI correction — see file header; values intentionally differ from source sheet.
  { cat: "AGRI Pipe",    expected:  20_299 },
  { cat: "AGRI Fitting", expected:  54_590 },
  { cat: "AGRI Solvent", expected:       0 },
];

/** Fractional tolerance applied to all non-zero category totals (1 % = 0.01). */
export const PLUMBING_GOLDEN_TOLERANCE = 0.01;

/** Grand total across all 12 categories for PLUMBING_GOLDEN_MONTH. */
export const PLUMBING_GRAND_TOTAL = 1_922_309;

/** Canonical list of the 12 Plumbing category names (derived from PLUMBING_GOLDEN). */
export const PLUMBING_CATEGORIES = PLUMBING_GOLDEN.map((g) => g.cat);

/**
 * Expected buffer multipliers (applied value from buffer_categories DB) per category.
 * SWR is deliberately 1.0× — not 1.5× — per migration 011.
 */
export const PLUMBING_BUFFER_DEFAULTS: Array<{ cat: string; expected: number }> = [
  { cat: "CPVC Pipe",    expected: 1.5 },
  { cat: "CPVC Fitting", expected: 1.5 },
  { cat: "CPVC Solvent", expected: 1.5 },
  { cat: "UPVC Pipe",    expected: 1.5 },
  { cat: "UPVC Fitting", expected: 1.5 },
  { cat: "UPVC Solvent", expected: 1.5 },
  { cat: "SWR Pipe",     expected: 1.0 }, // SWR deliberately 1.0
  { cat: "SWR Fitting",  expected: 1.0 }, // SWR deliberately 1.0
  { cat: "SWR Solvent",  expected: 1.0 }, // SWR deliberately 1.0
  { cat: "AGRI Pipe",    expected: 1.5 },
  { cat: "AGRI Fitting", expected: 1.5 },
  { cat: "AGRI Solvent", expected: 1.5 },
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
