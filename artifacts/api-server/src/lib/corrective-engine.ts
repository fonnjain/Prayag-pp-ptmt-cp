import { db, itemMasterTable, bufferCategoriesTable, weeklyReleaseBandsTable, correctivePlanRunsTable, correctivePlanItemsTable, categoryCapacityTable } from "@workspace/db";
import type { CorrectiveWeekStat, CorrectiveWarning } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchDailyActuals } from "./plant-ingestion";
import { fetchLivePendingOrderTotals, itemKey, normalizeCode } from "./sheets";
import { buildPlanItems, loadLatestUploadRowsByKind } from "../routes/plan";
import { logger } from "./logger";

const round = (n: number) => Math.round(n * 100) / 100;

export interface CorrectiveReplanInput {
  month: string;
  weekClosed: number;
  segment?: string;
  dailyCapacity?: number;
  workingDaysPerWeek?: number;
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

export interface CorrectiveReplanResult {
  runId: number;
  month: string;
  segment: string;
  weekClosed: number;
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

/** Compute revised plan quantity for a single item.
 * Plumbing SWR/AGRI use an inverted formula: demand-driven not buffer-driven.
 * PTMT and Plumbing CPVC/UPVC use the standard buffer formula.
 */
function computePlanRev(opts: {
  segment: string;
  category: string;
  bufferReqRev: number;
  stockNow: number;
  pendingNow: number;
  pendingLastMonth: number;
}): number {
  const { segment, category, bufferReqRev, stockNow, pendingNow, pendingLastMonth } = opts;
  const isSwrAgri = segment === "Plumbing" && (category.startsWith("SWR") || category.startsWith("AGRI"));
  if (isSwrAgri) {
    // SWR/AGRI: produce what demand (pending) exceeds buffer, plus carry-over from last month
    return round(Math.max(stockNow + pendingNow - bufferReqRev + pendingLastMonth, 0));
  }
  // Standard (PTMT + Plumbing CPVC/UPVC): replenish to buffer considering current position
  return round(Math.max(bufferReqRev - stockNow + pendingLastMonth + pendingNow, 0));
}

export async function runCorrectiveReplan(input: CorrectiveReplanInput): Promise<CorrectiveReplanResult> {
  const { month, weekClosed } = input;
  const segment = input.segment ?? "PTMT";
  const dailyCapacity = input.dailyCapacity ?? 21335;
  const workingDaysPerWeek = input.workingDaysPerWeek ?? 6;

  logger.info({ month, weekClosed, segment, dailyCapacity }, "corrective-engine: starting replan");

  // ── Fetch everything in parallel ────────────────────────────────────────────
  const [originalItems, dailyActuals, livePendingTotals, pendingOrderRows, pendingLastMoRows, bufferRows, bandRows, itemRows, catCapRows] =
    await Promise.all([
      buildPlanItems(month, segment),
      // For PTMT: reads PTMT ANUJ sheet. For Plumbing: actuals are not item-level, falls back to [] gracefully.
      fetchDailyActuals(month).catch(err => { logger.warn({ err }, "corrective-engine: fetchDailyActuals failed, using zeros"); return []; }),
      fetchLivePendingOrderTotals().catch(err => { logger.warn({ err }, "corrective-engine: fetchLivePendingOrderTotals failed, using zeros"); return { exact: new Map<string, number>(), byCode: new Map<string, number>() }; }),
      loadLatestUploadRowsByKind("pending_orders"),
      loadLatestUploadRowsByKind("last_month_pending"),
      db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, segment)),
      db.select().from(weeklyReleaseBandsTable).where(eq(weeklyReleaseBandsTable.segment, segment)),
      db.select().from(itemMasterTable).where(eq(itemMasterTable.segment, segment)),
      db.select().from(categoryCapacityTable).where(eq(categoryCapacityTable.segment, segment)),
    ]);

  // ── Map original plan items by key ──────────────────────────────────────────
  const originalByKey = new Map(originalItems.map(i => [itemKey(i.itemCode, i.colour), i]));

  // ── Count code variants per category (for single-variant resolution) ────────
  const codeCounts = new Map<string, number>();
  for (const item of itemRows) {
    const ck = `${item.category}::${normalizeCode(item.itemCode)}`;
    codeCounts.set(ck, (codeCounts.get(ck) ?? 0) + 1);
  }
  const isSingleVariant = (category: string, itemCode: string) =>
    (codeCounts.get(`${category}::${normalizeCode(itemCode)}`) ?? 0) <= 1;

  // ── Aggregate produced_to_date per item ──────────────────────────────────────
  const producedMap = new Map<string, number>();
  for (const row of dailyActuals) {
    const k = itemKey(row.itemCode, row.colour);
    producedMap.set(k, (producedMap.get(k) ?? 0) + row.qty);
    // Also try code-only lookup for single-variant items
    const ck = normalizeCode(row.itemCode);
    const byCodeKey = `__code__${ck}`;
    producedMap.set(byCodeKey, (producedMap.get(byCodeKey) ?? 0) + row.qty);
  }

  // ── Pending "at plan time" (from uploaded ERP file) ──────────────────────────
  const pendingAtPlanMap = sumPendingUploads(pendingOrderRows);

  // ── Last-month pending (constant for the month) ──────────────────────────────
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

  // ── Buffer multipliers ────────────────────────────────────────────────────────
  const bufferByCategory = new Map(bufferRows.map(b => [b.name, b.multiplier]));

  // ── Band configs ──────────────────────────────────────────────────────────────
  const bandsByCategory = new Map(bandRows.map(b => [b.categoryName, b]));

  // ── Build corrective items ────────────────────────────────────────────────────
  const items: CorrectiveItemResult[] = [];

  // Process all items from original plan
  for (const orig of originalItems) {
    const k = itemKey(orig.itemCode, orig.colour);
    const sv = isSingleVariant(orig.category, orig.itemCode);
    const codeOnlyKey = `__code__${normalizeCode(orig.itemCode)}`;

    const producedToDate = sv
      ? (producedMap.get(codeOnlyKey) ?? producedMap.get(k) ?? 0)
      : (producedMap.get(k) ?? 0);

    const stockOpen = orig.stock;
    const stockNow = round(stockOpen + producedToDate);

    // Live pending — use exact map from fetchLivePendingOrderTotals
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

    const planRev = computePlanRev({
      segment,
      category: orig.category,
      bufferReqRev,
      stockNow,
      pendingNow,
      pendingLastMonth,
    });

    const remainingToProduce = round(Math.max(planRev - producedToDate, 0));

    const deltaNewOrders = round(pendingNow - pendingAtPlan);
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

  // ── Per-category capacity map ─────────────────────────────────────────────────
  const catCapMap = new Map(catCapRows.map(r => [r.category, r]));
  const globalWorkingDays = catCapRows[0]?.workingDaysPerWeek ?? workingDaysPerWeek;
  const totalDailyApplied = catCapRows.reduce((s, r) => s + (r.overrideCapacity ?? r.suggestedCapacity), 0) || dailyCapacity;
  const weekCapacity = globalWorkingDays * totalDailyApplied;

  // ── Re-score urgency and assign to remaining weeks ────────────────────────────
  const remainingWeeks: number[] = [];
  for (let w = weekClosed + 1; w <= 4; w++) remainingWeeks.push(w);

  // Sort items with remaining_to_produce > 0 by cover_now ascending (most urgent first)
  const schedulable = items.filter(i => i.remainingToProduce > 0);
  schedulable.sort((a, b) => {
    const ca = a.coverNow ?? 999;
    const cb = b.coverNow ?? 999;
    return ca - cb;
  });

  // Per-category, per-week load buckets: Map<week, Map<category, load>>
  const catWeekBuckets = new Map<number, Map<string, number>>();
  for (const w of remainingWeeks) catWeekBuckets.set(w, new Map());

  // Week assignment: first try band-based, then fall back to capacity-levelled spill
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

    // Per-category capacity levelling: spill forward if THIS CATEGORY's week is full
    const cap = catCapMap.get(item.category);
    const appliedDailyCap = cap
      ? (cap.overrideCapacity ?? cap.suggestedCapacity)
      : (totalDailyApplied / Math.max(catCapRows.length, 1));
    const catWDays = cap?.workingDaysPerWeek ?? globalWorkingDays;
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

      // Status
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

  // Mark items with 0 remaining as completed
  for (const item of items) {
    if (item.remainingToProduce === 0 && item.status === "on-plan") {
      item.status = "replenished";
    }
  }

  // ── Week stats ────────────────────────────────────────────────────────────────
  const weekStats: CorrectiveWeekStat[] = [];
  for (let w = 1; w <= 4; w++) {
    const origReleased = originalItems.reduce((sum, i) => {
      return sum + (w === 1 ? i.w1 : w === 2 ? i.w2 : w === 3 ? i.w3 : i.w4);
    }, 0);

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
      status: w < weekClosed ? "closed" : w === weekClosed ? "closed" : remainingWeeks.includes(w) ? "future" : "closed",
    });
  }

  // ── Totals ────────────────────────────────────────────────────────────────────
  const producedToDateTotal = round(items.reduce((s, i) => s + i.producedToDate, 0));
  const newOrdersQty = round(items.reduce((s, i) => s + Math.max(i.deltaNewOrders, 0), 0));
  const originalMonthTotal = round(originalItems.reduce((s, i) => s + i.maxProduction, 0));
  const revisedMonthTotal = round(items.reduce((s, i) => s + i.planRev, 0));
  const unfulfillableQty = round(items.filter(i => i.status === "unfulfillable").reduce((s, i) => s + i.remainingToProduce, 0));

  // ── Generate warnings ─────────────────────────────────────────────────────────
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
    const catMap = catWeekBuckets.get(w);
    if (!catMap) continue;
    for (const [cat, load] of catMap) {
      const cap = catCapMap.get(cat);
      const appliedDailyCap = cap ? (cap.overrideCapacity ?? cap.suggestedCapacity) : 0;
      const catWDays = cap?.workingDaysPerWeek ?? globalWorkingDays;
      const catWeekCap = appliedDailyCap * catWDays;
      if (catWeekCap > 0 && load > catWeekCap * 1.05) {
        const lf = load / catWeekCap;
        warnings.push({
          code: "CAPACITY_OVERLOAD",
          severity: lf > 2 ? "critical" : lf > 1.5 ? "high" : "medium",
          message: `${cat} W${w}: ${lf.toFixed(1)}× capacity (${Math.round(load).toLocaleString()} vs ${Math.round(catWeekCap).toLocaleString()} pcs/wk)`,
          value: load,
          threshold: catWeekCap,
          category: cat,
        });
      }
    }
  }
  for (const ws of weekStats) {
    if (ws.loadFactor > 1.05 && !remainingWeeks.includes(ws.week)) {
      warnings.push({
        code: "CAPACITY_OVERLOAD",
        severity: ws.loadFactor > 2 ? "critical" : ws.loadFactor > 1.5 ? "high" : "medium",
        message: `W${ws.week}: total load ${ws.loadFactor.toFixed(1)}× plant capacity (${Math.round(ws.released).toLocaleString()} vs ${Math.round(ws.capacity).toLocaleString()}/wk)`,
        value: ws.released,
        threshold: ws.capacity,
      });
    }
  }

  if (unfulfillableQty > 0) {
    const unfulfItems = items.filter(i => i.status === "unfulfillable");
    warnings.push({
      code: "UNFULFILLABLE_THIS_MONTH",
      severity: "critical",
      message: `${Math.round(unfulfillableQty).toLocaleString()} pcs cannot be produced this month — ${unfulfItems.length} items deferred to next month`,
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
        message: `${cat}: ${pct}% new orders added mid-month (+${Math.round(stats.deltaNewOrders).toLocaleString()} pcs vs original plan)`,
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

  // ── Persist to DB ─────────────────────────────────────────────────────────────
  const [run] = await db.insert(correctivePlanRunsTable).values({
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
  }).returning();

  if (run && items.length > 0) {
    const CHUNK = 200;
    for (let i = 0; i < items.length; i += CHUNK) {
      const chunk = items.slice(i, i + CHUNK);
      await db.insert(correctivePlanItemsTable).values(
        chunk.map(item => ({
          runId: run.id,
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

  logger.info({ runId: run?.id, month, segment, items: items.length, warnings: warnings.length }, "corrective-engine: replan complete");

  return {
    runId: run?.id ?? 0,
    month,
    segment,
    weekClosed,
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
  };
}
