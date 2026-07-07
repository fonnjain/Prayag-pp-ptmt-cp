import { countWorkingDaysElapsed, buildCalendarModel } from "./monitoring-calc";
import type { DailyActualRow, PlantTargetRow } from "./plant-ingestion";
import { itemKey, normalizeCode } from "./sheets";

const r2 = (n: number): number => Math.round(n * 100) / 100;
const rNull = (n: number | null): number | null => (n === null ? null : r2(n));

export interface PlantKPIs {
  targetMax: number;
  targetMin: number;
  producedToDate: number;
  requiredPerDay: number;
  requiredCum: number;
  attainmentCumPct: number | null;
  attainmentMonthPct: number | null;
  actualPerDay: number | null;
  bestDayOutput: number;
  projectedMonthEnd: number | null;
  projectedAttainmentPct: number | null;
  projectedMinAttainmentPct: number | null;
  daysAheadBehind: number | null;
  catchUpPerDay: number | null;
  catchUpVsPlanPct: number | null;
  linearityIndex: number | null;
  ragBand: "green" | "amber" | "red" | null;
}

export interface CategoryKPIs extends PlantKPIs {
  category: string;
  gapPcs: number;
}

export interface ItemKPIs {
  itemCode: string;
  colour: string;
  category: string;
  targetMax: number;
  producedToDate: number;
  gapPcs: number;
  attainmentMonthPct: number | null;
  daysWithNoProduction: number;
}

export interface DayRecord {
  date: string;
  workingDayNum: number;
  actualPcs: number;
  requiredPerDay: number;
  cumulativeActual: number;
  cumulativeRequired: number;
}

export interface MixFlag {
  itemCode: string;
  colour: string;
  category: string;
  targetMax: number;
  producedToDate: number;
  reason: "zero_output_high_plan" | "over_producing_high_plan";
}

export interface PlantBundle {
  month: string;
  context: {
    month: string;
    snapshotDate: string | null;
    workingDays: number;
    elapsed: number;
    remaining: number;
    shiftsPerDay: number;
    shiftHours: number;
  };
  plant: PlantKPIs;
  categories: CategoryKPIs[];
  items: ItemKPIs[];
  dailySeries: DayRecord[];
  variancePareto: ItemKPIs[];
  mixFlags: MixFlag[];
  needsReview: { itemCode: string; colour: string; category: string }[];
  caveats: string[];
  dataAvailable: boolean;
}

export interface PlantCalendarConfig {
  workingDays: number;
  elapsed: number;
  shiftsPerDay: number;
  shiftHours: number;
  snapshotDate: string | null;
}

function ragBand(pct: number | null): "green" | "amber" | "red" | null {
  if (pct === null) return null;
  if (pct >= 95) return "green";
  if (pct >= 85) return "amber";
  return "red";
}

function computeKPIs(
  targetMax: number,
  targetMin: number,
  producedToDate: number,
  calendar: ReturnType<typeof buildCalendarModel>,
  dailyOutputs: number[],
): PlantKPIs {
  const { workingDays, elapsed, remaining } = calendar;
  const requiredPerDay = workingDays > 0 ? r2(targetMax / workingDays) : 0;
  const requiredCum = r2(requiredPerDay * elapsed);

  const attainmentCumPct = requiredCum > 0 ? r2((producedToDate / requiredCum) * 100) : null;
  const attainmentMonthPct = targetMax > 0 ? r2((producedToDate / targetMax) * 100) : null;
  const actualPerDay = elapsed > 0 ? r2(producedToDate / elapsed) : null;
  const projectedMonthEnd = actualPerDay !== null ? r2(actualPerDay * workingDays) : null;
  const projectedAttainmentPct = projectedMonthEnd !== null && targetMax > 0 ? r2((projectedMonthEnd / targetMax) * 100) : null;
  const projectedMinAttainmentPct = projectedMonthEnd !== null && targetMin > 0 ? r2((projectedMonthEnd / targetMin) * 100) : null;
  const daysAheadBehind = requiredPerDay > 0 ? rNull((producedToDate - requiredCum) / requiredPerDay) : null;
  const catchUpPerDay = remaining > 0 ? r2((targetMax - producedToDate) / remaining) : null;
  const catchUpVsPlanPct = catchUpPerDay !== null && requiredPerDay > 0 ? r2((catchUpPerDay / requiredPerDay) * 100) : null;
  const bestDayOutput = dailyOutputs.length > 0 ? Math.max(...dailyOutputs) : 0;

  let linearityIndex: number | null = null;
  if (elapsed > 0 && requiredPerDay > 0 && dailyOutputs.length > 0) {
    const cap = requiredPerDay;
    const cappedSum = dailyOutputs.slice(0, elapsed).reduce((s, v) => s + Math.min(v, cap), 0);
    linearityIndex = r2(cappedSum / requiredCum);
  }

  return {
    targetMax: r2(targetMax),
    targetMin: r2(targetMin),
    producedToDate: r2(producedToDate),
    requiredPerDay,
    requiredCum,
    attainmentCumPct,
    attainmentMonthPct,
    actualPerDay,
    bestDayOutput: r2(bestDayOutput),
    projectedMonthEnd,
    projectedAttainmentPct,
    projectedMinAttainmentPct,
    daysAheadBehind,
    catchUpPerDay,
    catchUpVsPlanPct,
    linearityIndex,
    ragBand: ragBand(attainmentCumPct),
  };
}

function isSunday(dateIso: string): boolean {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay() === 0;
}

function workingDaysInMonth(month: string): string[] {
  const [y, m] = month.split("-").map(Number);
  const days: string[] = [];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  for (let d = 1; d <= lastDay; d++) {
    const iso = `${month}-${String(d).padStart(2, "0")}`;
    if (!isSunday(iso)) days.push(iso);
  }
  return days;
}

export function buildPlantBundle(
  month: string,
  actuals: DailyActualRow[],
  targets: PlantTargetRow[],
  config: PlantCalendarConfig,
): PlantBundle {
  const { workingDays, shiftsPerDay, shiftHours } = config;

  const lastDate = actuals.length > 0 ? [...actuals].map((r) => r.date).sort().pop()! : null;
  const snapshotDate = config.snapshotDate ?? lastDate;
  const elapsed = snapshotDate ? countWorkingDaysElapsed(month, snapshotDate) : 0;
  const calendar = buildCalendarModel(workingDays, elapsed);

  const allWorkingDays = workingDaysInMonth(month);

  const targetByKey = new Map<string, PlantTargetRow>();
  const targetByCode = new Map<string, PlantTargetRow>();
  for (const t of targets) {
    targetByKey.set(itemKey(t.itemCode, t.colour), t);
    if (!targetByCode.has(normalizeCode(t.itemCode))) targetByCode.set(normalizeCode(t.itemCode), t);
  }

  let plantTargetMax = 0;
  let plantTargetMin = 0;
  for (const t of targets) {
    plantTargetMax += t.maxPcs;
    plantTargetMin += t.minPcs;
  }

  const dailyByDate = new Map<string, number>();
  for (const row of actuals) {
    dailyByDate.set(row.date, (dailyByDate.get(row.date) ?? 0) + row.qty);
  }

  const elapsedWorkingDays = allWorkingDays.slice(0, elapsed);
  const dailyOutputsArr = elapsedWorkingDays.map((d) => dailyByDate.get(d) ?? 0);

  let plantProduced = 0;
  for (const v of dailyOutputsArr) plantProduced += v;

  const plantKPIs = computeKPIs(plantTargetMax, plantTargetMin, plantProduced, calendar, dailyOutputsArr);

  const dailySeries: DayRecord[] = [];
  let cumActual = 0;
  let wdNum = 0;
  const reqPerDay = plantKPIs.requiredPerDay;
  for (const d of allWorkingDays) {
    wdNum++;
    const dayActual = dailyByDate.get(d) ?? 0;
    if (wdNum <= elapsed) cumActual += dayActual;
    dailySeries.push({
      date: d,
      workingDayNum: wdNum,
      actualPcs: wdNum <= elapsed ? dayActual : 0,
      requiredPerDay: reqPerDay,
      cumulativeActual: wdNum <= elapsed ? cumActual : 0,
      cumulativeRequired: r2(reqPerDay * wdNum),
    });
  }

  const categoryMap = new Map<string, { targetMax: number; targetMin: number; produced: number; dailyOutputs: number[] }>();
  for (const t of targets) {
    const existing = categoryMap.get(t.category) ?? { targetMax: 0, targetMin: 0, produced: 0, dailyOutputs: Array(elapsed).fill(0) };
    existing.targetMax += t.maxPcs;
    existing.targetMin += t.minPcs;
    categoryMap.set(t.category, existing);
  }

  for (const row of actuals) {
    const t = targetByKey.get(itemKey(row.itemCode, row.colour)) ?? targetByCode.get(normalizeCode(row.itemCode));
    const cat = t?.category ?? "Unknown";
    const entry = categoryMap.get(cat);
    if (!entry) continue;
    const dayIdx = elapsedWorkingDays.indexOf(row.date);
    entry.produced += row.qty;
    if (dayIdx >= 0) entry.dailyOutputs[dayIdx] = (entry.dailyOutputs[dayIdx] ?? 0) + row.qty;
  }

  const categories: CategoryKPIs[] = [];
  for (const [cat, data] of categoryMap.entries()) {
    const kpis = computeKPIs(data.targetMax, data.targetMin, data.produced, calendar, data.dailyOutputs);
    categories.push({ ...kpis, category: cat, gapPcs: r2(data.targetMax - data.produced) });
  }
  categories.sort((a, b) => (a.attainmentCumPct ?? 999) - (b.attainmentCumPct ?? 999));

  const itemProducedByKey = new Map<string, number>();
  const itemDayCountByKey = new Map<string, Set<string>>();
  for (const row of actuals) {
    const k = itemKey(row.itemCode, row.colour);
    itemProducedByKey.set(k, (itemProducedByKey.get(k) ?? 0) + row.qty);
    if (!itemDayCountByKey.has(k)) itemDayCountByKey.set(k, new Set());
    itemDayCountByKey.get(k)!.add(row.date);
  }

  const itemKPIs: ItemKPIs[] = [];
  const needsReview: PlantBundle["needsReview"] = [];

  for (const t of targets) {
    const k = itemKey(t.itemCode, t.colour);
    const produced = itemProducedByKey.get(k) ?? 0;
    const attainmentMonthPct = t.maxPcs > 0 ? r2((produced / t.maxPcs) * 100) : null;
    const daysWithProduction = itemDayCountByKey.get(k)?.size ?? 0;
    const daysWithNoProduction = Math.max(0, elapsed - daysWithProduction);
    itemKPIs.push({
      itemCode: t.itemCode,
      colour: t.colour,
      category: t.category,
      targetMax: t.maxPcs,
      producedToDate: produced,
      gapPcs: r2(t.maxPcs - produced),
      attainmentMonthPct,
      daysWithNoProduction,
    });
  }

  for (const row of actuals) {
    const t = targetByKey.get(itemKey(row.itemCode, row.colour));
    const tc = targetByCode.get(normalizeCode(row.itemCode));
    if (!t && !tc) {
      needsReview.push({ itemCode: row.itemCode, colour: row.colour, category: "Unknown" });
    }
  }

  const variancePareto = [...itemKPIs].sort((a, b) => b.gapPcs - a.gapPcs).slice(0, 20);

  const avgTargetPerItem = plantTargetMax / Math.max(targets.length, 1);
  const highPlanThreshold = avgTargetPerItem * 0.75;
  const mixFlags: MixFlag[] = [];

  // Categories that have at least one zero-output high-plan item
  const zeroOutputCategories = new Set<string>();
  for (const item of itemKPIs) {
    if (item.targetMax >= highPlanThreshold && item.producedToDate === 0) {
      zeroOutputCategories.add(item.category);
    }
  }

  for (const item of itemKPIs) {
    if (item.targetMax >= highPlanThreshold && item.producedToDate === 0) {
      mixFlags.push({ itemCode: item.itemCode, colour: item.colour, category: item.category, targetMax: item.targetMax, producedToDate: 0, reason: "zero_output_high_plan" });
    } else if (
      item.targetMax >= highPlanThreshold &&
      item.producedToDate > item.targetMax * 1.1 &&
      zeroOutputCategories.has(item.category)
    ) {
      // Over-producing (>110% of plan) in a category where other high-plan items sit at zero
      mixFlags.push({ itemCode: item.itemCode, colour: item.colour, category: item.category, targetMax: item.targetMax, producedToDate: item.producedToDate, reason: "over_producing_high_plan" });
    }
  }
  mixFlags.sort((a, b) => b.targetMax - a.targetMax);

  const caveats: string[] = [];
  if (elapsed === 0) caveats.push("No elapsed working days detected — KPIs will be null until production data is available.");
  if (plantTargetMax === 0) caveats.push("Monthly target (Max PP) is zero — attainment and pace metrics are unavailable.");
  if (needsReview.length > 0) caveats.push(`${needsReview.length} produced item(s) have no matching plan entry — excluded from category totals.`);

  return {
    month,
    context: {
      month,
      snapshotDate,
      workingDays,
      elapsed,
      remaining: calendar.remaining,
      shiftsPerDay,
      shiftHours,
    },
    plant: plantKPIs,
    categories,
    items: itemKPIs.slice(0, 100),
    dailySeries,
    variancePareto,
    mixFlags: mixFlags.slice(0, 20),
    needsReview: needsReview.slice(0, 50),
    caveats,
    dataAvailable: actuals.length > 0,
  };
}
