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
 * ⚠ AGRI NOTE — intentional divergence from the source sheet:
 *   The AGRI tab's own cell formula transposes the "STOCK AS ON" and "BUFFER STOCK REQ"
 *   columns relative to every other material tab, so the source sheet's AGRI Pipe /
 *   AGRI Fitting figures (≈9,688 / ≈14,814) are wrong from a planning standpoint.
 *   This app locates every column by its header text ("STOCK AS ON <date>",
 *   "BUFFER STOCK REQ FOR <month>") and applies the ONE standard formula to all materials:
 *     Production Required = max( (Buffer − Stock) + PendingLM + Pending , 0 )
 *   The correct planning values are 20,299 Pipe and 54,590 Fitting.
 *
 *   DO NOT change these back to the source-sheet figures (9,688 / 14,814) —
 *   those result from reading swapped columns and are incorrect for planning purposes.
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
  // Snapshot: 2026-08-25. Re-derived from the complete 1,120-item live run after
  // current pending balances were included from Bal. Qty (85,825 pieces total).
  { cat: "CPVC Pipe",    expected: 136_097 },
  { cat: "CPVC Fitting", expected: 792_272 },
  { cat: "CPVC Solvent", expected:  17_258 },
  { cat: "UPVC Pipe",    expected:  53_077 },
  { cat: "UPVC Fitting", expected: 637_901 },
  { cat: "UPVC Solvent", expected:     525 },
  { cat: "SWR Pipe",     expected:  66_343 },
  { cat: "SWR Fitting",  expected: 245_026 },
  { cat: "SWR Solvent",  expected:   1_380 },
  // ⚠ AGRI: header-name mapping + standard formula — intentionally differs from source sheet.
  { cat: "AGRI Pipe",    expected:  20_537 },
  { cat: "AGRI Fitting", expected:  56_446 },
  { cat: "AGRI Solvent", expected:       0 },
];

/** Fractional tolerance applied to all non-zero category totals (0.1 % = 0.001). */
export const PLUMBING_GOLDEN_TOLERANCE = 0.001;

/** Grand total across all 12 categories for PLUMBING_GOLDEN_MONTH. */
export const PLUMBING_GRAND_TOTAL = 2_026_860; // re-derived 2026-08-25 (live Bal. Qty pending included)

/**
 * Point-in-time reconciliation from the July 2026 live-pending cutover:
 * 148,721 matched pending pieces produced 143,897 pieces of plan movement;
 * the remaining 4,824 pieces were absorbed by the per-item max(..., 0)
 * clamp. These are diagnostic targets, not replacement plan goldens.
 */
export const PLUMBING_PENDING_PLAN_MOVEMENT = 143_897;
export const PLUMBING_PENDING_PLAN_CLAMP_LOSS = 4_824;

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

/**
 * Per-category PTMT business multipliers.
 * These are the LOCKED business values — exactly what overrideMultiplier must equal in the DB.
 * If a recompute ever lets Suggested leak into Applied, the validate endpoint will fail immediately.
 */
export const PTMT_MULTIPLIER_GOLDEN: Array<{ cat: string; multiplier: number }> = [
  { cat: "Cocks Standard",               multiplier: 1.5 },
  { cat: "Cocks Premium",                multiplier: 1.2 },
  { cat: "Faucets & Jetsprays & Shower", multiplier: 1.5 },
  { cat: "Accessorise",                  multiplier: 1.5 },
  { cat: "Cistern & Seat Cover",         multiplier: 1.2 },
  { cat: "Cabinet",                      multiplier: 1.2 },
  { cat: "Ball Cock",                    multiplier: 1.5 },
  { cat: "P.V.C. Connections",           multiplier: 1.5 },
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

/**
 * ── PTMT August 2026 golden set ─────────────────────────────────────────────
 * Snapshot: 2026-08-05, computed from the August uploads:
 *   current_stock       = "F.G Stock on 1st Aug 2026.xlsx"  (worksheet "F.G Sheet PTMT",
 *                          cols A=Item Code, B=Colour, C=Closing Stock — plain value,
 *                          no Plumbing-style positive/negative sign split)
 *   last_month_pending  = "LAST MONth PENDING ORDERS JULY 2026.xlsx" (qty column "Qty.")
 *   pending_current     = live Pending order / report sheet (Bal. Qty)
 *
 * Business verification targets for 2026-08 (per the correction spec):
 *   Cocks Standard 210,513/392,794 · Cocks Premium 10,369/16,120 ·
 *   Faucets 36,020/66,974 · Accessorise 20,011/37,506 · Cistern 22,388/38,522 ·
 *   Cabinet 931/2,261 · Ball Cock 34,918/63,833 · TOTAL 335,150/618,010.
 * Engine actuals below differ from those targets by ≤2.8% per category (−0.05% total);
 * the residual is item-roster coverage (source items like DB-02L/PH-01/PH-02 absent from
 * item_master, and 304 plan codes absent from the FG upload) — reported by the
 * item-coverage guard, never silently dropped or invented.
 */
export const PTMT_AUG_MONTH      = "2026-08";
export const PTMT_AUG_GRAND_MAX  = 623_207;
export const PTMT_AUG_GRAND_MIN  = 335_145;
export const PTMT_AUG_STOCK_121O_WHITE = 6_644;
export const PTMT_AUG_LM_TOTAL         = 168_695;
export const PTMT_AUG_PENDING_TOTAL    = 7_993; // live Pending order / report Bal. Qty, verified 2026-08-25
export const PLUMBING_AUG_PENDING_TOTAL = 85_825; // live Pending order / report Bal. Qty, verified 2026-08-25
// Re-verified 2026-08-21 against the live Sale 26-27 "May,Jun,July'26"
// rolling tab: 16,114 total / 3 = 5,371 monthly average.
export const PTMT_AUG_AVG3MO_144O_WHITE = 5_371;

export const PTMT_AUG_CATEGORY_GOLDEN: Array<{ cat: string; maxExpected: number; minExpected: number }> = [
  { cat: "Accessorise",                  maxExpected:  38_578, minExpected:  20_007 },
  { cat: "Ball Cock",                    maxExpected:  64_961, minExpected:  34_918 },
  { cat: "Cabinet",                      maxExpected:   2_258, minExpected:     931 },
  { cat: "Cistern & Seat Cover",         maxExpected:  37_861, minExpected:  22_387 },
  { cat: "Cocks Premium",                maxExpected:  15_947, minExpected:  10_365 },
  { cat: "Cocks Standard",               maxExpected: 396_255, minExpected: 210_433 },
  { cat: "Faucets & Jetsprays & Shower", maxExpected:  67_355, minExpected:  36_012 },
];

// ── Plumbing KG golden values ───────────────────────────────────────────────

/** Fractional tolerance for KG assertions (±1%). */
export const PLUMBING_KG_TOLERANCE = 0.01;

/**
 * KG per Plumbing category for PLUMBING_GOLDEN_MONTH.
 * Computed as pieces × BOM weight-per-piece (BOM sheet 1R7k5O6w4qaT74G-5X2VXBtD7-Fg3uByvIw3-TeViMmA).
 * The daily-production workbook's own kg column is broken (~113 kg for 130,451 CPVC pipes — a
 * ~1000× error); the BOM sheet is the only authoritative weight source.
 * Categories with expected = 0: all items in those categories currently have no BOM weight entry.
 */
export const PLUMBING_KG_GOLDEN: Array<{ cat: string; expectedKg: number }> = [
  // Snapshot: 2026-08-25, re-derived with the same live pending-inclusive plan
  // used by PLUMBING_GOLDEN above and the BOM weight source described above.
  { cat: "CPVC Pipe",    expectedKg: 113_930 },
  { cat: "CPVC Fitting", expectedKg:  27_994 },
  { cat: "CPVC Solvent", expectedKg:       0 },
  { cat: "UPVC Pipe",    expectedKg: 104_906 },
  { cat: "UPVC Fitting", expectedKg:  42_208 },
  { cat: "UPVC Solvent", expectedKg:      27 },
  { cat: "SWR Pipe",     expectedKg:  17_021 },
  { cat: "SWR Fitting",  expectedKg:  62_278 },
  { cat: "SWR Solvent",  expectedKg:     291 },
  { cat: "AGRI Pipe",    expectedKg:  85_991 },
  { cat: "AGRI Fitting", expectedKg:   4_339 },
  { cat: "AGRI Solvent", expectedKg:       0 },
];

/** KG grand total across all 12 Plumbing categories for PLUMBING_GOLDEN_MONTH. */
export const PLUMBING_KG_GRAND_TOTAL = 458_986; // re-derived 2026-08-25 (live Bal. Qty pending included)

// ── Plumbing weekly release golden values ──────────────────────────────────

/** Fractional tolerance for weekly release assertions (±1%). */
export const PLUMBING_WEEKLY_TOLERANCE = 0.01;

/**
 * Plant-level weekly release totals for PLUMBING_GOLDEN_MONTH (sum across all 12 categories).
 * Snapshot: 2026-08-25 after pending-driven OS/high-cover demand was explicitly
 * assigned to W1; the run has no positive plan item without a weekly allocation.
 */
export const PLUMBING_WEEKLY_PLANT = { w1: 1_907_537, w2: 12_260, w3: 81_775, w4: 25_288 };

/**
 * Per-category weekly release totals (W1 / W2 / W3 / W4 pieces).
 * Each item's full maxProduction lands in exactly one week.
 * W1 + W2 + W3 + W4 must equal that category's Production Required total.
 */
export const PLUMBING_WEEKLY_GOLDEN: Array<{
  cat: string;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
}> = [
  // Snapshot: 2026-08-25, including the 569.8 pieces that previously had no
  // week because they were OS or outside the final cover band.
  { cat: "CPVC Pipe",    w1: 134_974, w2:     0, w3:     286, w4:    837 },
  { cat: "CPVC Fitting", w1: 719_985, w2: 2_118, w3:  57_476, w4: 12_694 },
  { cat: "CPVC Solvent", w1:  17_258, w2:     0, w3:       0, w4:      0 },
  { cat: "UPVC Pipe",    w1:  49_499, w2: 1_058, w3:     190, w4:  2_329 },
  { cat: "UPVC Fitting", w1: 604_881, w2: 3_307, w3:  21_479, w4:  8_234 },
  { cat: "UPVC Solvent", w1:     525, w2:     0, w3:       0, w4:      0 },
  { cat: "SWR Pipe",     w1:  66_163, w2:    86, w3:      94, w4:      0 },
  { cat: "SWR Fitting",  w1: 241_465, w2: 2_655, w3:     421, w4:    485 },
  { cat: "SWR Solvent",  w1:   1_380, w2:     0, w3:       0, w4:      0 },
  { cat: "AGRI Pipe",    w1:  19_859, w2:   649, w3:       0, w4:     30 },
  { cat: "AGRI Fitting", w1:  51_549, w2: 2_388, w3:   1_829, w4:    681 },
  { cat: "AGRI Solvent", w1:       0, w2:     0, w3:       0, w4:      0 },
];

// ── Plumbing corrective re-plan golden values (14-Jul-2026 snapshot) ─────────

/**
 * Working days remaining in July 2026 as of the golden snapshot date (14-Jul-2026).
 * Pass as workingDaysRemaining= to /api/plan/corrective-replan and /api/plan/validate-replan.
 */
export const PLUMBING_REPLAN_WORKING_DAYS_REMAINING = 15;

/**
 * Per-category corrective re-plan golden values.
 * Snapshot: 23-Jul-2026 (workingDaysRemaining=15 passed to endpoint).
 * Production source: Sheet3 of the Plumbing master workbook
 *   (Date / Code / Prod.Qty, fed automatically by Report-11 Pipe + Report-12 Fittings).
 *
 * capPerDay = p90 of that category's demonstrated daily output in Sheet3
 *             (only days with recorded production; formula: arr[floor(n × 0.9)]).
 * feasible  = capPerDay × 15
 * shortfall = max(remaining − feasible, 0)
 *
 * CRITICAL: AGRI Fitting produced requires normalizeCodeStrict (strip hyphens/
 *   spaces/dots). Production logs "A465"; plan master stores "A-465". Without strict
 *   normalization, AGRI Fitting showed 0 produced.
 *
 * Unplanned production (codes absent from plan master) now at ~135,378 pcs.
 *   (was 197,439 on 19-Jul because W3 data was partially loaded; today only W1+W2 in Sheet3).
 *
 * NOTE: These values are point-in-time and will drift as production continues.
 *   The `produced` and `remaining` columns reflect W1+W2 Sheet3 data only (W3 not yet
 *   loaded as of this snapshot). Update this table when W3/W4 are fully recorded or
 *   when rolling over to a new month. The structural-invariant checks (ReplanInv ·)
 *   are always valid regardless of date.
 *
 * AGRI Fitting capPerDay: 2,600 (seeded from capacity_categories; was 5,950 in earlier snapshot).
 */
export const PLUMBING_REPLAN_GOLDEN: Array<{
  cat: string;
  plan: number;
  produced: number;
  remaining: number;
  capPerDay: number;
  feasible: number;
  shortfall: number;
}> = [
  { cat: "CPVC Pipe",    plan: 130_453, produced:  26_980, remaining: 103_473, capPerDay:  4_960, feasible:  74_400, shortfall:  29_073 },
  { cat: "CPVC Fitting", plan: 782_332, produced: 314_539, remaining: 467_793, capPerDay: 34_338, feasible: 515_070, shortfall:       0 },
  { cat: "CPVC Solvent", plan:  16_538, produced:       0, remaining:  16_538, capPerDay:      0, feasible:       0, shortfall:  16_538 },
  { cat: "UPVC Pipe",    plan:  59_674, produced:  21_490, remaining:  38_184, capPerDay:  9_875, feasible: 148_125, shortfall:       0 },
  { cat: "UPVC Fitting", plan: 639_005, produced: 176_184, remaining: 462_821, capPerDay: 20_126, feasible: 301_890, shortfall: 160_931 },
  { cat: "UPVC Solvent", plan:     525, produced:       0, remaining:     525, capPerDay:      0, feasible:       0, shortfall:     525 },
  { cat: "SWR Pipe",     plan:  64_515, produced:  11_456, remaining:  53_816, capPerDay:  2_405, feasible:  36_075, shortfall:  17_741 },
  { cat: "SWR Fitting",  plan: 249_167, produced:  99_963, remaining: 149_204, capPerDay: 11_510, feasible: 172_650, shortfall:       0 },
  { cat: "SWR Solvent",  plan:   1_256, produced:     300, remaining:     956, capPerDay:    300, feasible:   4_500, shortfall:       0 },
  { cat: "AGRI Pipe",    plan:  20_296, produced:   2_925, remaining:  18_099, capPerDay:    790, feasible:  11_850, shortfall:   6_249 },
  { cat: "AGRI Fitting", plan:  54_356, produced:  19_787, remaining:  34_800, capPerDay:  2_600, feasible:  39_000, shortfall:       0 },
  { cat: "AGRI Solvent", plan:       0, produced:       0, remaining:       0, capPerDay:      0, feasible:       0, shortfall:       0 },
];

/** ±1% tolerance for produced / remaining / shortfall assertions. */
export const PLUMBING_REPLAN_TOLERANCE     = 0.01;
/** ±1% tolerance for capPerDay / feasible (tightened from 5% — daily p90 is now stable enough). */
export const PLUMBING_REPLAN_CAP_TOLERANCE = 0.01;

/** Grand total produced across all 12 categories (23-Jul-2026 snapshot, W1+W2 only). */
export const PLUMBING_REPLAN_TOTAL_PRODUCED  =   673_624;
/** Grand total remaining to produce across all 12 categories. */
export const PLUMBING_REPLAN_TOTAL_REMAINING = 1_346_225;
/** Grand total feasible (sum of capPerDay × 15 per category). */
export const PLUMBING_REPLAN_TOTAL_FEASIBLE  = 1_303_560;
/** Grand total shortfall (sum of max(remaining − feasible, 0) per category). */
export const PLUMBING_REPLAN_TOTAL_SHORTFALL =   231_073;
/** Total production on codes not found in the plan master (unplanned). */
export const PLUMBING_REPLAN_UNPLANNED_TOTAL =   135_378;

// ── Plumbing Monitoring golden values (Sheet3 actuals) ────────────────────────
//
// W1 (Jul 1–7) and W2 (Jul 8–14) are both fully elapsed as of 19-Jul-2026.
// These totals are FROZEN — they won't change unless the workbook is edited.
// W3/W4 data is live and excluded from these assertions.
//
// Accounting identity:
//   Plant W1 total = W1 mapped (361,231) + W1 unmapped (59,805) = 421,036
//   Plant W2 total = W2 mapped (312,393) + W2 unmapped (75,573) = 387,966
//   W1+W2 grand total = 809,002 pcs over 12 working days
//
// Per-category W1 sums to exactly 361,231 (the W1 mapped plant total).
// Per-category W2 sums to exactly 312,393 (the W2 mapped plant total).

/** W1 plant mapped actual — sum of per-category W1 (Sheet3, 14-Jul-2026 frozen). */
export const PLUMBING_MON_W1_MAPPED   = 361_231;
/** W2 plant mapped actual — sum of per-category W2 (Sheet3, 28-Jul-2026 frozen). */
export const PLUMBING_MON_W2_MAPPED   = 372_521;
/** W1 production on codes absent from the plan master. */
export const PLUMBING_MON_W1_UNMAPPED =  59_805;
/** W2 production on codes absent from the plan master. */
export const PLUMBING_MON_W2_UNMAPPED =  75_573;

/**
 * Per-category W1 actuals from Sheet3 (mapped only; frozen as of 14-Jul-2026).
 * Sum = 361,231 = PLUMBING_MON_W1_MAPPED.
 */
export const PLUMBING_MON_CAT_W1: Record<string, number> = {
  "CPVC Pipe":      23_140,
  "CPVC Fitting":  184_503,
  "CPVC Solvent":        0,
  "UPVC Pipe":      11_615,
  "UPVC Fitting":   84_240,
  "UPVC Solvent":        0,
  "SWR Pipe":        9_370,
  "SWR Fitting":    40_606,
  "SWR Solvent":         0,
  "AGRI Pipe":       2_570,
  "AGRI Fitting":    5_187,
  "AGRI Solvent":        0,
};

/**
 * Per-category W2 actuals from Sheet3 (mapped only; frozen as of 14-Jul-2026).
 * Sum = 312,393 = PLUMBING_MON_W2_MAPPED.
 */
// W2 values updated 28-Jul-2026 — more production data was loaded to Sheet3 after the
// 14-Jul-2026 snapshot (pipe-category W2 production was still being recorded then).
export const PLUMBING_MON_CAT_W2: Record<string, number> = {
  "CPVC Pipe":      32_072,
  "CPVC Fitting":  130_036,
  "CPVC Solvent":        0,
  "UPVC Pipe":      29_158,
  "UPVC Fitting":   91_944,
  "UPVC Solvent":        0,
  "SWR Pipe":       10_143,
  "SWR Fitting":    59_357,
  "SWR Solvent":       300,
  "AGRI Pipe":       4_911,
  "AGRI Fitting":   14_600,
  "AGRI Solvent":        0,
};

/** ±1% tolerance for monitoring W1/W2 mapped actuals. */
export const PLUMBING_MON_TOLERANCE = 0.01;

export type GoldenIntegrityFamily =
  | "plumbing.pieces"
  | "plumbing.kg"
  | "plumbing.weekly"
  | "plumbing.replan"
  | "plumbing.monitoring"
  | "ptmt.july.max"
  | "ptmt.july.min"
  | "ptmt.august.max"
  | "ptmt.august.min";

export type GoldenIntegrityCheck = {
  id: string;
  family: GoldenIntegrityFamily;
  name: string;
  expected: number;
  actual: number;
  delta: number;
  pass: boolean;
};

const goldenSum = <T>(rows: T[], value: (row: T) => number): number =>
  rows.reduce((sum, row) => sum + value(row), 0);

/**
 * Validate the frozen baselines before using them as regression expectations.
 *
 * A failing check here describes a defect in the expectation set itself. The
 * corresponding live-data checks must be reported separately because no input
 * set can satisfy an internally inconsistent golden.
 */
export function getGoldenIntegrityChecks(): GoldenIntegrityCheck[] {
  const checks: GoldenIntegrityCheck[] = [];
  const add = (
    id: string,
    family: GoldenIntegrityFamily,
    name: string,
    expected: number,
    actual: number,
  ) => checks.push({
    id,
    family,
    name,
    expected,
    actual,
    delta: actual - expected,
    pass: actual === expected,
  });

  add(
    "plumbing-pieces-total",
    "plumbing.pieces",
    "Plumbing category pieces sum = grand total",
    PLUMBING_GRAND_TOTAL,
    goldenSum(PLUMBING_GOLDEN, (row) => row.expected),
  );
  add(
    "plumbing-kg-total",
    "plumbing.kg",
    "Plumbing category KG sum = grand total",
    PLUMBING_KG_GRAND_TOTAL,
    goldenSum(PLUMBING_KG_GOLDEN, (row) => row.expectedKg),
  );
  add(
    "ptmt-july-max-total",
    "ptmt.july.max",
    "PTMT July category Max sum = grand total",
    PTMT_GRAND_MAX,
    goldenSum(PTMT_CATEGORY_GOLDEN, (row) => row.maxExpected),
  );
  add(
    "ptmt-july-min-total",
    "ptmt.july.min",
    "PTMT July category Min sum = grand total",
    PTMT_GRAND_MIN,
    goldenSum(PTMT_CATEGORY_GOLDEN, (row) => row.minExpected),
  );
  add(
    "ptmt-august-max-total",
    "ptmt.august.max",
    "PTMT August category Max sum = grand total",
    PTMT_AUG_GRAND_MAX,
    goldenSum(PTMT_AUG_CATEGORY_GOLDEN, (row) => row.maxExpected),
  );
  add(
    "ptmt-august-min-total",
    "ptmt.august.min",
    "PTMT August category Min sum = grand total",
    PTMT_AUG_GRAND_MIN,
    goldenSum(PTMT_AUG_CATEGORY_GOLDEN, (row) => row.minExpected),
  );

  for (const row of PLUMBING_WEEKLY_GOLDEN) {
    const pieces = PLUMBING_GOLDEN.find((golden) => golden.cat === row.cat)?.expected ?? 0;
    add(
      `plumbing-weekly-category-${row.cat}`,
      "plumbing.weekly",
      `Plumbing weekly ${row.cat} W1–W4 sum = category pieces`,
      pieces,
      row.w1 + row.w2 + row.w3 + row.w4,
    );
  }
  for (const week of ["w1", "w2", "w3", "w4"] as const) {
    add(
      `plumbing-weekly-plant-${week}`,
      "plumbing.weekly",
      `Plumbing weekly category ${week.toUpperCase()} sum = plant total`,
      PLUMBING_WEEKLY_PLANT[week],
      goldenSum(PLUMBING_WEEKLY_GOLDEN, (row) => row[week]),
    );
  }

  for (const row of PLUMBING_REPLAN_GOLDEN) {
    add(
      `plumbing-replan-identity-${row.cat}`,
      "plumbing.replan",
      `Plumbing replan ${row.cat} produced + remaining = plan`,
      row.plan,
      row.produced + row.remaining,
    );
    add(
      `plumbing-replan-shortfall-${row.cat}`,
      "plumbing.replan",
      `Plumbing replan ${row.cat} shortfall = max(remaining − feasible, 0)`,
      Math.max(row.remaining - row.feasible, 0),
      row.shortfall,
    );
  }
  add(
    "plumbing-replan-produced-total",
    "plumbing.replan",
    "Plumbing replan produced sum = grand total",
    PLUMBING_REPLAN_TOTAL_PRODUCED,
    goldenSum(PLUMBING_REPLAN_GOLDEN, (row) => row.produced),
  );
  add(
    "plumbing-replan-remaining-total",
    "plumbing.replan",
    "Plumbing replan remaining sum = grand total",
    PLUMBING_REPLAN_TOTAL_REMAINING,
    goldenSum(PLUMBING_REPLAN_GOLDEN, (row) => row.remaining),
  );
  add(
    "plumbing-replan-feasible-total",
    "plumbing.replan",
    "Plumbing replan feasible sum = grand total",
    PLUMBING_REPLAN_TOTAL_FEASIBLE,
    goldenSum(PLUMBING_REPLAN_GOLDEN, (row) => row.feasible),
  );
  add(
    "plumbing-replan-shortfall-total",
    "plumbing.replan",
    "Plumbing replan shortfall sum = grand total",
    PLUMBING_REPLAN_TOTAL_SHORTFALL,
    goldenSum(PLUMBING_REPLAN_GOLDEN, (row) => row.shortfall),
  );
  add(
    "plumbing-monitoring-w1-total",
    "plumbing.monitoring",
    "Plumbing monitoring W1 category sum = plant mapped total",
    PLUMBING_MON_W1_MAPPED,
    goldenSum(Object.values(PLUMBING_MON_CAT_W1), (value) => value),
  );
  add(
    "plumbing-monitoring-w2-total",
    "plumbing.monitoring",
    "Plumbing monitoring W2 category sum = plant mapped total",
    PLUMBING_MON_W2_MAPPED,
    goldenSum(Object.values(PLUMBING_MON_CAT_W2), (value) => value),
  );

  return checks;
}
