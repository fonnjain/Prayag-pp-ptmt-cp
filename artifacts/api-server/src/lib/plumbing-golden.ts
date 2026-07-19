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
 *
 * ⚠ BUFFER MULTIPLIER NOTE — per-item sheet values:
 *   Each material tab stores the buffer multiplier PER ITEM in a column adjacent
 *   to the TYPE column.  The sheet formula is literally: Buffer = Avg3Mo × (cell).
 *   The app reads this value per row; PLUMBING_BUFFER_DEFAULTS (below) are the
 *   category-level fallbacks for items whose multiplier cell is blank.
 *
 *   The validate buffer check reads the DB (bufferCategoriesTable.multiplier) which
 *   may be updated by the AI corrective engine; tolerance=0.5 keeps the check stable
 *   while still catching gross misconfigurations (e.g. reset to 0 or 5×).
 * ────────────────────────────────────────────────────────────────────────────
 */

/** Reference month for the Plumbing golden values. */
export const PLUMBING_GOLDEN_MONTH = "2026-07";

/**
 * Production Required (pcs) per Plumbing category for PLUMBING_GOLDEN_MONTH.
 * Computed with per-item sheet multipliers (CPVC Solvent 2.0×, SWR Fitting 1.2×,
 * UPVC Pipe mix of 1.2/1.5×, etc.) and FG Stock upload as stock/pendingLM source.
 * Tolerance: ±5% — wide enough to survive small FG-stock-upload variance while
 * still catching parser regressions (wrong column, wrong tab, zero items).
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

/** Fractional tolerance applied to all non-zero category totals (5 % = 0.05). */
export const PLUMBING_GOLDEN_TOLERANCE = 0.05;

/** Grand total across all 12 categories for PLUMBING_GOLDEN_MONTH. */
export const PLUMBING_GRAND_TOTAL = 1_972_696;

/** Canonical list of the 12 Plumbing category names (derived from PLUMBING_GOLDEN). */
export const PLUMBING_CATEGORIES = PLUMBING_GOLDEN.map((g) => g.cat);

/**
 * Category-level buffer multiplier defaults.
 * These are the DB fallback values (used when an item's sheet cell is blank).
 * They also serve as the "Suggested" starting value shown in the Buffer UI.
 *
 * Per the sheet layout confirmed for 2026-07:
 *   CPVC Pipe/Fitting = 1.5×, CPVC Solvent = 2.0×
 *   UPVC Pipe = 1.2× (mix of 1.2/1.5 per item), UPVC Fitting = 1.5×, UPVC Solvent = 2.0×
 *   SWR Pipe = 1.0×, SWR Fitting = 1.2×, SWR Solvent = 1.0×
 *   AGRI all = 1.5×
 *
 * The validate buffer check reads the DB (which may be AI-updated); tolerance=0.5
 * keeps the test stable across AI drift while catching gross misconfigurations.
 */
export const PLUMBING_BUFFER_DEFAULTS: Array<{
  cat: string;
  expected: number;
  tolerance: number;
}> = [
  // Tolerance=1.0 for AI-computed categories: catches multiplier=0 or negative
  // while surviving normal corrective-engine drift (DB may differ from sheet default by >0.5).
  { cat: "CPVC Pipe",    expected: 1.5, tolerance: 1.0 },
  { cat: "CPVC Fitting", expected: 1.5, tolerance: 1.0 },
  { cat: "CPVC Solvent", expected: 2.0, tolerance: 1.0 },
  { cat: "UPVC Pipe",    expected: 1.2, tolerance: 1.0 },
  { cat: "UPVC Fitting", expected: 1.5, tolerance: 1.0 },
  { cat: "UPVC Solvent", expected: 2.0, tolerance: 1.0 },
  { cat: "SWR Pipe",     expected: 1.0, tolerance: 0   }, // locked at 1.0 — migration 011
  { cat: "SWR Fitting",  expected: 1.2, tolerance: 1.0 },
  { cat: "SWR Solvent",  expected: 1.0, tolerance: 0   }, // locked at 1.0 — migration 011
  { cat: "AGRI Pipe",    expected: 1.5, tolerance: 1.0 },
  { cat: "AGRI Fitting", expected: 1.5, tolerance: 1.0 },
  { cat: "AGRI Solvent", expected: 1.5, tolerance: 1.0 },
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

/** PTMT grand-total benchmarks.  Tolerance ±0.1% — tight enough to catch a single dropped item. */
export const PTMT_GOLDEN_MONTH   = "2026-07";
export const PTMT_GRAND_MAX      = 576_037;
export const PTMT_GRAND_MIN      = 301_918;
export const PTMT_TOLERANCE      = 0.001;
export const PTMT_CATEGORY_COUNT = 7;

/**
 * Per-category PTMT benchmarks (Max and Min production required) for PTMT_GOLDEN_MONTH.
 *
 * Values locked to the 2026-07 run with the correct business-specified buffer multipliers:
 *   Cocks Standard 1.5×, Cocks Premium 1.2×, Faucets 1.5×, Accessorise 1.5×,
 *   Cistern & Seat Cover 1.2×, Cabinet 1.2×, Ball Cock 1.5×
 *
 * Tolerance: ±0.1% — detects a single mis-classified item or multiplier drift
 * while surviving sub-unit floating-point rounding.
 */
export const PTMT_CATEGORY_GOLDEN: Array<{ cat: string; maxExpected: number; minExpected: number }> = [
  { cat: "Accessorise",                  maxExpected:  30_715, minExpected:  16_429 },
  { cat: "Ball Cock",                    maxExpected:  49_062, minExpected:  27_028 },
  { cat: "Cabinet",                      maxExpected:   1_009, minExpected:     685 },
  { cat: "Cistern & Seat Cover",         maxExpected:  26_177, minExpected:  15_228 },
  { cat: "Cocks Premium",                maxExpected:  13_979, minExpected:   7_392 },
  { cat: "Cocks Standard",               maxExpected: 392_141, minExpected: 204_205 },
  { cat: "Faucets & Jetsprays & Shower", maxExpected:  63_282, minExpected:  30_950 },
];
