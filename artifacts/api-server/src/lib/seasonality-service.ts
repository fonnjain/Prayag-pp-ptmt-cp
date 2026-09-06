import { and, eq, sql } from "drizzle-orm";
import {
  bufferCategoriesTable,
  db,
  ptmtBufferMultipliersTable,
  seasonalityRunsTable,
} from "@workspace/db";
import {
  computeReliabilityFlag,
  runPlumbingSeasonalityEngine,
  runPtmtMonthlySeasonalityEngine,
  runSeasonalityEngine,
  type SeasonalityEngineOutput,
} from "./seasonality-engine";
import { logger } from "./logger";

type SeasonalityRunKind = "global" | "monthly";

const runKey = (month: string, segment: string, engineKind: SeasonalityRunKind) =>
  `${month}:${segment}:${engineKind}`;

async function markRun(
  month: string,
  segment: string,
  engineKind: SeasonalityRunKind,
  status: "running" | "success" | "failed",
  details: Record<string, unknown> = {},
): Promise<void> {
  const now = new Date();
  await db
    .insert(seasonalityRunsTable)
    .values({
      month,
      segment,
      engineKind,
      status,
      startedAt: now,
      completedAt: status === "success" || status === "failed" ? now : null,
      details,
    })
    .onConflictDoUpdate({
      target: [
        seasonalityRunsTable.month,
        seasonalityRunsTable.segment,
        seasonalityRunsTable.engineKind,
      ],
      set: {
        status,
        startedAt: now,
        completedAt: status === "success" || status === "failed" ? now : null,
        details,
      },
    });
}

async function persistGlobalResult(
  segment: string,
  result: SeasonalityEngineOutput,
): Promise<void> {
  const rows = await db
    .select({
      name: bufferCategoriesTable.name,
      multiplier: bufferCategoriesTable.multiplier,
      overrideMultiplier: bufferCategoriesTable.overrideMultiplier,
    })
    .from(bufferCategoriesTable)
    .where(eq(bufferCategoriesTable.segment, segment));
  const currentByName = new Map(rows.map((row) => [row.name, row]));

  for (const category of result.categories) {
    const current = currentByName.get(category.category);
    if (!current) continue;

    const sourceReadFailures = result.sourceReadFailures ?? 0;
    // A non-null engine suggestion becomes the default applied multiplier only
    // when the source read was complete. Explicit user overrides still win.
    // A failed source read must never turn partial history into a plan change.
    const appliedMultiplier = current.overrideMultiplier
      ?? (sourceReadFailures === 0 ? category.suggestedMultiplier : null)
      ?? current.multiplier;
    const reliabilityFlag = sourceReadFailures > 0
      ? `source data-quality failure — ${sourceReadFailures} order-sheet tab read failure(s)`
      : computeReliabilityFlag(category);

    await db
      .update(bufferCategoriesTable)
      .set({
        suggestedMultiplier: category.suggestedMultiplier,
        cvValue: category.cv,
        volatilityClass: category.volatilityClass,
        avgMonth: category.avgMonth,
        peakMonth: category.peakMonth,
        peakIndex: category.peakIndex,
        yoy: category.yoy,
        signal: category.signal,
        seasonalIndices: category.seasonalIndices
          ? JSON.stringify(category.seasonalIndices)
          : null,
        lastComputedAt: result.computedAt,
        dataQuality: category.dataQuality,
        zScore: category.zScore,
        multiplier: appliedMultiplier,
        reliabilityFlag,
      })
      .where(
        and(
          eq(bufferCategoriesTable.segment, segment),
          eq(bufferCategoriesTable.name, category.category),
        ),
      );
  }
}

async function persistPtmtMonthlyResult(
  result: Awaited<ReturnType<typeof runPtmtMonthlySeasonalityEngine>>,
): Promise<void> {
  const existing = await db
    .select({
      month: ptmtBufferMultipliersTable.month,
      category: ptmtBufferMultipliersTable.category,
      multiplier: ptmtBufferMultipliersTable.multiplier,
      suggestedMultiplier: ptmtBufferMultipliersTable.suggestedMultiplier,
      overrideMultiplier: ptmtBufferMultipliersTable.overrideMultiplier,
    })
    .from(ptmtBufferMultipliersTable);
  const overrides = new Map(
    existing.map((row) => [
      runKey(row.month, row.category, "monthly"),
      row.overrideMultiplier,
    ]),
  );

  const values = result.rows.map((row) => {
    const prior = existing.find(
      (entry) => entry.month === row.month && entry.category === row.category,
    );
    const overrideMultiplier =
      overrides.get(runKey(row.month, row.category, "monthly")) ?? null;
    const completeRead = result.sourceReadFailures === 0;
    return {
      month: row.month,
      category: row.category,
      multiplier: overrideMultiplier
        ?? (completeRead ? row.suggestedMultiplier : prior?.multiplier ?? null),
      suggestedMultiplier: completeRead
        ? row.suggestedMultiplier
        : prior?.suggestedMultiplier ?? null,
      overrideMultiplier,
      zScore: row.zScore,
      cvValue: row.cvValue,
      dataQuality: row.dataQuality,
      sourceObservations: row.sourceObservations,
      lastComputedAt: result.computedAt,
    };
  });

  if (values.length === 0) return;

  await db
    .insert(ptmtBufferMultipliersTable)
    .values(values)
    .onConflictDoUpdate({
      target: [
        ptmtBufferMultipliersTable.month,
        ptmtBufferMultipliersTable.category,
      ],
      set: {
        multiplier: sql`excluded.multiplier`,
        suggestedMultiplier: sql`excluded.suggested_multiplier`,
        zScore: sql`excluded.z_score`,
        cvValue: sql`excluded.cv_value`,
        dataQuality: sql`excluded.data_quality`,
        sourceObservations: sql`excluded.source_observations`,
        lastComputedAt: sql`excluded.last_computed_at`,
        updatedAt: new Date(),
      },
    });
}

async function isCompleteForMonth(month: string): Promise<boolean> {
  const rows = await db
    .select({
      segment: seasonalityRunsTable.segment,
      engineKind: seasonalityRunsTable.engineKind,
      status: seasonalityRunsTable.status,
    })
    .from(seasonalityRunsTable)
    .where(eq(seasonalityRunsTable.month, month));
  const completed = new Set(
    rows
      .filter((row) => row.status === "success")
      .map((row) => runKey(month, row.segment, row.engineKind as SeasonalityRunKind)),
  );
  return (
    completed.has(runKey(month, "PTMT", "global"))
    && completed.has(runKey(month, "PTMT", "monthly"))
    && completed.has(runKey(month, "Plumbing", "global"))
  );
}

let recomputeInFlight: Promise<SeasonalityCycleResult> | null = null;

export interface SeasonalityCycleResult {
  month: string;
  skipped: boolean;
  ptmt: SeasonalityEngineOutput | null;
  plumbing: SeasonalityEngineOutput | null;
  ptmtMonthlyRows: number;
}

/**
 * Recompute both segments once per planning month after the source sync.
 * Suggestions are applied as defaults; explicit user overrides remain intact.
 */
export async function recomputeSeasonalityForPlanningCycle(
  month: string,
  zScore = 1.65,
): Promise<SeasonalityCycleResult> {
  if (recomputeInFlight) return recomputeInFlight;

  const run = async (): Promise<SeasonalityCycleResult> => {
    if (await isCompleteForMonth(month)) {
      return {
        month,
        skipped: true,
        ptmt: null,
        plumbing: null,
        ptmtMonthlyRows: 0,
      };
    }

    await Promise.all([
      markRun(month, "PTMT", "global", "running"),
      markRun(month, "PTMT", "monthly", "running"),
      markRun(month, "Plumbing", "global", "running"),
    ]);

    try {
      // These engines read overlapping Sheets workbooks. Keep them sequential
      // to stay below the per-user Sheets read quota; a partial 429 result is
      // worse than a slower monthly refresh.
      const ptmt = await runSeasonalityEngine(zScore);
      const ptmtMonthly = await runPtmtMonthlySeasonalityEngine(zScore);
      const plumbing = await runPlumbingSeasonalityEngine(zScore);

      await Promise.all([
        persistGlobalResult("PTMT", ptmt),
        persistPtmtMonthlyResult(ptmtMonthly),
        persistGlobalResult("Plumbing", plumbing),
      ]);

      const partial = (ptmt.sourceReadFailures ?? 0) > 0
        || ptmtMonthly.sourceReadFailures > 0
        || (plumbing.sourceReadFailures ?? 0) > 0;
      const runStatus = partial ? "failed" : "success";
      const sharedDetails = partial
        ? { reason: "one or more source tabs failed to read; automatic application was blocked" }
        : {};

      await Promise.all([
        markRun(month, "PTMT", "global", runStatus, {
          categories: ptmt.categories.length,
          totalOrderQty: ptmt.totalOrderQty,
          totalUnmappedQty: ptmt.totalUnmappedQty,
          sourceReadFailures: ptmt.sourceReadFailures ?? 0,
          ...sharedDetails,
        }),
        markRun(month, "PTMT", "monthly", runStatus, {
          rows: ptmtMonthly.rows.length,
          categories: new Set(ptmtMonthly.rows.map((row) => row.category)).size,
          sourceReadFailures: ptmtMonthly.sourceReadFailures,
          ...sharedDetails,
        }),
        markRun(month, "Plumbing", "global", runStatus, {
          categories: plumbing.categories.length,
          totalOrderQty: plumbing.totalOrderQty,
          totalUnmappedQty: plumbing.totalUnmappedQty,
          sourceReadFailures: plumbing.sourceReadFailures ?? 0,
          ...sharedDetails,
        }),
      ]);

      logger.info(
        {
          month,
          ptmtCategories: ptmt.categories.length,
          ptmtMonthlyRows: ptmtMonthly.rows.length,
          plumbingCategories: plumbing.categories.length,
        },
        "seasonality: planning-cycle recompute complete",
      );

      return {
        month,
        skipped: false,
        ptmt,
        plumbing,
        ptmtMonthlyRows: ptmtMonthly.rows.length,
      };
    } catch (error) {
      await Promise.all([
        markRun(month, "PTMT", "global", "failed", { error: String(error) }),
        markRun(month, "PTMT", "monthly", "failed", { error: String(error) }),
        markRun(month, "Plumbing", "global", "failed", { error: String(error) }),
      ]);
      throw error;
    }
  };

  recomputeInFlight = run();
  try {
    return await recomputeInFlight;
  } finally {
    recomputeInFlight = null;
  }
}
