import { db, bufferCategoriesTable, weeklyReleaseBandsTable, correctivePlanRunsTable, correctivePlanItemsTable, categoryCapacityTable, planRunsTable, planRunInputsTable, planRunResultsTable } from "@workspace/db";
import type { CorrectiveWeekStat, CorrectiveWarning } from "@workspace/db";
import { eq } from "drizzle-orm";
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
import { buildPlanItems, loadLatestUploadRowsByKind, type PlanItemWithBom } from "../routes/plan";
import { annotateWeeklyRelease, type CalcPlanItem } from "./calc";
import { logger } from "./logger";

const round = (n: number) => Math.round(n * 100) / 100;

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
  /** Alias for capPerDay — the p90 daily capacity derived from Sheet3 production history. */
  capacityPerDay: number;
  feasible: number;
  shortfall: number;
  productionLag: number;
  newDemandDelta: number;
  capacityShortfall: number;
  flags: string[];
  kgRemaining: number;
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

function sumPendingUploads(rows: Record<string, unknown>[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const row of rows) {
    const code = (["Old Item Code", "Item Code", "Item No."].map(k => row[k]).find(v => v != null && v !== "") as string | undefined);
    const colour = (["Colour", "Color"].map(k => row[k]).find(v => v != null && v !== "") as string | undefined) ?? "";
    const rawQty = (["Balance_Qty", "Balance Qty", "Bal.Qty", "Qty"].map(k => row[k]).find(v => v != null) as unknown);
    if (!code) continue;
    const qty = typeof rawQty === "number" ? rawQty : Number(String(rawQty ?? "0").replace(/,/g, "")) || 0;
    const k = itemKey(code, colour);
    m.set(k, (m.get(k) ?? 0) + qty);
  }
  return m;
}

function p90(sortedValues: number[]): number {
  if (sortedValues.length === 0) return 0;
  return Math.round(sortedValues[Math.floor(sortedValues.length * 0.9)]!);
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
  const dailyCapacity = input.dailyCapacity ?? 21335;
  const workingDaysPerWeek = input.workingDaysPerWeek ?? 6;

  logger.info({ month, weekClosed: input.weekClosed, asOfDate: input.asOfDate, segment }, "corrective-engine: starting replan");

  // ── Fetch all data in parallel ────────────────────────────────────────────
  const [
    originalItems,
    plumbingSheet3Raw,
    ptmtActualsRaw,
    livePendingTotals,
    pendingOrderRows,
    pendingLastMoRows,
    bufferRows,
    bandRows,
    catCapRows,
  ] = await Promise.all([
    input.planRunId != null
      ? loadFrozenBaselineItems(input.planRunId, month, segment)
      : buildPlanItems(month, segment),
    segment === "Plumbing"
      ? fetchPlumbingSheet3Production(month).catch(err => {
          logger.warn({ err }, "corrective-engine: fetchPlumbingSheet3Production failed"); return [] as PlumbingSheet3Row[];
        })
      : Promise.resolve([] as PlumbingSheet3Row[]),
    segment === "PTMT"
      ? fetchDailyActuals(month).catch(err => {
          logger.warn({ err }, "corrective-engine: fetchDailyActuals failed"); return [] as DailyActualRow[];
        })
      : Promise.resolve([] as DailyActualRow[]),
    fetchLivePendingOrderTotals().catch(err => {
      logger.warn({ err }, "corrective-engine: fetchLivePendingOrderTotals failed");
      return { exact: new Map<string, number>(), byCode: new Map<string, number>() };
    }),
    loadLatestUploadRowsByKind("pending_orders"),
    loadLatestUploadRowsByKind("last_month_pending"),
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
      const strictCode = normalizeCodeStrict(row.itemCode);
      producedByStrictCode.set(strictCode, (producedByStrictCode.get(strictCode) ?? 0) + row.qty);
      const strictKey = `${strictCode}::${normalizeCode(row.colour)}`;
      producedByStrictKey.set(strictKey, (producedByStrictKey.get(strictKey) ?? 0) + row.qty);
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

  // ── P2: Compute Plumbing capPerDay from p90 of Sheet3 daily production ────
  const plumbingCapByCategory = new Map<string, number>();
  if (segment === "Plumbing") {
    for (const [category, dayMap] of dailyByCat) {
      const sorted = [...dayMap.values()].sort((a, b) => a - b);
      plumbingCapByCategory.set(category, p90(sorted));
    }
  }

  // ── Pending maps ──────────────────────────────────────────────────────────
  const pendingAtPlanMap = sumPendingUploads(pendingOrderRows);

  const lastMoPendingMap = new Map<string, number>();
  for (const row of pendingLastMoRows) {
    const code = (["Item Code", "Cat No", "Cat-No", "Old Item Code"].map(k => row[k]).find(v => v != null && v !== "") as string | undefined);
    const colour = (["Colour", "Color"].map(k => row[k]).find(v => v != null && v !== "") as string | undefined) ?? "";
    const rawQty = (["Qty", "Balance_Qty", "Balance Qty"].map(k => row[k]).find(v => v != null));
    if (!code) continue;
    const qty = typeof rawQty === "number" ? rawQty : Number(String(rawQty ?? "0").replace(/,/g, "")) || 0;
    const k = itemKey(code, colour);
    lastMoPendingMap.set(k, (lastMoPendingMap.get(k) ?? 0) + qty);
  }

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
    const k = itemKey(orig.itemCode, orig.colour);
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

    const pendingAtPlan = pendingAtPlanMap.get(k) ?? 0;
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
  const getCapPerDay = (category: string): number => {
    const cap = catCapMap.get(category);
    if (cap?.overrideCapacity != null) return cap.overrideCapacity;
    if (segment === "Plumbing") return plumbingCapByCategory.get(category) ?? 0;
    return cap?.suggestedCapacity ?? 0;
  };

  const getWdPerWeek = (category: string): number =>
    catCapMap.get(category)?.workingDaysPerWeek ?? workingDaysPerWeek;

  const globalWorkingDays = catCapRows[0]?.workingDaysPerWeek ?? workingDaysPerWeek;
  const totalDailyApplied = segment === "Plumbing"
    ? [...new Set(originalItems.map(i => i.category))].reduce((s, cat) => s + getCapPerDay(cat), 0) || dailyCapacity
    : catCapRows.reduce((s, r) => s + (r.overrideCapacity ?? r.suggestedCapacity), 0) || dailyCapacity;
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

  const categories: CorrectiveCategoryResult[] = [];
  for (const [category, c] of catGroupMap) {
    const plan = Math.round(c.planRevTotal);
    const produced = Math.round(c.producedTotal);
    const producedCapped = Math.round(
      items.filter(i => i.category === category).reduce((s, i) => s + Math.min(i.producedToDate, i.planRev), 0)
    );
    const remaining = plan - producedCapped;
    const capPerDay = getCapPerDay(category);
    const feasible = capPerDay * workingDaysRemaining;
    const shortfall = Math.max(remaining - feasible, 0);
    const productionLag = Math.max(Math.round(c.originalPlanTotal) - produced, 0);
    const newDemandDelta = Math.round(c.newDemandDeltaTotal);
    const kgRemaining = Math.round(c.kgRemainingTotal * 100) / 100;

    const flags: string[] = [];
    if (shortfall > 0) flags.push("UNFULFILLABLE_THIS_MONTH");
    if (produced === 0 && plan > 0) flags.push("NOT_STARTED");
    if (capPerDay === 0 && plan > 0) flags.push("NO_DEMONSTRATED_CAPACITY");

    categories.push({
      category,
      plan,
      produced,
      producedCapped,
      remaining,
      capPerDay,
      capacityPerDay: capPerDay,   // alias for consumers expecting this field name
      feasible,
      shortfall,
      productionLag,
      newDemandDelta,
      capacityShortfall: shortfall,
      flags,
      kgRemaining,
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

  // ── Warnings ──────────────────────────────────────────────────────────────
  const warnings: CorrectiveWarning[] = [];

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
  let run: typeof correctivePlanRunsTable.$inferSelect | undefined;
  if (!input.dryRun) {
  [run] = await db.insert(correctivePlanRunsTable).values({
    segment,
    month,
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
    asOfDate: effectiveAsOfDate ?? null,
    planRunId: input.planRunId ?? null,
    note: note ?? null,
  }).returning();

  if (run && items.length > 0) {
    const runId = run.id;
    const CHUNK = 200;
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      await db.insert(correctivePlanItemsTable).values(
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
  }

  logger.info({
    runId: run?.id, month, segment, items: items.length,
    producedToDate: producedToDateTotal, warnings: warnings.length,
    categories: categories.length, unplanned: unplannedProduction.length,
  }, "corrective-engine: replan complete");

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
  };
}
