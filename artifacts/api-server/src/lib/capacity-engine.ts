import { db, itemMasterTable, categoryCapacityTable } from "@workspace/db";
import type { CategoryCapacity } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchDailyActuals } from "./plant-ingestion";
import { buildPlanItems } from "../routes/plan";
import { logger } from "./logger";

const THIN_DATA_THRESHOLD = 10;

const SEED_VALUES: Array<{
  category: string;
  meanPerDay: number;
  p90PerDay: number;
  bestDay: number;
  daysObserved: number;
  planNeedsPerDay: number;
}> = [
  { category: "Cocks Standard", meanPerDay: 14034, p90PerDay: 17449, bestDay: 19880, daysObserved: 30, planNeedsPerDay: 14527 },
  { category: "Cocks Premium", meanPerDay: 871, p90PerDay: 1242, bestDay: 2419, daysObserved: 30, planNeedsPerDay: 518 },
  { category: "Faucets & Jetsprays & Shower", meanPerDay: 1565, p90PerDay: 2431, bestDay: 3561, daysObserved: 30, planNeedsPerDay: 2343 },
  { category: "Accessorise", meanPerDay: 1318, p90PerDay: 2940, bestDay: 4808, daysObserved: 30, planNeedsPerDay: 1132 },
  { category: "Cistern & Seat Cover", meanPerDay: 831, p90PerDay: 1050, bestDay: 1320, daysObserved: 30, planNeedsPerDay: 970 },
  { category: "Cabinet", meanPerDay: 77, p90PerDay: 147, bestDay: 219, daysObserved: 5, planNeedsPerDay: 37 },
  { category: "Ball Cock", meanPerDay: 3900, p90PerDay: 6567, bestDay: 17592, daysObserved: 30, planNeedsPerDay: 1808 },
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

export async function seedCategoryCapacity(): Promise<void> {
  const existing = await db.select().from(categoryCapacityTable);
  if (existing.length > 0) return;
  logger.info("capacity-engine: seeding initial category capacity values");
  for (const s of SEED_VALUES) {
    await db.insert(categoryCapacityTable).values({
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
  }
  logger.info({ count: SEED_VALUES.length }, "capacity-engine: seed complete");
}

export async function computeCategoryCapacity(trailingDays = 90): Promise<CategoryCapacity[]> {
  logger.info({ trailingDays }, "capacity-engine: computing per-category capacity");

  const today = new Date();
  const cutoffDate = new Date(today.getTime() - trailingDays * 24 * 60 * 60 * 1000);
  const cutoffStr = cutoffDate.toISOString().slice(0, 10);

  const months = trailingMonths(trailingDays);

  const [itemRows, ...actualsArrays] = await Promise.all([
    db.select().from(itemMasterTable),
    ...months.map(m => fetchDailyActuals(m).catch(err => {
      logger.warn({ err, m }, "capacity-engine: failed to fetch actuals for month");
      return [];
    })),
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
      if (row.date < cutoffStr) continue;
      const category =
        catByKey.get(`${row.itemCode}::${row.colour}`) ??
        catByCode.get(row.itemCode) ??
        row.group;
      if (!category) continue;
      if (!catDateQty.has(category)) catDateQty.set(category, new Map());
      const dateMap = catDateQty.get(category)!;
      dateMap.set(row.date, (dateMap.get(row.date) ?? 0) + row.qty);
    }
  }

  const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  let planItems: Awaited<ReturnType<typeof buildPlanItems>> = [];
  try {
    planItems = await buildPlanItems(currentMonth);
  } catch (err) {
    logger.warn({ err }, "capacity-engine: could not load plan items for plan_needs_per_day");
  }

  const existingRows = await db.select().from(categoryCapacityTable);
  const existingByCategory = new Map(existingRows.map(r => [r.category, r]));

  const WORKING_DAYS_PER_MONTH = 27;
  const catPlanNeeds = new Map<string, number>();
  for (const cat of SEED_VALUES.map(s => s.category)) {
    const catPlan = planItems.filter(i => i.category === cat).reduce((s, i) => s + i.maxProduction, 0);
    if (catPlan > 0) catPlanNeeds.set(cat, Math.round(catPlan / WORKING_DAYS_PER_MONTH));
  }

  const allCategories = new Set([
    ...catDateQty.keys(),
    ...SEED_VALUES.map(s => s.category),
  ]);

  const results: CategoryCapacity[] = [];

  for (const category of allCategories) {
    const dateMap = catDateQty.get(category);
    const dailyValues = dateMap ? [...dateMap.values()].filter(v => v > 0) : [];
    const daysObserved = dailyValues.length;
    const existing = existingByCategory.get(category);

    const computedMean = daysObserved > 0 ? Math.round(mean(dailyValues)) : (existing?.meanPerDay ?? 0);
    const computedP90 = daysObserved > 0 ? Math.round(p90(dailyValues)) : (existing?.p90PerDay ?? 0);
    const computedBest = daysObserved > 0 ? Math.max(...dailyValues) : (existing?.bestDay ?? 0);
    const isThinData = daysObserved < THIN_DATA_THRESHOLD ? 1 : 0;
    const planNeedsPerDay = catPlanNeeds.get(category) ?? existing?.planNeedsPerDay ?? 0;
    const workingDaysPerWeek = existing?.workingDaysPerWeek ?? 6;
    const overrideCapacity = existing?.overrideCapacity ?? null;
    const suggestedCapacity = computedP90 > 0 ? computedP90 : (existing?.suggestedCapacity ?? 0);

    const values = {
      category,
      meanPerDay: computedMean,
      p90PerDay: computedP90,
      bestDay: computedBest,
      daysObserved: daysObserved > 0 ? daysObserved : (existing?.daysObserved ?? 0),
      trailingDays,
      isThinData,
      suggestedCapacity,
      overrideCapacity: overrideCapacity ?? undefined,
      workingDaysPerWeek,
      planNeedsPerDay,
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

  logger.info({ categories: results.length }, "capacity-engine: computation complete");
  return results;
}

export function appliedCapacity(row: CategoryCapacity): number {
  return row.overrideCapacity != null ? row.overrideCapacity : row.suggestedCapacity;
}
