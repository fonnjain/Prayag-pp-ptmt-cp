import { db, itemMasterTable, categoryCapacityTable } from "@workspace/db";
import type { CapacityComparison, CapacityMonthlyStats, CapacityWindowStats, CategoryCapacity } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchDailyActuals } from "./plant-ingestion";
import { buildPlanItems } from "../routes/plan";
import { logger } from "./logger";
import { countWorkingDaysInMonth } from "./working-days";
import { selectPtmtCapacityWindow } from "./ptmt-pass2-engine";

const THIN_DATA_THRESHOLD = 10;

type SeedRow = {
  category: string;
  meanPerDay: number;
  p90PerDay: number;
  bestDay: number;
  daysObserved: number;
  planNeedsPerDay: number;
};

/** PTMT seed values derived from ANUJ daily production actuals. */
const PTMT_SEED_VALUES: SeedRow[] = [
  { category: "Cocks Standard",              meanPerDay: 14034, p90PerDay: 17449, bestDay: 19880, daysObserved: 30, planNeedsPerDay: 14527 },
  { category: "Cocks Premium",               meanPerDay:   871, p90PerDay:  1242, bestDay:  2419, daysObserved: 30, planNeedsPerDay:   518 },
  { category: "Faucets & Jetsprays & Shower", meanPerDay: 1565, p90PerDay:  2431, bestDay:  3561, daysObserved: 30, planNeedsPerDay:  2343 },
  { category: "Accessorise",                 meanPerDay:  1318, p90PerDay:  2940, bestDay:  4808, daysObserved: 30, planNeedsPerDay:  1132 },
  { category: "Cistern & Seat Cover",        meanPerDay:   831, p90PerDay:  1050, bestDay:  1320, daysObserved: 30, planNeedsPerDay:   970 },
  { category: "Cabinet",                     meanPerDay:    77, p90PerDay:   147, bestDay:   219, daysObserved:  5, planNeedsPerDay:    37 },
  { category: "Ball Cock",                   meanPerDay:  3900, p90PerDay:  6567, bestDay: 17592, daysObserved: 30, planNeedsPerDay:  1808 },
];

/**
 * Plumbing seed values — all zeros / thin-data because Plumbing production
 * actuals feed is not yet wired to the live ingestion pipeline.
 * Once "Daily Production PLUMBING" actuals are ingested, recompute will
 * replace these with real p90 values.
 */
const PLUMBING_SEED_VALUES: SeedRow[] = [
  { category: "CPVC Pipe",     meanPerDay: 0, p90PerDay: 0, bestDay: 0, daysObserved: 0, planNeedsPerDay: 0 },
  { category: "CPVC Fitting",  meanPerDay: 0, p90PerDay: 0, bestDay: 0, daysObserved: 0, planNeedsPerDay: 0 },
  { category: "CPVC Solvent",  meanPerDay: 0, p90PerDay: 0, bestDay: 0, daysObserved: 0, planNeedsPerDay: 0 },
  { category: "UPVC Pipe",     meanPerDay: 0, p90PerDay: 0, bestDay: 0, daysObserved: 0, planNeedsPerDay: 0 },
  { category: "UPVC Fitting",  meanPerDay: 0, p90PerDay: 0, bestDay: 0, daysObserved: 0, planNeedsPerDay: 0 },
  { category: "UPVC Solvent",  meanPerDay: 0, p90PerDay: 0, bestDay: 0, daysObserved: 0, planNeedsPerDay: 0 },
  { category: "SWR Pipe",      meanPerDay: 0, p90PerDay: 0, bestDay: 0, daysObserved: 0, planNeedsPerDay: 0 },
  { category: "SWR Fitting",   meanPerDay: 0, p90PerDay: 0, bestDay: 0, daysObserved: 0, planNeedsPerDay: 0 },
  { category: "SWR Solvent",   meanPerDay: 0, p90PerDay: 0, bestDay: 0, daysObserved: 0, planNeedsPerDay: 0 },
  { category: "AGRI Pipe",     meanPerDay: 0, p90PerDay: 0, bestDay: 0, daysObserved: 0, planNeedsPerDay: 0 },
  { category: "AGRI Fitting",  meanPerDay: 0, p90PerDay: 0, bestDay: 0, daysObserved: 0, planNeedsPerDay: 0 },
  { category: "AGRI Solvent",  meanPerDay: 0, p90PerDay: 0, bestDay: 0, daysObserved: 0, planNeedsPerDay: 0 },
];

function p90(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.ceil(0.9 * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function trailingMonths(trailingDays: number): string[] {
  const today = new Date();
  const months = new Set<string>();
  for (let offset = 0; offset <= Math.ceil(trailingDays / 28) + 1; offset++) {
    const d = new Date(today.getFullYear(), today.getMonth() - offset, 1);
    months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  return [...months];
}

function monthRange(startMonth: string, endMonth: string): string[] {
  const [startYear, startNumber] = startMonth.split("-").map(Number);
  const [endYear, endNumber] = endMonth.split("-").map(Number);
  const months: string[] = [];
  let cursor = new Date(Date.UTC(startYear, startNumber - 1, 1));
  const end = new Date(Date.UTC(endYear, endNumber - 1, 1));
  while (cursor <= end) {
    months.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return months;
}

function statsForDates(
  dateMap: Map<string, number> | undefined,
  startDate: string,
  endDate: string,
): CapacityWindowStats {
  const values = [...(dateMap?.entries() ?? [])]
    .filter(([date, qty]) => date >= startDate && date <= endDate && qty > 0)
    .map(([, qty]) => qty);
  return {
    startDate,
    endDate,
    daysObserved: values.length,
    meanPerDay: values.length ? Math.round(mean(values)) : 0,
    p90PerDay: values.length ? Math.round(p90(values)) : 0,
    bestDay: values.length ? Math.max(...values) : 0,
  };
}

function monthEnd(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

export function deriveMonthlyCapacitySignals(monthly: CapacityMonthlyStats[]): Pick<
  CapacityComparison,
  "driftPct" | "recoveryDriftPct" | "monthlyP90CvPct" | "latestMonthlyP90" | "minPositiveMonthlyP90" | "zeroProductionMonths"
> {
  const positiveMonths = monthly.filter((row) => row.daysObserved > 0 && row.p90PerDay > 0);
  const first = positiveMonths[0];
  const latest = positiveMonths.at(-1);
  const monthlyP90Values = positiveMonths.map((row) => row.p90PerDay);
  const monthlyP90Mean = mean(monthlyP90Values);
  const monthlyP90CvPct = monthlyP90Values.length >= 2 && monthlyP90Mean > 0
    ? Math.round((Math.sqrt(mean(monthlyP90Values.map((value) => (value - monthlyP90Mean) ** 2))) / monthlyP90Mean) * 1000) / 10
    : null;
  const minPositive = positiveMonths.length
    ? Math.min(...positiveMonths.map((row) => row.p90PerDay))
    : null;
  const percentage = (numerator: number, denominator: number): number =>
    Math.round(((numerator - denominator) / denominator) * 1000) / 10;

  return {
    driftPct: first && latest && first.p90PerDay > 0
      ? percentage(latest.p90PerDay, first.p90PerDay)
      : null,
    recoveryDriftPct: latest && minPositive !== null && minPositive > 0
      ? percentage(latest.p90PerDay, minPositive)
      : null,
    monthlyP90CvPct,
    latestMonthlyP90: latest?.p90PerDay ?? null,
    minPositiveMonthlyP90: minPositive,
    zeroProductionMonths: monthly
      .filter((row) => row.daysObserved === 0)
      .map((row) => row.month),
  };
}

/**
 * Add the current comparison fields when an older persisted JSON payload is
 * returned before its category is recomputed. This keeps the public response
 * contract stable without rewriting historical capacity evidence.
 */
export function normalizeCapacityComparison(comparison: CapacityComparison | null): CapacityComparison | null {
  if (!comparison) return null;
  const monthly = Array.isArray(comparison.monthly) ? comparison.monthly : [];
  const signals = deriveMonthlyCapacitySignals(monthly);
  return {
    fullWindow: comparison.fullWindow,
    recent90d: comparison.recent90d,
    monthly,
    driftPct: comparison.driftPct ?? signals.driftPct,
    recoveryDriftPct: comparison.recoveryDriftPct ?? signals.recoveryDriftPct,
    monthlyP90CvPct: comparison.monthlyP90CvPct ?? signals.monthlyP90CvPct,
    latestMonthlyP90: comparison.latestMonthlyP90 ?? signals.latestMonthlyP90,
    minPositiveMonthlyP90: comparison.minPositiveMonthlyP90 ?? signals.minPositiveMonthlyP90,
    zeroProductionMonths: comparison.zeroProductionMonths ?? signals.zeroProductionMonths,
  };
}

/**
 * Return the capacity value that should be persisted as the suggestion.
 *
 * PTMT Pass 2 uses the adaptive window selector, so its selected p90 is the
 * canonical suggestion after recomputation. Plumbing has no adaptive Pass 2
 * selector yet and continues to use its full-window/seed value.
 */
export function canonicalSuggestedCapacity(
  segment: string,
  row: Pick<CategoryCapacity, "category" | "p90PerDay" | "suggestedCapacity" | "overrideCapacity" | "comparisonJson">,
): number {
  if (segment === "PTMT") {
    return selectPtmtCapacityWindow(row).selectedP90;
  }
  return row.p90PerDay > 0 ? row.p90PerDay : row.suggestedCapacity;
}

/**
 * Seed initial capacity rows for both PTMT and Plumbing segments.
 * Idempotent per category — skips rows that already exist.
 */
export async function seedCategoryCapacity(): Promise<void> {
  const existing = await db.select({ category: categoryCapacityTable.category }).from(categoryCapacityTable);
  const existingCategories = new Set(existing.map(r => r.category));

  const toSeed: Array<{ segment: string } & SeedRow> = [
    ...PTMT_SEED_VALUES.map(s => ({ segment: "PTMT", ...s })),
    ...PLUMBING_SEED_VALUES.map(s => ({ segment: "Plumbing", ...s })),
  ];

  let seeded = 0;
  for (const s of toSeed) {
    if (existingCategories.has(s.category)) continue;
    await db.insert(categoryCapacityTable).values({
      segment: s.segment,
      category: s.category,
      meanPerDay: s.meanPerDay,
      p90PerDay: s.p90PerDay,
      bestDay: s.bestDay,
      daysObserved: s.daysObserved,
      suggestedCapacity: s.p90PerDay,
      planNeedsPerDay: s.planNeedsPerDay,
      isThinData: s.daysObserved < THIN_DATA_THRESHOLD ? 1 : 0,
      trailingDays: 90,
      workingDaysPerWeek: 6,
    });
    seeded++;
  }
  if (seeded > 0) logger.info({ seeded }, "capacity-engine: seeded capacity rows");
}

/**
 * Recompute production capacity for a given segment from trailing actuals.
 *
 * For PTMT: reads ANUJ daily production actuals and computes p90/mean/best.
 * For Plumbing: actuals feed not yet wired — returns existing rows (thin-data flagged).
 * In both cases the plan_needs_per_day is derived from the current month's plan.
 */
export async function computeCategoryCapacity(trailingDays = 90, segment = "PTMT"): Promise<CategoryCapacity[]> {
  logger.info({ trailingDays, segment }, "capacity-engine: computing per-category capacity");

  const seedValues = segment === "Plumbing" ? PLUMBING_SEED_VALUES : PTMT_SEED_VALUES;
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const currentMonth = todayStr.slice(0, 7);
  const recentStart = new Date(today.getTime() - trailingDays * 24 * 60 * 60 * 1000)
    .toISOString().slice(0, 10);
  const fullStart = segment === "PTMT" ? "2026-01-01" : recentStart;
  const fullMonths = monthRange(fullStart.slice(0, 7), currentMonth);
  const recentMonths = trailingMonths(trailingDays);
  const months = [...new Set([...fullMonths, ...recentMonths])];

  const [itemRows, ...actualsArrays] = await Promise.all([
    db.select().from(itemMasterTable).where(eq(itemMasterTable.segment, segment)),
    ...months.map(async (m) => {
      try {
        return await fetchDailyActuals(m, {
          requireFresh: segment === "PTMT",
          // Historical workbooks are immutable for this comparison. Reuse their
          // ingestion snapshots so a full-window recompute does not fan out into
          // fourteen Sheets reads and hit the per-user quota. The current-month
          // cache still follows its normal TTL and refreshes when it expires.
          forceRefresh: false,
        }, segment);
      } catch (err) {
        logger.error({ err, month: m, segment }, "capacity-engine: source unavailable");
        throw new Error(
          `${segment} capacity source unavailable for ${m}: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }
    }),
  ]);

  const catByKey = new Map<string, string>();
  const catByCode = new Map<string, string>();
  for (const item of itemRows) {
    catByKey.set(`${item.itemCode}::${item.colour}`, item.category);
    if (!catByCode.has(item.itemCode)) catByCode.set(item.itemCode, item.category);
  }

  const catDateQty = new Map<string, Map<string, number>>();

  for (const actuals of actualsArrays) {
    for (const row of actuals) {
      const category =
        catByKey.get(`${row.itemCode}::${row.colour}`) ??
        catByCode.get(row.itemCode) ??
        row.group;
      if (!category) continue;
      // Only accumulate data for categories that belong to this segment
      if (!seedValues.some(s => s.category === category)) continue;
      if (!catDateQty.has(category)) catDateQty.set(category, new Map());
      const dateMap = catDateQty.get(category)!;
      dateMap.set(row.date, (dateMap.get(row.date) ?? 0) + row.qty);
    }
  }

  let planItems: Awaited<ReturnType<typeof buildPlanItems>> = [];
  try {
    planItems = await buildPlanItems(currentMonth, segment);
  } catch (err) {
    logger.warn({ err }, "capacity-engine: could not load plan items for plan_needs_per_day");
  }

  const existingRows = await db
    .select()
    .from(categoryCapacityTable)
    .where(eq(categoryCapacityTable.segment, segment));
  const existingByCategory = new Map(existingRows.map(r => [r.category, r]));

  const catPlanNeeds = new Map<string, number>();
  for (const cat of seedValues.map(s => s.category)) {
    const catPlan = planItems.filter(i => i.category === cat).reduce((s, i) => s + i.maxProduction, 0);
    const workingDays = countWorkingDaysInMonth(currentMonth);
    if (catPlan > 0) catPlanNeeds.set(cat, Math.round(catPlan / Math.max(workingDays, 1)));
  }

  const allCategories = new Set([
    ...catDateQty.keys(),
    ...seedValues.map(s => s.category),
  ]);

  const results: CategoryCapacity[] = [];

  for (const category of allCategories) {
    const dateMap = catDateQty.get(category);
    const fullStats = statsForDates(dateMap, fullStart, todayStr);
    const recentStats = statsForDates(dateMap, recentStart, todayStr);
    const monthly: CapacityMonthlyStats[] = fullMonths.map((month) => ({
      month,
      ...statsForDates(dateMap, `${month}-01`, monthEnd(month)),
    }));
    // Endpoint drift remains useful for direction, while recovery drift and
    // the full monthly series reveal V-shaped or intermittent production.
    const monthlySignals = deriveMonthlyCapacitySignals(monthly);
    const comparison: CapacityComparison = {
      fullWindow: fullStats,
      recent90d: recentStats,
      monthly,
      ...monthlySignals,
    };
    const existing = existingByCategory.get(category);

    const computedMean = fullStats.daysObserved > 0 ? fullStats.meanPerDay : (existing?.meanPerDay ?? 0);
    const computedP90 = fullStats.daysObserved > 0 ? fullStats.p90PerDay : (existing?.p90PerDay ?? 0);
    const computedBest = fullStats.daysObserved > 0 ? fullStats.bestDay : (existing?.bestDay ?? 0);
    const isThinData = fullStats.daysObserved < THIN_DATA_THRESHOLD ? 1 : 0;
    const planNeedsPerDay = catPlanNeeds.get(category) ?? existing?.planNeedsPerDay ?? 0;
    const workingDaysPerWeek = existing?.workingDaysPerWeek ?? 6;
    const overrideCapacity = existing?.overrideCapacity ?? null;
    const suggestedCapacity = canonicalSuggestedCapacity(segment, {
      category,
      p90PerDay: computedP90,
      suggestedCapacity: existing?.suggestedCapacity ?? 0,
      overrideCapacity,
      comparisonJson: comparison,
    });

    const values = {
      segment,
      category,
      meanPerDay: computedMean,
      p90PerDay: computedP90,
      bestDay: computedBest,
      daysObserved: fullStats.daysObserved > 0 ? fullStats.daysObserved : (existing?.daysObserved ?? 0),
      trailingDays: segment === "PTMT"
        ? Math.max(1, Math.round((new Date(todayStr).getTime() - new Date(fullStart).getTime()) / 86400000) + 1)
        : trailingDays,
      isThinData,
      suggestedCapacity,
      overrideCapacity: overrideCapacity ?? undefined,
      workingDaysPerWeek,
      planNeedsPerDay,
      windowStartDate: fullStart,
      windowEndDate: todayStr,
      comparisonJson: comparison,
      lastComputedAt: new Date(),
    };

    if (existing) {
      const [updated] = await db
        .update(categoryCapacityTable)
        .set(values)
        .where(eq(categoryCapacityTable.category, category))
        .returning();
      if (updated) results.push(updated);
    } else {
      const [inserted] = await db
        .insert(categoryCapacityTable)
        .values(values)
        .returning();
      if (inserted) results.push(inserted);
    }
  }

  logger.info({ segment, categories: results.length }, "capacity-engine: computation complete");
  return results;
}

export function appliedCapacity(row: CategoryCapacity): number {
  return row.overrideCapacity != null ? row.overrideCapacity : row.suggestedCapacity;
}
