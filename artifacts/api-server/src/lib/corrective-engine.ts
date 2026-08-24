import { db, bufferCategoriesTable, weeklyReleaseBandsTable, correctivePlanRunsTable, correctivePlanItemsTable, categoryCapacityTable, planRunsTable, planRunInputsTable, planRunResultsTable } from "@workspace/db";
import type { CorrectiveWeekStat, CorrectiveWarning } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { fetchDailyActuals, type DailyActualRow } from "./plant-ingestion";
import {
  fetchPlumbingSheet3Production,
  fetchLivePendingOrderTotals,
  itemKey,
  normalizeCode,
  normalizeCodeStrict,
  type PlumbingSheet3Row,
  type DualTotals,
} from "./sheets";
import {
  buildPlanItems,
  loadLatestUploadRowsByKind,
  type PlanItemWithBom,
} from "../routes/plan";
import { annotateWeeklyRelease, type CalcPlanItem } from "./calc";
import { logger } from "./logger";
import { defaultEffectiveDate, savePlanVersionSnapshot } from "./plant-plan-timeline";
import { diagnoseInputRows, type InputReadDiagnostics } from "./input-diagnostics";
import { LivePendingReadError } from "./corrective-errors";

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Deterministic SHA-256 fingerprint of the full persisted content of a
 * corrective run (run-level fields + every item row + weekStats + warnings).
 * Numbers are quantized to Postgres `real` (single precision, what the DB
 * stores) so recomputing the fingerprint stays stable across float noise.
 * Items are sorted by a stable key so ordering can't change the hash.
 */
function computeRunFingerprint(content: {
  segment: string;
  month: string;
  weekClosed: number;
  asOfDate: string | null;
  note: string | null;
  planRunId: number | null;
  dailyCapacity: number;
  workingDaysPerWeek: number;
  producedToDate: number;
  newOrdersQty: number;
  originalMonthTotal: number;
  revisedMonthTotal: number;
  unfulfillableQty: number;
  weekStats: CorrectiveWeekStat[];
  warnings: CorrectiveWarning[];
  items: CorrectiveItemResult[];
  categories: CorrectiveCategoryResult[];
  workingDaysRemaining: number;
}): string {
  const q = (n: number | null) => (n == null ? null : Math.fround(n));
  const payload = {
    segment: content.segment,
    month: content.month,
    weekClosed: content.weekClosed,
    asOfDate: content.asOfDate,
    note: content.note,
    planRunId: content.planRunId,
    dailyCapacity: q(content.dailyCapacity),
    workingDaysPerWeek: content.workingDaysPerWeek,
    producedToDate: q(content.producedToDate),
    newOrdersQty: q(content.newOrdersQty),
    originalMonthTotal: q(content.originalMonthTotal),
    revisedMonthTotal: q(content.revisedMonthTotal),
    unfulfillableQty: q(content.unfulfillableQty),
    weekStats: content.weekStats.map(w => [w.week, w.weekLabel, q(w.released), q(w.capacity), w.workingDays, q(w.produced), q(w.lag), q(w.loadFactor), w.status]),
    warnings: content.warnings.map(w => [w.code, w.severity, w.message, q(w.value ?? null), q(w.threshold ?? null), w.category ?? null, w.items ?? null]),
    items: [...content.items]
      .sort((a, b) => (a.category + "::" + a.itemCode + "::" + a.colour).localeCompare(b.category + "::" + b.itemCode + "::" + b.colour))
      .map(i => [
        i.itemCode, i.colour, i.category,
        q(i.avg3MoSale), q(i.bufferMultiplier), q(i.stockOpen), q(i.producedToDate), q(i.stockNow),
        q(i.pendingAtPlan), q(i.pendingNow), q(i.pendingLastMonth),
        q(i.originalPlan), i.originalWeek, q(i.bufferReqRev), q(i.planRev), q(i.remainingToProduce),
        q(i.kgRev), q(i.remainingKg), q(i.deltaNewOrders), q(i.deltaProduction), q(i.deltaNet),
        q(i.coverNow), i.newWeek, q(i.w1Rev), q(i.w2Rev), q(i.w3Rev), q(i.w4Rev),
        i.status, i.isNewItem ? 1 : 0,
      ]),
    workingDaysRemaining: content.workingDaysRemaining,
    categories: [...content.categories]
      .sort((a, b) => a.category.localeCompare(b.category))
      .map(c => [
        c.category, q(c.plan), q(c.produced), q(c.remaining),
        q(c.capPerDay), c.capacityMethod, c.capacityDays,
        q(c.feasible), q(c.shortfall),
        c.daysRun, q(c.feasibleAtRunRate), c.runRateDivergenceFlag ? 1 : 0,
      ]),
  };
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface CorrectiveReplanInput {
  month: string;
  weekClosed: number;
  asOfDate?: string;
  segment?: string;
  dailyCapacity?: number;
  workingDaysPerWeek?: number;
  /**
   * Immutable plan run to use as the baseline ("as issued"). When set, the
   * original plan is read from the frozen plan_run_results/inputs snapshot —
   * NOT rebuilt live — so the corrective run measures against the issued plan.
   * Undefined = live rebuild (legacy behaviour, used by the validate suite).
   */
  planRunId?: number;
  /**
   * Grand-max total stored on the auto-selected plan run (planRun.grandMaxTotal).
   * When provided the engine asserts that the frozen baseline items sum to this
   * total (±100 pcs). A material mismatch means the plan run's items were not
   * written consistently with its header — a BASELINE_INTEGRITY_ERROR warning
   * is emitted rather than silently producing a corrective on corrupted data.
   */
  planRunGrandMax?: number;
  /**
   * When true, run the full engine but skip persisting the run + items to the
   * DB. Used by the regression/validate suite so repeated verification runs
   * don't pile duplicate corrective_plan_runs rows into the run history.
   */
  dryRun?: boolean;
}

export interface CorrectiveItemResult {
  itemCode: string;
  colour: string;
  category: string;
  avg3MoSale: number;
  bufferMultiplier: number;
  stockOpen: number;
  producedToDate: number;
  stockNow: number;
  pendingAtPlan: number;
  pendingNow: number;
  pendingLastMonth: number;
  originalPlan: number;
  originalWeek: number | null;
  bufferReqRev: number;
  planRev: number;
  remainingToProduce: number;
  kgRev: number;
  remainingKg: number;
  deltaNewOrders: number;
  deltaProduction: number;
  deltaNet: number;
  coverNow: number | null;
  newWeek: number | null;
  w1Rev: number;
  w2Rev: number;
  w3Rev: number;
  w4Rev: number;
  status: string;
  isNewItem: boolean;
}

export interface CorrectiveCategoryResult {
  category: string;
  plan: number;
  produced: number;
  producedCapped: number;
  remaining: number;
  capPerDay: number;
  /** Alias for capPerDay — the p90 daily capacity derived from production history. */
  capacityPerDay: number;
  /** How capPerDay was derived: p90 (≥5 production days), mean (1–4 days), override, db (seeded fallback), none (no demonstrated production). */
  capacityMethod: "p90" | "mean" | "override" | "db" | "none";
  /** Distinct production days observed for this category in the current month (null for override/db fallback). */
  capacityDays: number | null;
  /** Feasibility at full capacity: capPerDay × workingDaysRemaining. */
  feasible: number;
  shortfall: number;
  productionLag: number;
  newDemandDelta: number;
  capacityShortfall: number;
  flags: string[];
  kgRemaining: number;
  /** Distinct days this category produced in the elapsed portion of the month. */
  daysRun: number;
  /** Working days elapsed (used to compute run-rate). */
  elapsedWorkingDays: number;
  /** Feasibility at demonstrated run-rate: (produced ÷ elapsedWorkingDays) × workingDaysRemaining. */
  feasibleAtRunRate: number;
  /** True when feasibleAtCapacity > feasibleAtRunRate × 1.5 — optimism flag for review. */
  runRateDivergenceFlag: boolean;
}

export interface CorrectiveReplanResult {
  runId: number;
  month: string;
  segment: string;
  weekClosed: number;
  asOfDate?: string;
  workingDaysUsed: number;
  workingDaysRemaining: number;
  note?: string;
  dailyCapacity: number;
  workingDaysPerWeek: number;
  producedToDate: number;
  newOrdersQty: number;
  originalMonthTotal: number;
  revisedMonthTotal: number;
  unfulfillableQty: number;
  weekStats: CorrectiveWeekStat[];
  warnings: CorrectiveWarning[];
  items: CorrectiveItemResult[];
  categories: CorrectiveCategoryResult[];
  unplannedProduction: Array<{ code: string; qty: number }>;
  unplannedTotal: number;
  /** Plan run cited as the baseline (null = live rebuild, no frozen run used). */
  baselinePlanRunId: number | null;
  /** "frozen-run" when the baseline came from an immutable plan run snapshot. */
  baselineSource: "frozen-run" | "live";
  /**
   * Grand total of plan_run_results for the cited baseline run (rounded pcs).
   * null = either no frozen baseline was used or the run predates migration 022.
   * Used by the UI to detect item-sum drift vs the frozen plan run header.
   */
  frozenPlanGrandMax: number | null;
  inputDiagnostics?: {
    pendingAtPlan: InputReadDiagnostics;
    livePending: InputReadDiagnostics;
  };
}

const LIVE_PENDING_ALIASES = {
  code: ["Old ERP Code", "Item Code", "Item No."],
  colour: ["Colour", "Color", "COLOR", "COLUOR"],
  quantity: ["Bal. Qty", "Bal.Qty", "Balance Qty", "Balance_Qty"],
};

/**
 * Read the live pending source for corrective calculations.
 *
 * A successful response may legitimately contain no recognized rows or only
 * zero quantities, and its diagnostics are preserved for the result. A source
 * read failure is different: returning empty maps would turn the failure into
 * `0 - pendingAtPlan`, so it must reject before item deltas are calculated.
 */
export async function fetchCorrectiveLivePending(
  loader?: () => Promise<DualTotals>,
  segment: string = "PTMT",
): Promise<DualTotals> {
  try {
    return await (loader ?? (() => fetchLivePendingOrderTotals(segment)))();
  } catch (err) {
    const causeMessage = err instanceof Error ? err.message : String(err);
    const baseDiagnostics = diagnoseInputRows([], LIVE_PENDING_ALIASES, {
      source: "Pending order / report",
      error: causeMessage,
    });
    const diagnostics: InputReadDiagnostics = {
      ...baseDiagnostics,
      // No headers were observed because the source read failed. Do not make
      // that transport failure look like a malformed successfully-read file.
      reasons: [`source read failed: ${causeMessage}`],
    };
    logger.warn({ diagnostics, error: causeMessage }, "corrective-engine: live pending source read failed");
    throw new LivePendingReadError(diagnostics, causeMessage);
  }
}

/**
 * Load PTMT production for a corrective run without manufacturing a
 * zero-production snapshot when the source is unavailable.
 *
 * The optional loader keeps this boundary unit-testable while the production
 * path always uses fetchDailyActuals.
 */
export async function fetchCorrectivePtmtActuals(
  month: string,
  loader: (month: string) => Promise<DailyActualRow[]> = fetchDailyActuals,
): Promise<DailyActualRow[]> {
  return loader(month);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function countWorkingDays(from: string, to: string): number {
  let count = 0;
  const d = new Date(from + "T00:00:00Z");
  const end = new Date(to + "T00:00:00Z");
  while (d <= end) {
    if (d.getUTCDay() !== 0) count++;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return count;
}

function monthLastDay(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
}

/**
 * P5: returns the calendar date of the last working day of week N in the given month.
 * Working days are Mon–Sat (Sunday excluded). Week N = the N-th consecutive group
 * of wdPerWeek working days starting from the 1st of the month.
 */
function lastDayOfWeekN(month: string, weekN: number, wdPerWeek: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1, 1));
  const lastOfMonth = new Date(Date.UTC(y, m, 0));
  let count = 0;
  const target = weekN * wdPerWeek;
  while (d <= lastOfMonth) {
    if (d.getUTCDay() !== 0) {
      count++;
      if (count === target) break;
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Revised plan formula — one formula for ALL segments and categories (P3).
 * stockOpen = opening stock (month-start); pendingNow = live orders.
 * planRev represents the total monthly plan quantity (parallel to maxProduction)
 * so that remaining = max(planRev − producedToDate, 0) is correct without
 * double-subtracting production.
 */
function computePlanRev(opts: {
  bufferReqRev: number;
  stockOpen: number;
  pendingNow: number;
  pendingLastMonth: number;
}): number {
  const { bufferReqRev, stockOpen, pendingNow, pendingLastMonth } = opts;
  return round(Math.max(bufferReqRev - stockOpen + pendingLastMonth + pendingNow, 0));
}

function resolveFromDualTotals(
  exact: Map<string, number>,
  byCode: Map<string, number>,
  itemCode: string,
  colour: string,
  isSingleVariant: boolean,
): number {
  if (isSingleVariant) {
    return byCode.get(normalizeCode(itemCode)) ?? 0;
  }
  return exact.get(itemKey(itemCode, colour)) ?? 0;
}

export function sumPendingUploads(
  rows: Record<string, unknown>[],
  options: { source?: string; uploadId?: number | null; filename?: string | null } = {},
): { totals: Map<string, number>; diagnostics: InputReadDiagnostics } {
  const m = new Map<string, number>();
  for (const row of rows) {
    const code = (["Old Item Code", "Item Code", "Item No."].map(k => row[k]).find(v => v != null && v !== "") as string | undefined);
    const colour = (["Colour", "Color"].map(k => row[k]).find(v => v != null && v !== "") as string | undefined) ?? "";
    const rawQty = (["Balance_Qty", "Balance Qty", "Bal.Qty", "Bal. Qty", "Qty"].map(k => row[k]).find(v => v != null) as unknown);
    if (!code) continue;
    const qty = typeof rawQty === "number" ? rawQty : Number(String(rawQty ?? "0").replace(/,/g, "")) || 0;
    const k = itemKey(code, colour);
    m.set(k, (m.get(k) ?? 0) + qty);
  }
  const diagnostics = diagnoseInputRows(rows, {
    code: ["Old Item Code", "Item Code", "Item No."],
    colour: ["Colour", "Color"],
    quantity: ["Balance_Qty", "Balance Qty", "Bal.Qty", "Bal. Qty", "Qty"],
  }, {
    source: options.source ?? "pending upload",
    uploadId: options.uploadId,
    filename: options.filename,
  });
  logger.info({ diagnostics }, "sumPendingUploads: source diagnostics");
  return { totals: m, diagnostics };
}

function p90(sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  return Math.round(sortedValues[Math.floor(sortedValues.length * 0.9)]!);
}

export function computeCapByCategory(
  map: Map<string, Map<string, number>>,
): Map<string, { cap: number; method: "p90" | "mean"; days: number }> {
  const result = new Map<string, { cap: number; method: "p90" | "mean"; days: number }>();
  for (const [category, dayMap] of map) {
    // Corrective remaining days are calendar Mon–Sat. Keep Cap/Day on the
    // same calendar basis rather than multiplying weekday capacity by a
    // denominator that includes no future Sundays. This aligns the samples
    // with the forward-looking calendar; it does not guarantee that p90 falls
    // when a low Sunday sample is removed.
    const vals = [...dayMap.entries()]
      .filter(([date, value]) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 0 && value > 0)
      .map(([, value]) => value)
      .sort((a, b) => a - b);
    if (vals.length === 0) continue;
    if (vals.length >= 5) {
      result.set(category, { cap: p90(vals), method: "p90", days: vals.length });
    } else {
      const mean = Math.round(vals.reduce((s, v) => s + v, 0) / vals.length);
      result.set(category, { cap: mean, method: "mean", days: vals.length });
    }
  }
  return result;
}

// ── Frozen baseline loader ────────────────────────────────────────────────────

/**
 * Rebuilds the "as issued" baseline from an immutable plan run snapshot.
 * Weekly release (week/w1–w4) is re-derived from the frozen plan numbers using
 * the CURRENT weekly release bands (bands are configuration, not plan data).
 * weightKg is not part of the frozen snapshot, so kg figures are 0 for frozen
 * baselines — acceptable: kg fields are a Plumbing display aid, and the frozen
 * baseline path is primarily a PTMT month-issuance feature.
 */
async function loadFrozenBaselineItems(
  planRunId: number,
  month: string,
  segment: string,
): Promise<PlanItemWithBom[]> {
  const [run] = await db.select().from(planRunsTable).where(eq(planRunsTable.id, planRunId));
  if (!run) throw new Error(`Plan run #${planRunId} not found`);
  if (run.month !== month || run.segment !== segment) {
    throw new Error(
      `Plan run #${planRunId} is for ${run.segment}/${run.month}, not ${segment}/${month}`,
    );
  }
  const [results, inputs] = await Promise.all([
    db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, planRunId)),
    db.select().from(planRunInputsTable).where(eq(planRunInputsTable.runId, planRunId)),
  ]);
  const inputByKey = new Map(inputs.map((i) => [`${i.itemCode}::${i.colour}`, i]));
  return results.map((r) => {
    const inp = inputByKey.get(`${r.itemCode}::${r.colour}`);
    const avg3MoSale = inp?.avg3MoSale ?? 0;
    const stock = inp?.stock ?? 0;
    const cover: number | "OS" = avg3MoSale > 0 ? round(stock / avg3MoSale) : "OS";
    return {
      itemCode: r.itemCode,
      colour: r.colour,
      category: r.category,
      avg3MoSale,
      stock,
      stockNeedsReview: false,
      bufferReq: r.bufferReq,
      minProduction: r.minProduction,
      maxProduction: r.productionPlan,
      pendingOrderLastMonth: inp?.pendingLastMonth ?? 0,
      pendingOrder: inp?.pendingCurrent ?? 0,
      order: 0,
      achievementPct: null,
      cover,
      week: null,
      w1: 0,
      w2: 0,
      w3: 0,
      w4: 0,
    };
  });
}

// ── Main engine ───────────────────────────────────────────────────────────────

export async function runCorrectiveReplan(input: CorrectiveReplanInput): Promise<CorrectiveReplanResult> {
  const { month } = input;
  const segment = input.segment ?? "PTMT";
  // 21335 was the old circular PTMT fallback (plan ÷ 27 days). Removed: any path
  // that needs a global capacity figure should use the per-category p90/mean ladder
  // or the seeded DB table. Zero here means the || fallback below has no effect.
  const dailyCapacity = input.dailyCapacity ?? 0;
  const workingDaysPerWeek = input.workingDaysPerWeek ?? 6;

  logger.info({ month, weekClosed: input.weekClosed, asOfDate: input.asOfDate, segment }, "corrective-engine: starting replan");

  // ── Fetch all data in parallel ────────────────────────────────────────────
  const [
    originalItems,
    plumbingSheet3Raw,
    ptmtActualsRaw,
    livePendingTotals,
    bufferRows,
    bandRows,
    catCapRows,
  ] = await Promise.all([
    input.planRunId != null
      ? loadFrozenBaselineItems(input.planRunId, month, segment)
      : buildPlanItems(month, segment),
    // Do NOT swallow Sheet3 failures: a missing/unreadable workbook must fail
    // the replan loudly, never present as zero production (stale-plan hazard).
    segment === "Plumbing"
      ? fetchPlumbingSheet3Production(month)
      : Promise.resolve([] as PlumbingSheet3Row[]),
    segment === "PTMT"
      ? fetchCorrectivePtmtActuals(month)
      : Promise.resolve([] as DailyActualRow[]),
    fetchCorrectiveLivePending(undefined, segment),
    db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, segment)),
    db.select().from(weeklyReleaseBandsTable).where(eq(weeklyReleaseBandsTable.segment, segment)),
    db.select().from(categoryCapacityTable).where(eq(categoryCapacityTable.segment, segment)),
  ]);

  // ── P5: Resolve effective asOfDate (weekClosed → last day of that week) ───
  const monthStart = `${month}-01`;
  const monthEnd = monthLastDay(month);

  let weekClosed: number;
  let effectiveAsOfDate: string | undefined;
  let workingDaysUsed: number;
  let workingDaysRemaining: number;
  let note: string | undefined;

  if (input.asOfDate) {
    effectiveAsOfDate = input.asOfDate;
    workingDaysUsed = countWorkingDays(monthStart, effectiveAsOfDate);
    weekClosed = Math.min(Math.floor(workingDaysUsed / workingDaysPerWeek), 3);
    const nextDayObj = new Date(effectiveAsOfDate + "T00:00:00Z");
    nextDayObj.setUTCDate(nextDayObj.getUTCDate() + 1);
    const nextDay = nextDayObj.toISOString().slice(0, 10);
    workingDaysRemaining = nextDay <= monthEnd ? countWorkingDays(nextDay, monthEnd) : 0;
    const [yy, mm, dd] = effectiveAsOfDate.split("-");
    note = `As of ${dd}/${mm}/${String(yy).slice(2)}`;
  } else if (input.weekClosed > 0) {
    // P5: derive asOfDate from weekClosed
    weekClosed = input.weekClosed;
    effectiveAsOfDate = lastDayOfWeekN(month, weekClosed, workingDaysPerWeek);
    workingDaysUsed = countWorkingDays(monthStart, effectiveAsOfDate);
    const nextDayObj = new Date(effectiveAsOfDate + "T00:00:00Z");
    nextDayObj.setUTCDate(nextDayObj.getUTCDate() + 1);
    const nextDay = nextDayObj.toISOString().slice(0, 10);
    workingDaysRemaining = nextDay <= monthEnd ? countWorkingDays(nextDay, monthEnd) : 0;
    note = `After W${weekClosed} closed`;
  } else {
    weekClosed = 0;
    workingDaysUsed = 0;
    workingDaysRemaining = countWorkingDays(monthStart, monthEnd);
  }

  // ── Build item-code → category map (for Plumbing Sheet3 matching) ─────────
  const normCodeToCategory = new Map<string, string>();
  for (const item of originalItems) {
    normCodeToCategory.set(normalizeCodeStrict(item.itemCode), item.category);
  }

  // ── P1 + P4: Build produced maps ─────────────────────────────────────────
  // dailyByCat: category → dateStr → qty (for p90 capacity computation, P2)
  const dailyByCat = new Map<string, Map<string, number>>();
  // unplannedByCode: rawCode → qty for codes not found in any plan item
  const unplannedByCode = new Map<string, number>();

  let producedByNormCode = new Map<string, number>(); // Plumbing only (normCode → qty)
  let producedByStrictCode = new Map<string, number>(); // PTMT code-only (normCode → qty)
  let producedByStrictKey = new Map<string, number>();  // PTMT exact (normCode::colour → qty)

  if (segment === "Plumbing") {
    // P1: filter by effectiveAsOfDate, accumulate per normCode and per daily-category
    const effectiveSheet3 = effectiveAsOfDate
      ? plumbingSheet3Raw.filter(r => r.dateStr <= effectiveAsOfDate!)
      : plumbingSheet3Raw;

    for (const row of effectiveSheet3) {
      if (row.qty <= 0) continue;
      const category = normCodeToCategory.get(row.normCode);
      if (category) {
        producedByNormCode.set(row.normCode, (producedByNormCode.get(row.normCode) ?? 0) + row.qty);
        let dayMap = dailyByCat.get(category);
        if (!dayMap) { dayMap = new Map(); dailyByCat.set(category, dayMap); }
        dayMap.set(row.dateStr, (dayMap.get(row.dateStr) ?? 0) + row.qty);
      } else {
        unplannedByCode.set(row.rawCode, (unplannedByCode.get(row.rawCode) ?? 0) + row.qty);
      }
    }
  } else {
    // P4: PTMT — use normalizeCodeStrict for produced-map keys
    const effectiveActuals = effectiveAsOfDate
      ? ptmtActualsRaw.filter(r => r.date <= effectiveAsOfDate!)
      : ptmtActualsRaw;

    for (const row of effectiveActuals) {
      if (row.qty <= 0) continue;
      const strictCode = normalizeCodeStrict(row.itemCode);
      producedByStrictCode.set(strictCode, (producedByStrictCode.get(strictCode) ?? 0) + row.qty);
      const strictKey = `${strictCode}::${normalizeCode(row.colour)}`;
      producedByStrictKey.set(strictKey, (producedByStrictKey.get(strictKey) ?? 0) + row.qty);
      // Also populate dailyByCat for PTMT capacity computation (same ladder as Plumbing)
      const category = normCodeToCategory.get(strictCode);
      if (category) {
        let dayMap = dailyByCat.get(category);
        if (!dayMap) { dayMap = new Map(); dailyByCat.set(category, dayMap); }
        dayMap.set(row.date, (dayMap.get(row.date) ?? 0) + row.qty);
      }
    }
  }

  // ── Count code variants per category (for PTMT single-variant resolution) ─
  const codeCounts = new Map<string, number>();
  if (segment === "PTMT") {
    // Use originalItems as proxy for variant count (avoids needing full item master query)
    for (const item of originalItems) {
      const ck = `${item.category}::${normalizeCodeStrict(item.itemCode)}`;
      codeCounts.set(ck, (codeCounts.get(ck) ?? 0) + 1);
    }
  }
  const isSingleVariant = (category: string, itemCode: string) =>
    (codeCounts.get(`${category}::${normalizeCodeStrict(itemCode)}`) ?? 0) <= 1;

  // ── P2: Compute capPerDay from daily production (Plumbing + PTMT) ──────────
  // p90 needs a demonstrated weekday distribution: with ≥5 distinct production
  // days use p90; with 1–4 days fall back to the weekday mean. Sunday-only
  // production has no demonstrated normal-day capacity and remains zero,
  // flagged NO_DEMONSTRATED_CAPACITY downstream.
  // dailyByCat is populated for both segments above; the helper below is shared.
  const plumbingCapByCategory = segment === "Plumbing" ? computeCapByCategory(dailyByCat) : new Map<string, { cap: number; method: "p90" | "mean"; days: number }>();
  const ptmtCapByCategory    = segment === "PTMT"     ? computeCapByCategory(dailyByCat) : new Map<string, { cap: number; method: "p90" | "mean"; days: number }>();

  const bufferByCategory = new Map(bufferRows.map(b => [b.name, b.multiplier]));
  const bandsByCategory = new Map(bandRows.map(b => [b.categoryName, b]));

  // Frozen baselines carry no week assignment in the snapshot — re-derive it
  // from the frozen plan numbers using the current weekly release bands.
  if (input.planRunId != null) {
    annotateWeeklyRelease(originalItems as CalcPlanItem[], bandsByCategory);
  }
  const catCapMap = new Map(catCapRows.map(r => [r.category, r]));

  // ── Build corrective items ────────────────────────────────────────────────
  const items: CorrectiveItemResult[] = [];

  for (const orig of originalItems) {
    const sv = segment === "PTMT" ? isSingleVariant(orig.category, orig.itemCode) : false;

    // P4: use normalizeCodeStrict for production lookup
    let producedToDate: number;
    if (segment === "Plumbing") {
      producedToDate = producedByNormCode.get(normalizeCodeStrict(orig.itemCode)) ?? 0;
    } else {
      const strictCode = normalizeCodeStrict(orig.itemCode);
      const strictKey = `${strictCode}::${normalizeCode(orig.colour)}`;
      producedToDate = sv
        ? (producedByStrictCode.get(strictCode) ?? 0)
        : (producedByStrictKey.get(strictKey) ?? 0);
    }

    const stockOpen = orig.stock;
    const stockNow = round(stockOpen + producedToDate);

    const pendingNow = resolveFromDualTotals(
      livePendingTotals.exact,
      livePendingTotals.byCode,
      orig.itemCode,
      orig.colour,
      sv,
    );

    // Both live rebuilds and frozen plan runs carry current pending from the
    // same Pending order report. For a frozen run, orig.pendingOrder is the
    // immutable pending value captured when that run was created.
    const pendingAtPlan = orig.pendingOrder;
    const pendingLastMonth = orig.pendingOrderLastMonth;

    const multiplier = bufferByCategory.get(orig.category) ?? 1;
    const avg3MoSale = orig.avg3MoSale;
    const bufferReqRev = round(avg3MoSale * multiplier);

    // P3: use maxProduction (plan-time, stable) as base; only add positive new-order delta
    // on top. This avoids the daily drift from live pending order fulfillment.
    // bufferReqRev / stockOpen are kept for display but NOT used to shrink the plan.
    const deltaNewOrders = round(pendingNow - pendingAtPlan);
    const planRev = round(Math.max(orig.maxProduction + Math.max(deltaNewOrders, 0), producedToDate));

    const remainingToProduce = round(Math.max(planRev - producedToDate, 0));

    // P6: kg per piece (Plumbing only; weightKg = maxProduction × kgPerPiece)
    const kgPerPiece = orig.maxProduction > 0 ? ((orig.weightKg ?? 0) / orig.maxProduction) : 0;
    const kgRev = round(planRev * kgPerPiece);
    const remainingKg = round(remainingToProduce * kgPerPiece);

    const deltaProduction = round(producedToDate);
    const deltaNet = round(planRev - orig.maxProduction);

    const coverNow: number | null = avg3MoSale > 0 ? round(stockNow / avg3MoSale) : null;

    items.push({
      itemCode: orig.itemCode,
      colour: orig.colour,
      category: orig.category,
      avg3MoSale,
      bufferMultiplier: multiplier,
      stockOpen,
      producedToDate,
      stockNow,
      pendingAtPlan,
      pendingNow,
      pendingLastMonth,
      originalPlan: orig.maxProduction,
      originalWeek: orig.week,
      bufferReqRev,
      planRev,
      remainingToProduce,
      kgRev,
      remainingKg,
      deltaNewOrders,
      deltaProduction,
      deltaNet,
      coverNow,
      newWeek: null,
      w1Rev: 0,
      w2Rev: 0,
      w3Rev: 0,
      w4Rev: 0,
      status: "on-plan",
      isNewItem: false,
    });
  }

  // ── P2: Per-category capacity ─────────────────────────────────────────────
  const getCapInfo = (category: string): { cap: number; method: CorrectiveCategoryResult["capacityMethod"]; days: number | null } => {
    const cap = catCapMap.get(category);
    if (cap?.overrideCapacity != null) return { cap: cap.overrideCapacity, method: "override", days: null };
    if (segment === "Plumbing") {
      const e = plumbingCapByCategory.get(category);
      return e ? { cap: e.cap, method: e.method, days: e.days } : { cap: 0, method: "none", days: 0 };
    }
    if (segment === "PTMT") {
      // Use production-derived capacity (p90 / mean) when August actuals are available;
      // fall back to the seeded DB value only when no production has been observed.
      const e = ptmtCapByCategory.get(category);
      if (e) return { cap: e.cap, method: e.method, days: e.days };
      // No actuals for this category yet — fall back to seeded suggested capacity.
      return { cap: cap?.suggestedCapacity ?? 0, method: "db", days: null };
    }
    return { cap: cap?.suggestedCapacity ?? 0, method: "db", days: null };
  };
  const getCapPerDay = (category: string): number => getCapInfo(category).cap;

  const getWdPerWeek = (category: string): number =>
    catCapMap.get(category)?.workingDaysPerWeek ?? workingDaysPerWeek;

  const globalWorkingDays = catCapRows[0]?.workingDaysPerWeek ?? workingDaysPerWeek;
  const computedDailyApplied = segment === "Plumbing"
    ? [...new Set(originalItems.map(i => i.category))].reduce((s, cat) => s + getCapPerDay(cat), 0)
    : catCapRows.reduce((s, r) => s + (r.overrideCapacity ?? r.suggestedCapacity), 0);
  // If per-category computation yields 0, use any explicit caller-supplied value.
  // The old 21335 magic number has been removed; if dailyCapacity is 0 here
  // (no actuals yet, no seeded DB rows) a NO_TOTAL_CAPACITY warning is emitted
  // and weekCapacity becomes 0 — load factors show 0 rather than a fictitious figure.
  const totalDailyApplied = computedDailyApplied > 0 ? computedDailyApplied : dailyCapacity;
  const weekCapacity = globalWorkingDays * totalDailyApplied;

  // ── Re-score urgency and assign to remaining weeks ────────────────────────
  const remainingWeeks: number[] = [];
  for (let w = weekClosed + 1; w <= 4; w++) remainingWeeks.push(w);

  const schedulable = items.filter(i => i.remainingToProduce > 0);
  schedulable.sort((a, b) => {
    const ca = a.coverNow ?? 999;
    const cb = b.coverNow ?? 999;
    return ca - cb;
  });

  const catWeekBuckets = new Map<number, Map<string, number>>();
  for (const w of remainingWeeks) catWeekBuckets.set(w, new Map());

  const originalByKey = new Map(originalItems.map(i => [itemKey(i.itemCode, i.colour), i]));

  for (const item of schedulable) {
    const band = bandsByCategory.get(item.category);
    let assignedWeek: number | null = null;

    if (band && item.coverNow !== null) {
      const c = item.coverNow;
      if (c < band.w1Upper && remainingWeeks.includes(1)) assignedWeek = 1;
      else if (c < band.w2Upper && remainingWeeks.includes(2)) assignedWeek = 2;
      else if (c < band.w3Upper && remainingWeeks.includes(3)) assignedWeek = 3;
      else if (c < band.w4Upper && remainingWeeks.includes(4)) assignedWeek = 4;
    }

    if (assignedWeek !== null && !remainingWeeks.includes(assignedWeek)) {
      assignedWeek = remainingWeeks[0] ?? null;
    }
    if (assignedWeek === null) assignedWeek = remainingWeeks[0] ?? null;
    if (assignedWeek === null) {
      item.status = "unfulfillable";
      continue;
    }

    const appliedDailyCap = getCapPerDay(item.category);
    const catWDays = getWdPerWeek(item.category);
    const catWeekCap = appliedDailyCap * catWDays;

    let finalWeek: number | null = null;
    let spill = assignedWeek;
    while (spill <= 4) {
      if (!remainingWeeks.includes(spill)) { spill++; continue; }
      const catBuckets = catWeekBuckets.get(spill)!;
      const catLoad = catBuckets.get(item.category) ?? 0;
      if (catLoad + item.remainingToProduce <= catWeekCap) {
        finalWeek = spill;
        catBuckets.set(item.category, catLoad + item.remainingToProduce);
        break;
      }
      spill++;
    }

    if (finalWeek === null) {
      item.status = "unfulfillable";
      item.newWeek = null;
    } else {
      item.newWeek = finalWeek;
      item.w1Rev = finalWeek === 1 ? item.remainingToProduce : 0;
      item.w2Rev = finalWeek === 2 ? item.remainingToProduce : 0;
      item.w3Rev = finalWeek === 3 ? item.remainingToProduce : 0;
      item.w4Rev = finalWeek === 4 ? item.remainingToProduce : 0;

      const origItem = originalByKey.get(itemKey(item.itemCode, item.colour));
      if (!origItem || origItem.maxProduction === 0) {
        item.status = "new-item";
      } else if (finalWeek > (item.originalWeek ?? 0) && item.originalWeek !== null) {
        item.status = "carried-over";
      } else if (item.deltaNewOrders > 0.1 * origItem.maxProduction) {
        item.status = "demand-spike";
      } else {
        item.status = "on-plan";
      }
    }
  }

  for (const item of items) {
    if (item.remainingToProduce === 0 && item.status === "on-plan") {
      item.status = "replenished";
    }
  }

  // ── P7: Per-category aggregates with variance attribution ─────────────────
  const catGroupMap = new Map<string, {
    planRevTotal: number;
    producedTotal: number;
    originalPlanTotal: number;
    newDemandDeltaTotal: number;
    kgRemainingTotal: number;
  }>();
  for (const item of items) {
    const c = catGroupMap.get(item.category) ?? {
      planRevTotal: 0, producedTotal: 0, originalPlanTotal: 0,
      newDemandDeltaTotal: 0, kgRemainingTotal: 0,
    };
    c.planRevTotal += item.planRev;
    c.producedTotal += item.producedToDate;
    c.originalPlanTotal += item.originalPlan;
    c.newDemandDeltaTotal += Math.max(item.deltaNewOrders, 0);
    c.kgRemainingTotal += item.remainingKg;
    catGroupMap.set(item.category, c);
  }

  const capacityWarnings: CorrectiveWarning[] = [];
  const categories: CorrectiveCategoryResult[] = [];
  for (const [category, c] of catGroupMap) {
    const plan = Math.round(c.planRevTotal);
    const produced = Math.round(c.producedTotal);
    const producedCapped = Math.round(
      items.filter(i => i.category === category).reduce((s, i) => s + Math.min(i.producedToDate, i.planRev), 0)
    );
    const remaining = plan - producedCapped;
    const capInfo = getCapInfo(category);
    const capPerDay = capInfo.cap;
    const feasible = capPerDay * workingDaysRemaining;
    const shortfall = Math.max(remaining - feasible, 0);
    const productionLag = Math.max(Math.round(c.originalPlanTotal) - produced, 0);
    const newDemandDelta = Math.round(c.newDemandDeltaTotal);
    const kgRemaining = Math.round(c.kgRemainingTotal * 100) / 100;

    const flags: string[] = [];
    if (shortfall > 0) flags.push("UNFULFILLABLE_THIS_MONTH");
    if (produced === 0 && plan > 0) flags.push("NOT_STARTED");
    if (capPerDay === 0 && plan > 0) flags.push("NO_DEMONSTRATED_CAPACITY");
    // Invariant: a category with real production must never carry Cap/Day = 0.
    if (produced > 0 && capPerDay === 0) {
      capacityWarnings.push({
        code: "ZERO_CAP_WITH_PRODUCTION",
        severity: "critical",
        message: `${category}: produced ${produced.toLocaleString()} pcs but Cap/Day resolved to 0 (method=${capInfo.method}) — capacity derivation bug`,
        value: produced,
        category,
      });
    }

    // Run-rate divergence: how many days did this category actually produce,
    // and what would the total be at that demonstrated rate vs full capacity?
    const daysRun = dailyByCat.get(category)?.size ?? 0;
    const feasibleAtRunRate = produced > 0 && workingDaysUsed > 0
      ? Math.round((produced / workingDaysUsed) * workingDaysRemaining)
      : 0;
    // Flag when capacity projection is >50% more optimistic than run-rate.
    const runRateDivergenceFlag = feasibleAtRunRate > 0 && feasible > feasibleAtRunRate * 1.5;
    if (runRateDivergenceFlag) {
      flags.push("RUN_RATE_DIVERGENCE");
    }

    categories.push({
      category,
      plan,
      produced,
      producedCapped,
      remaining,
      capPerDay,
      capacityPerDay: capPerDay,   // alias for consumers expecting this field name
      capacityMethod: capInfo.method,
      capacityDays: capInfo.days,
      feasible,
      shortfall,
      productionLag,
      newDemandDelta,
      capacityShortfall: shortfall,
      flags,
      kgRemaining,
      daysRun,
      elapsedWorkingDays: workingDaysUsed,
      feasibleAtRunRate,
      runRateDivergenceFlag,
    });
  }
  categories.sort((a, b) => a.category.localeCompare(b.category));

  // Unplanned production (Plumbing: codes in Sheet3 not matching any plan item)
  const unplannedProduction = [...unplannedByCode.entries()]
    .map(([code, qty]) => ({ code, qty: Math.round(qty) }))
    .sort((a, b) => b.qty - a.qty);
  const unplannedTotal = unplannedProduction.reduce((s, u) => s + u.qty, 0);

  // ── Week stats ────────────────────────────────────────────────────────────
  const weekStats: CorrectiveWeekStat[] = [];
  for (let w = 1; w <= 4; w++) {
    const origReleased = originalItems.reduce((sum, i) =>
      sum + (w === 1 ? i.w1 : w === 2 ? i.w2 : w === 3 ? i.w3 : i.w4), 0);

    const producedForWeek = items
      .filter(i => i.originalWeek === w)
      .reduce((sum, i) => sum + i.producedToDate, 0);

    const catMap = catWeekBuckets.get(w);
    const weekLoad = catMap ? [...catMap.values()].reduce((s, v) => s + v, 0) : 0;
    const revLoad = w <= weekClosed ? origReleased : weekLoad;

    weekStats.push({
      week: w,
      weekLabel: `W${w}`,
      released: round(origReleased),
      capacity: round(weekCapacity),
      workingDays: globalWorkingDays,
      produced: round(w <= weekClosed ? producedForWeek : 0),
      lag: round(w <= weekClosed ? Math.max(origReleased - producedForWeek, 0) : 0),
      loadFactor: round(weekCapacity > 0 ? revLoad / weekCapacity : 0),
      status: w <= weekClosed ? "closed" : remainingWeeks.includes(w) ? "future" : "closed",
    });
  }

  // ── Totals ────────────────────────────────────────────────────────────────
  const producedToDateTotal = round(items.reduce((s, i) => s + i.producedToDate, 0));
  const newOrdersQty = round(items.reduce((s, i) => s + Math.max(i.deltaNewOrders, 0), 0));
  const originalMonthTotal = round(originalItems.reduce((s, i) => s + i.maxProduction, 0));
  const revisedMonthTotal = round(items.reduce((s, i) => s + i.planRev, 0));
  const unfulfillableQty = round(
    items.filter(i => i.status === "unfulfillable").reduce((s, i) => s + i.remainingToProduce, 0)
  );

  // ── Baseline integrity guard ──────────────────────────────────────────────
  // When the caller supplies the plan run's stored grandMaxTotal, assert that
  // the frozen items we loaded sum to the same value. A mismatch means the
  // plan run header and its item rows are inconsistent — emit a loud warning
  // (never silently produce a corrective on corrupted baseline data).
  if (input.planRunGrandMax != null) {
    const delta = Math.abs(originalMonthTotal - input.planRunGrandMax);
    if (delta > 100) {
      logger.warn(
        { segment, month, planRunId: input.planRunId, frozenItemsTotal: originalMonthTotal, planRunGrandMax: input.planRunGrandMax, delta },
        "corrective-engine: BASELINE_INTEGRITY_ERROR — frozen items total diverges from plan run grandMaxTotal",
      );
    }
  }

  // ── NO_TOTAL_CAPACITY guard ───────────────────────────────────────────────
  const noCapWarnings: CorrectiveWarning[] = [];
  if (totalDailyApplied === 0 && originalItems.length > 0) {
    noCapWarnings.push({
      code: "NO_TOTAL_CAPACITY",
      severity: "high",
      message: `No capacity data available (actuals not yet observed and no seeded DB values) — load factors and feasibility projections cannot be computed. Re-run after at least one production day is recorded.`,
    });
    logger.warn({ segment, month }, "corrective-engine: NO_TOTAL_CAPACITY — totalDailyApplied=0, feasibility figures will be 0");
  }

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings: CorrectiveWarning[] = [...capacityWarnings, ...noCapWarnings];

  if (weekClosed > 0) {
    for (let w = 1; w <= weekClosed; w++) {
      const ws = weekStats[w - 1];
      if (ws && ws.produced < ws.released * 0.95) {
        const lagPct = round((1 - ws.produced / Math.max(ws.released, 1)) * 100);
        warnings.push({
          code: "WEEK_LAG",
          severity: lagPct > 30 ? "high" : "medium",
          message: `W${w}: produced ${Math.round(ws.produced).toLocaleString()} vs released ${Math.round(ws.released).toLocaleString()} — ${lagPct}% shortfall`,
          value: ws.produced,
          threshold: ws.released,
        });
      }
    }
  }

  for (const w of remainingWeeks) {
    const catBucketMap = catWeekBuckets.get(w);
    if (!catBucketMap) continue;
    for (const [cat, load] of catBucketMap) {
      const catCap = getCapPerDay(cat) * getWdPerWeek(cat);
      if (catCap > 0 && load > catCap * 1.05) {
        const lf = load / catCap;
        warnings.push({
          code: "CAPACITY_OVERLOAD",
          severity: lf > 2 ? "critical" : lf > 1.5 ? "high" : "medium",
          message: `${cat} W${w}: ${lf.toFixed(1)}× capacity (${Math.round(load).toLocaleString()} vs ${Math.round(catCap).toLocaleString()} pcs/wk)`,
          value: load,
          threshold: catCap,
          category: cat,
        });
      }
    }
  }

  if (unfulfillableQty > 0) {
    const unfulfItems = items.filter(i => i.status === "unfulfillable");
    warnings.push({
      code: "UNFULFILLABLE_THIS_MONTH",
      severity: "critical",
      message: `${Math.round(unfulfillableQty).toLocaleString()} pcs cannot be produced this month — ${unfulfItems.length} items deferred`,
      value: unfulfillableQty,
      items: unfulfItems.slice(0, 10).map(i => `${i.itemCode}/${i.colour}`),
    });
  }

  const byCategory = new Map<string, { origPlan: number; deltaNewOrders: number }>();
  for (const item of items) {
    const c = byCategory.get(item.category) ?? { origPlan: 0, deltaNewOrders: 0 };
    c.origPlan += item.originalPlan;
    c.deltaNewOrders += Math.max(item.deltaNewOrders, 0);
    byCategory.set(item.category, c);
  }
  for (const [cat, stats] of byCategory) {
    if (stats.origPlan > 0 && stats.deltaNewOrders / stats.origPlan > 0.2) {
      const pct = round((stats.deltaNewOrders / stats.origPlan) * 100);
      warnings.push({
        code: "NEW_DEMAND_SPIKE",
        severity: pct > 50 ? "high" : "medium",
        message: `${cat}: ${pct}% new orders added mid-month (+${Math.round(stats.deltaNewOrders).toLocaleString()} pcs)`,
        value: stats.deltaNewOrders,
        threshold: stats.origPlan * 0.2,
        category: cat,
      });
    }
  }

  const immediateWeek = remainingWeeks[0];
  if (immediateWeek !== undefined) {
    const stockoutItems = items.filter(
      i => i.coverNow !== null && i.coverNow < 0.1 && i.newWeek !== immediateWeek && i.remainingToProduce > 0,
    );
    if (stockoutItems.length > 0) {
      warnings.push({
        code: "STOCKOUT_IMMINENT",
        severity: "critical",
        message: `${stockoutItems.length} items have <0.1× cover and are NOT in W${immediateWeek} release — risk of stockout`,
        items: stockoutItems.slice(0, 10).map(i => `${i.itemCode}/${i.colour}`),
      });
    }
  }

  if (originalMonthTotal > 0) {
    const driftPct = Math.abs(revisedMonthTotal - originalMonthTotal) / originalMonthTotal;
    if (driftPct > 0.1) {
      warnings.push({
        code: "PLAN_DRIFT",
        severity: driftPct > 0.25 ? "high" : "medium",
        message: `Revised month total ${Math.round(revisedMonthTotal).toLocaleString()} vs original ${Math.round(originalMonthTotal).toLocaleString()} — ${round(driftPct * 100)}% drift`,
        value: revisedMonthTotal,
        threshold: originalMonthTotal,
      });
    }
  }

  // ── Persist to DB (skipped for dry runs, e.g. the validate suite) ─────────
  // Duplicate guard: a deterministic SHA-256 fingerprint of the FULL persisted
  // content (run fields + every item row + weekStats + warnings) is stored on
  // each run. Inside a transaction serialized by a per-segment+month advisory
  // lock, if the latest run carries the same fingerprint we reuse it instead
  // of inserting — so the auto-sync scheduler, repeated UI clicks, and even
  // concurrent requests can't pile identical runs into the history.
  const fingerprint = computeRunFingerprint({
    segment,
    month,
    weekClosed,
    asOfDate: effectiveAsOfDate ?? null,
    note: note ?? null,
    planRunId: input.planRunId ?? null,
    dailyCapacity: Math.round(totalDailyApplied),
    workingDaysPerWeek: globalWorkingDays,
    producedToDate: producedToDateTotal,
    newOrdersQty,
    originalMonthTotal,
    revisedMonthTotal,
    unfulfillableQty,
    weekStats,
    warnings,
    items,
    // Persisted export inputs — a capacity-derivation change must produce a
    // NEW run (otherwise dedupe would reuse a run with stale categoriesJson).
    categories,
    workingDaysRemaining,
  });

  const versionEffectiveFrom = effectiveAsOfDate
    ?? (weekClosed > 0
      ? `${month}-${String(weekClosed * 7 + 1).padStart(2, "0")}`
      : defaultEffectiveDate(month));
  let run: typeof correctivePlanRunsTable.$inferSelect | undefined;
  let reusedExistingRun = false;
  if (!input.dryRun) {
  ({ run, reused: reusedExistingRun } = await db.transaction(async (tx) => {
    // Serialize concurrent persists for the same segment+month for the
    // duration of this transaction (lock releases automatically on commit).
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`corrective:${segment}:${month}`}))`);

    const [latest] = await tx
      .select()
      .from(correctivePlanRunsTable)
      .where(and(
        eq(correctivePlanRunsTable.segment, segment),
        eq(correctivePlanRunsTable.month, month),
      ))
      .orderBy(desc(correctivePlanRunsTable.id))
      .limit(1);

    if (latest && latest.fingerprint != null && latest.fingerprint === fingerprint) {
      logger.info({ runId: latest.id, month, segment }, "corrective-engine: identical to latest run — reusing, not inserting");
      return { run: latest, reused: true };
    }

    const [inserted] = await tx.insert(correctivePlanRunsTable).values({
      segment,
      month,
      effectiveFrom: versionEffectiveFrom,
      weekClosed,
      dailyCapacity: Math.round(totalDailyApplied),
      workingDaysPerWeek: globalWorkingDays,
      producedToDate: producedToDateTotal,
      newOrdersQty,
      originalMonthTotal,
      revisedMonthTotal,
      unfulfillableQty,
      weekStatsJson: weekStats,
      warningsJson: warnings,
      categoriesJson: categories,
      workingDaysRemaining,
      asOfDate: effectiveAsOfDate ?? null,
      planRunId: input.planRunId ?? null,
      // Persist the frozen plan run's grand-max so exports can compare it
      // against grandOrigComputed without re-querying plan_run_results.
      frozenPlanGrandMax: input.planRunGrandMax ?? null,
      note: note ?? null,
      fingerprint,
    }).returning();

    if (inserted && items.length > 0) {
      const runId = inserted.id;
      const CHUNK = 200;
      for (let i = 0; i < items.length; i += CHUNK) {
        const chunk = items.slice(i, i + CHUNK);
        await tx.insert(correctivePlanItemsTable).values(
          chunk.map(item => ({
            runId,
          itemCode: item.itemCode,
          colour: item.colour,
          category: item.category,
          avg3MoSale: item.avg3MoSale,
          bufferMultiplier: item.bufferMultiplier,
          stockOpen: item.stockOpen,
          producedToDate: item.producedToDate,
          stockNow: item.stockNow,
          pendingAtPlan: item.pendingAtPlan,
          pendingNow: item.pendingNow,
          pendingLastMonth: item.pendingLastMonth,
          originalPlan: item.originalPlan,
          originalWeek: item.originalWeek,
          bufferReqRev: item.bufferReqRev,
          planRev: item.planRev,
          remainingToProduce: item.remainingToProduce,
          kgRev: item.kgRev,
          remainingKg: item.remainingKg,
          deltaNewOrders: item.deltaNewOrders,
          deltaProduction: item.deltaProduction,
          deltaNet: item.deltaNet,
          coverNow: item.coverNow,
          newWeek: item.newWeek,
          w1Rev: item.w1Rev,
          w2Rev: item.w2Rev,
          w3Rev: item.w3Rev,
          w4Rev: item.w4Rev,
            status: item.status,
            isNewItem: item.isNewItem ? 1 : 0,
          })),
        );
      }
    }
    return { run: inserted, reused: false };
  }));
  }

  logger.info({
    reusedExistingRun,
    runId: run?.id, month, segment, items: items.length,
    producedToDate: producedToDateTotal, warnings: warnings.length,
    categories: categories.length, unplanned: unplannedProduction.length,
  }, "corrective-engine: replan complete");

  if (run && !reusedExistingRun) {
    await savePlanVersionSnapshot({
      month,
      segment,
      kind: "corrective",
      sourceId: run.id,
      effectiveFrom: versionEffectiveFrom,
      sourceLabel: `Corrective run #${run.id}`,
      targets: items.map((item) => ({
        itemCode: item.itemCode,
        colour: item.colour,
        category: item.category,
        maxPcs: item.planRev,
        minPcs: 0,
        w1: item.w1Rev,
        w2: item.w2Rev,
        w3: item.w3Rev,
        w4: item.w4Rev,
      })),
    });
  }

  return {
    runId: run?.id ?? 0,
    month,
    segment,
    weekClosed,
    asOfDate: effectiveAsOfDate,
    workingDaysUsed,
    workingDaysRemaining,
    note,
    dailyCapacity: Math.round(totalDailyApplied),
    workingDaysPerWeek: globalWorkingDays,
    producedToDate: producedToDateTotal,
    newOrdersQty,
    originalMonthTotal,
    revisedMonthTotal,
    unfulfillableQty,
    weekStats,
    warnings,
    items,
    categories,
    unplannedProduction,
    unplannedTotal,
    baselinePlanRunId: input.planRunId ?? null,
    baselineSource: input.planRunId != null ? "frozen-run" : "live",
    frozenPlanGrandMax: input.planRunGrandMax != null ? Math.round(input.planRunGrandMax) : null,
    inputDiagnostics: {
      pendingAtPlan: livePendingTotals.diagnostics ?? diagnoseInputRows([], LIVE_PENDING_ALIASES, {
        source: "Pending order / report · plan snapshot",
      }),
      livePending: livePendingTotals.diagnostics ?? diagnoseInputRows([], LIVE_PENDING_ALIASES, {
        source: "Pending order / report",
      }),
    },
  };
}
