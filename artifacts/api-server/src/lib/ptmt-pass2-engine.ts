import type { CapacityMonthlyStats, CategoryCapacity } from "@workspace/db";
import { countWorkingDaysInWeek } from "./working-days";

export type Pass2Week = 1 | 2 | 3 | 4;
export type Pass2CapacityWindow = "fullWindow" | "recent90d";

export interface PtmtPass2WindowOptions {
  /**
   * Optional capacity already consumed before the corrective run. Values are
   * final weekly piece capacities, not additional production demand.
   */
  weeklyCapacityOverrides?: Partial<Record<Pass2Week, Map<string, number>>>;
}

export interface PtmtPass2InputItem {
  itemCode: string;
  colour: string;
  category: string;
  avg3MoSale: number;
  stock: number;
  pendingCurrent: number;
  pendingLastMonth: number;
  bufferReq: number | null;
  minProduction: number;
  temporaryPlan: number;
}

export interface PtmtPass2ItemResult extends PtmtPass2InputItem {
  dummy: number;
  orders: number;
  buffer: number;
  productionPlan: number;
  cannotBeMade: number;
  releaseWeek: Pass2Week | null;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
}

export interface PtmtPass2CategoryResult {
  category: string;
  fullP90: number;
  recent90dP90: number;
  driftPct: number | null;
  recoveryDriftPct: number | null;
  monthlyP90CvPct: number | null;
  latestMonthlyP90: number | null;
  minPositiveMonthlyP90: number | null;
  zeroProductionMonths: string[];
  monthly: CapacityMonthlyStats[];
  selectedWindow: Pass2CapacityWindow;
  selectedP90: number;
  overrideCapacity: number | null;
  capacityPerDay: number;
  workingDays: [number, number, number, number];
  weeklyCapacity: [number, number, number, number];
  weeklyRelease: [number, number, number, number];
  temporaryPlan: number;
  productionPlan: number;
  cannotBeMade: number;
}

export interface PtmtPass2Invariants {
  conservation: boolean;
  weeklyCapacity: boolean;
  weeklySum: boolean;
  dummyPriority: boolean;
  temporaryPlanUnchanged: boolean;
  temporaryPlanTotal: number;
  productionPlanTotal: number;
  cannotBeMadeTotal: number;
}

export interface PtmtPass2Result {
  items: PtmtPass2ItemResult[];
  categories: PtmtPass2CategoryResult[];
  workingDays: number;
  workedSundayDates: string[];
  invariants: PtmtPass2Invariants;
}

export class PtmtPass2InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PtmtPass2InputError";
  }
}

type CapacityComparison = NonNullable<CategoryCapacity["comparisonJson"]>;

function roundQuantity(value: number): number {
  return Math.max(0, Math.round(Number.isFinite(value) ? value : 0));
}

function roundCapacity(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function compareNumber(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function deriveMonthlyP90CvPct(monthly: CapacityMonthlyStats[]): number | null {
  const values = monthly
    .filter((month) => month.daysObserved > 0 && month.p90PerDay > 0)
    .map((month) => month.p90PerDay);
  if (values.length < 2) return null;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const standardDeviation = Math.sqrt(
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length,
  );
  return average > 0 ? Math.round((standardDeviation / average) * 1000) / 10 : null;
}

export function selectPtmtCapacityWindow(row: Pick<CategoryCapacity, "category" | "p90PerDay" | "suggestedCapacity" | "overrideCapacity" | "comparisonJson">): {
  category: string;
  fullP90: number;
  recent90dP90: number;
  driftPct: number | null;
  recoveryDriftPct: number | null;
  monthlyP90CvPct: number | null;
  latestMonthlyP90: number | null;
  minPositiveMonthlyP90: number | null;
  zeroProductionMonths: string[];
  selectedWindow: Pass2CapacityWindow;
  selectedP90: number;
  capacityPerDay: number;
  overrideCapacity: number | null;
  monthly: CapacityMonthlyStats[];
} {
  const comparison = row.comparisonJson as CapacityComparison | null;
  const fullP90 = compareNumber(comparison?.fullWindow?.p90PerDay) || compareNumber(row.p90PerDay) || compareNumber(row.suggestedCapacity);
  const recent90dP90 = compareNumber(comparison?.recent90d?.p90PerDay);
  const driftPct = typeof comparison?.driftPct === "number" && Number.isFinite(comparison.driftPct)
    ? comparison.driftPct
    : null;
  const latestMonthlyP90 = compareNumber(comparison?.latestMonthlyP90)
    || [...(comparison?.monthly ?? [])]
      .filter((month) => month.daysObserved > 0 && month.p90PerDay > 0)
      .at(-1)?.p90PerDay
    || 0;
  const positiveMonthly = [...(comparison?.monthly ?? [])]
    .filter((month) => month.daysObserved > 0 && month.p90PerDay > 0);
  const minPositiveMonthlyP90 = typeof comparison?.minPositiveMonthlyP90 === "number"
    ? comparison.minPositiveMonthlyP90
    : positiveMonthly.length > 0
      ? Math.min(...positiveMonthly.map((month) => month.p90PerDay))
      : null;
  const recoveryDriftPct = typeof comparison?.recoveryDriftPct === "number"
    ? comparison.recoveryDriftPct
    : minPositiveMonthlyP90 !== null && minPositiveMonthlyP90 > 0 && latestMonthlyP90 > 0
      ? Math.round(((latestMonthlyP90 - minPositiveMonthlyP90) / minPositiveMonthlyP90) * 1000) / 10
      : null;
  const zeroProductionMonths = comparison?.zeroProductionMonths
    ?? (comparison?.monthly ?? []).filter((month) => month.daysObserved === 0).map((month) => month.month);
  const monthly = comparison?.monthly ?? [];
  const monthlyP90CvPct = typeof comparison?.monthlyP90CvPct === "number" && Number.isFinite(comparison.monthlyP90CvPct)
    ? comparison.monthlyP90CvPct
    : deriveMonthlyP90CvPct(monthly);
  const useRecent = recent90dP90 > 0 && (
    (driftPct !== null && Math.abs(driftPct) > 20)
    || (fullP90 > 0 && latestMonthlyP90 > fullP90)
  );
  const selectedP90 = useRecent ? recent90dP90 : fullP90;
  const overrideCapacity = row.overrideCapacity == null ? null : roundCapacity(row.overrideCapacity);

  return {
    category: row.category,
    fullP90: roundCapacity(fullP90),
    recent90dP90: roundCapacity(recent90dP90),
    driftPct,
    recoveryDriftPct,
    monthlyP90CvPct,
    latestMonthlyP90: latestMonthlyP90 || null,
    minPositiveMonthlyP90,
    zeroProductionMonths,
    monthly,
    selectedWindow: useRecent ? "recent90d" : "fullWindow",
    selectedP90: roundCapacity(selectedP90),
    capacityPerDay: overrideCapacity ?? roundCapacity(selectedP90),
    overrideCapacity,
  };
}

function coverKey(item: PtmtPass2InputItem): number {
  return item.avg3MoSale > 0 ? item.stock / item.avg3MoSale : Number.POSITIVE_INFINITY;
}

function key(item: PtmtPass2InputItem): string {
  return `${item.itemCode}::${item.colour}::${item.category}`;
}

function componentDemand(item: PtmtPass2InputItem): { dummy: number; orders: number; buffer: number } {
  const total = roundQuantity(item.temporaryPlan);
  const dummy = Math.min(total, roundQuantity(item.pendingLastMonth));
  const orders = Math.min(Math.max(total - dummy, 0), roundQuantity(item.pendingCurrent));
  return {
    dummy,
    orders,
    buffer: Math.max(total - dummy - orders, 0),
  };
}

function sumWeeks(item: Pick<PtmtPass2ItemResult, "w1" | "w2" | "w3" | "w4">): number {
  return item.w1 + item.w2 + item.w3 + item.w4;
}

/**
 * Fit a frozen PTMT demand plan into category-level weekly p90 capacity.
 *
 * The input objects are never mutated. Demand lines are globally ordered by
 * business priority, while capacity is independently tracked per category.
 */
export function runPtmtPass2(
  month: string,
  inputItems: PtmtPass2InputItem[],
  capacityRows: CategoryCapacity[],
  workedSundayDates: Iterable<string> = [],
  options: PtmtPass2WindowOptions = {},
): PtmtPass2Result {
  const workedSundays = [...new Set(workedSundayDates)].sort();
  const capacities = new Map(capacityRows.map((row) => [row.category, selectPtmtCapacityWindow(row)]));
  const positiveCategories = new Set(inputItems.filter((item) => roundQuantity(item.temporaryPlan) > 0).map((item) => item.category));

  for (const category of positiveCategories) {
    if (!capacities.has(category)) {
      throw new PtmtPass2InputError(`PTMT category capacity is missing for "${category}"; recompute capacity before fitting the plan.`);
    }
  }

  const weeks: Pass2Week[] = [1, 2, 3, 4];
  const workingDaysByWeek = weeks.map((week) => countWorkingDaysInWeek(month, week, workedSundays)) as [number, number, number, number];
  const weeklyRemaining = new Map<string, [number, number, number, number]>();
  const categoryResults = new Map<string, PtmtPass2CategoryResult>();

  for (const [category, capacity] of capacities) {
    const weeklyCapacity = workingDaysByWeek.map((days, index) => {
      const week = (index + 1) as Pass2Week;
      const override = options.weeklyCapacityOverrides?.[week]?.get(category);
      return override == null
        ? roundCapacity(capacity.capacityPerDay * days)
        : roundCapacity(Math.max(0, override));
    }) as [number, number, number, number];
    weeklyRemaining.set(category, [...weeklyCapacity] as [number, number, number, number]);
    categoryResults.set(category, {
      category,
      fullP90: capacity.fullP90,
      recent90dP90: capacity.recent90dP90,
      driftPct: capacity.driftPct,
      recoveryDriftPct: capacity.recoveryDriftPct,
      monthlyP90CvPct: capacity.monthlyP90CvPct,
      latestMonthlyP90: capacity.latestMonthlyP90,
      minPositiveMonthlyP90: capacity.minPositiveMonthlyP90,
      zeroProductionMonths: capacity.zeroProductionMonths,
      monthly: capacity.monthly,
      selectedWindow: capacity.selectedWindow,
      selectedP90: capacity.selectedP90,
      overrideCapacity: capacity.overrideCapacity,
      capacityPerDay: capacity.capacityPerDay,
      workingDays: workingDaysByWeek,
      weeklyCapacity,
      weeklyRelease: [0, 0, 0, 0],
      temporaryPlan: 0,
      productionPlan: 0,
      cannotBeMade: 0,
    });
  }

  const items: PtmtPass2ItemResult[] = inputItems.map((item) => {
    const total = roundQuantity(item.temporaryPlan);
    const components = componentDemand(item);
    const category = categoryResults.get(item.category);
    if (category) category.temporaryPlan += total;
    return {
      ...item,
      temporaryPlan: total,
      dummy: components.dummy,
      orders: components.orders,
      buffer: components.buffer,
      productionPlan: 0,
      cannotBeMade: total,
      releaseWeek: null,
      w1: 0,
      w2: 0,
      w3: 0,
      w4: 0,
    };
  });

  const byKey = new Map(items.map((item) => [key(item), item]));
  const lines = items.flatMap((item) => {
    const components = componentDemand(item);
    return [
      { itemKey: key(item), category: item.category, priority: 0, quantity: components.dummy },
      { itemKey: key(item), category: item.category, priority: 1, quantity: components.orders },
      { itemKey: key(item), category: item.category, priority: 2, quantity: components.buffer },
    ].filter((line) => line.quantity > 0);
  }).sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    const itemA = byKey.get(a.itemKey)!;
    const itemB = byKey.get(b.itemKey)!;
    if (a.priority === 2) {
      const coverDelta = coverKey(itemA) - coverKey(itemB);
      if (coverDelta !== 0) return coverDelta;
    } else if (a.quantity !== b.quantity) {
      return b.quantity - a.quantity;
    }
    return a.itemKey.localeCompare(b.itemKey);
  });

  for (const line of lines) {
    const item = byKey.get(line.itemKey)!;
    const remaining = weeklyRemaining.get(line.category)!;
    let residual = line.quantity;
    for (const week of weeks) {
      if (residual <= 0) break;
      const index = week - 1;
      const allocation = Math.min(residual, Math.floor(Math.max(remaining[index], 0) + 1e-9));
      if (allocation <= 0) continue;
      remaining[index] = roundCapacity(remaining[index] - allocation);
      item[`w${week}` as "w1" | "w2" | "w3" | "w4"] += allocation;
      if (item.releaseWeek === null) item.releaseWeek = week;
      const categoryResult = categoryResults.get(line.category)!;
      categoryResult.weeklyRelease[index] = roundCapacity(categoryResult.weeklyRelease[index] + allocation);
      residual -= allocation;
    }
  }

  for (const item of items) {
    item.productionPlan = sumWeeks(item);
    item.cannotBeMade = item.temporaryPlan - item.productionPlan;
    const category = categoryResults.get(item.category)!;
    category.productionPlan += item.productionPlan;
    category.cannotBeMade += item.cannotBeMade;
  }

  const categories = [...categoryResults.values()].map((category) => ({
    ...category,
    temporaryPlan: roundQuantity(category.temporaryPlan),
    productionPlan: roundQuantity(category.productionPlan),
    cannotBeMade: roundQuantity(category.cannotBeMade),
  }));
  const temporaryPlanTotal = items.reduce((sum, item) => sum + item.temporaryPlan, 0);
  const productionPlanTotal = items.reduce((sum, item) => sum + item.productionPlan, 0);
  const cannotBeMadeTotal = items.reduce((sum, item) => sum + item.cannotBeMade, 0);
  const weeklyCapacityOk = categories.every((category) =>
    category.weeklyRelease.every((release, index) => release <= category.weeklyCapacity[index] + 1e-9),
  );
  const dummyResidualByCategory = new Map<string, number>();
  const bufferScheduledByCategory = new Map<string, number>();
  for (const item of items) {
    dummyResidualByCategory.set(item.category, (dummyResidualByCategory.get(item.category) ?? 0) + Math.max(item.dummy - item.w1 - item.w2 - item.w3 - item.w4, 0));
    const scheduled = Math.max(item.productionPlan - item.dummy, 0);
    bufferScheduledByCategory.set(item.category, (bufferScheduledByCategory.get(item.category) ?? 0) + Math.max(scheduled - item.orders, 0));
  }
  const dummyPriority = [...dummyResidualByCategory.keys()].every((category) =>
    (dummyResidualByCategory.get(category) ?? 0) <= 0 || (bufferScheduledByCategory.get(category) ?? 0) <= 0,
  );

  return {
    items,
    categories,
    workingDays: workingDaysByWeek.reduce((sum, days) => sum + days, 0),
    workedSundayDates: workedSundays,
    invariants: {
      conservation: productionPlanTotal + cannotBeMadeTotal === temporaryPlanTotal,
      weeklyCapacity: weeklyCapacityOk,
      weeklySum: items.every((item) => sumWeeks(item) === item.productionPlan),
      dummyPriority,
      temporaryPlanUnchanged: true,
      temporaryPlanTotal,
      productionPlanTotal,
      cannotBeMadeTotal,
    },
  };
}