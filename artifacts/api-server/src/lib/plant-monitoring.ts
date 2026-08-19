import {
  db,
  planRunInputsTable,
  planRunResultsTable,
  planRunsTable,
  plantConfigsTable,
  plantMonitoringSnapshotsTable,
  weeklyReleaseBandsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { buildPlantBundle, type PlantBundle } from "./plant-engine";
import {
  fetchDailyActuals,
  fetchMonitoringPlanTimeline,
  loadStoredDailyActuals,
  type DailyActualRow,
  type PlantTargetRow,
} from "./plant-ingestion";
import type { PlanVersion } from "./plant-plan-timeline";
import { resolvePlantMonthLifecycle, resolveWorkingDays, type PlantMonthLifecycle } from "./plant-lifecycle";
import { buildPlantWeeklySummary, type PlantWeeklySummary, type WeeklyInputPlanItem } from "./plant-weekly-engine";
import { buildPlantWarnings, buildPlantWeeklyWarnings, DEFAULT_PLANT_WARNING_THRESHOLDS, type PlantWarningThresholds } from "./plant-warnings";
import { buildPlantRecommendations } from "./plant-recommendations";
import { buildPlanItems } from "../routes/plan";
import { annotateWeeklyRelease, type CalcPlanItem } from "./calc";

export type MonitoringStatus = "live" | "grace" | "frozen" | "unavailable" | "future";

export interface LifecyclePlantBundle extends PlantBundle {
  monitoringStatus: MonitoringStatus;
  targetsAvailable: boolean;
  actualsAvailable: boolean;
  unavailableReason: string | null;
  warnings: ReturnType<typeof buildPlantWarnings>;
  recommendations: ReturnType<typeof buildPlantRecommendations>;
}

export interface PlantSnapshotSourceInfo {
  targetSource: "finalized_plan_run";
  planRunId: number;
  planAsOfAt: string;
  weeklyTargetSource: "plan_run_snapshot" | "legacy_frozen_inputs";
  weeklyBandSnapshot: Array<{
    categoryName: string;
    w1Upper: number;
    w2Upper: number;
    w3Upper: number;
    w4Upper: number;
  }> | null;
  actualsSource: "plant_ingestion_cache";
  actualsCachedAt: string;
  sourceSnapshotDate: string | null;
  planVersions: Array<{
    kind: PlanVersion["kind"];
    sourceId: number;
    sourceLabel: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    targetCount: number;
  }>;
}

function loadThresholds(row: { thresholdsJson?: unknown } | null): PlantWarningThresholds {
  if (!row?.thresholdsJson || typeof row.thresholdsJson !== "object") return DEFAULT_PLANT_WARNING_THRESHOLDS;
  const t = row.thresholdsJson as Record<string, unknown>;
  const d = DEFAULT_PLANT_WARNING_THRESHOLDS;
  return {
    behindPaceHigh: typeof t.behindPaceHigh === "number" ? t.behindPaceHigh : d.behindPaceHigh,
    behindPaceCritical: typeof t.behindPaceCritical === "number" ? t.behindPaceCritical : d.behindPaceCritical,
    willMissPpGapMedium: typeof t.willMissPpGapMedium === "number" ? t.willMissPpGapMedium : d.willMissPpGapMedium,
    willMissPpGapHigh: typeof t.willMissPpGapHigh === "number" ? t.willMissPpGapHigh : d.willMissPpGapHigh,
    willMissPpGapCritical: typeof t.willMissPpGapCritical === "number" ? t.willMissPpGapCritical : d.willMissPpGapCritical,
    catchupInfeasibleRatio: typeof t.catchupInfeasibleRatio === "number" ? t.catchupInfeasibleRatio : d.catchupInfeasibleRatio,
    categoryLaggingGap: typeof t.categoryLaggingGap === "number" ? t.categoryLaggingGap : d.categoryLaggingGap,
    backloadingIndex: typeof t.backloadingIndex === "number" ? t.backloadingIndex : d.backloadingIndex,
    noProductionDays: typeof t.noProductionDays === "number" ? t.noProductionDays : d.noProductionDays,
  };
}

async function loadConfig(month: string) {
  const [row] = await db.select().from(plantConfigsTable).where(eq(plantConfigsTable.month, month));
  const calendar = resolveWorkingDays(month, row?.workingDays);
  return {
    row: row ?? null,
    config: {
      ...calendar,
      shiftsPerDay: row?.shiftsPerDay ?? 2,
      shiftHours: row?.shiftHours ?? 12,
      snapshotDate: row?.snapshotDate ?? null,
      elapsed: 0,
    },
  };
}

async function loadFinalizedTargets(month: string): Promise<{
  run: typeof planRunsTable.$inferSelect;
  targets: PlantTargetRow[];
  planItems: WeeklyInputPlanItem[];
  weeklyTargetSource: PlantSnapshotSourceInfo["weeklyTargetSource"];
  weeklyBandSnapshot: PlantSnapshotSourceInfo["weeklyBandSnapshot"];
  versionTimeline: PlanVersion[];
} | null> {
  const [run] = await db
    .select()
    .from(planRunsTable)
    .where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT"), eq(planRunsTable.status, "finalized")))
    .orderBy(desc(planRunsTable.id))
    .limit(1);
  if (!run) return null;
  const [results, versionTimeline] = await Promise.all([
    db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, run.id)),
    fetchMonitoringPlanTimeline(month),
  ]);
  if (results.length === 0) return null;
  let planItems: WeeklyInputPlanItem[];
  let weeklyTargetSource: PlantSnapshotSourceInfo["weeklyTargetSource"];
  let weeklyBandSnapshot: PlantSnapshotSourceInfo["weeklyBandSnapshot"] = null;
  if (run.weeklyReleaseVersion >= 1) {
    planItems = results.map((item) => ({
      itemCode: item.itemCode,
      colour: item.colour,
      category: item.category,
      maxProduction: item.productionPlan,
      w1: item.w1,
      w2: item.w2,
      w3: item.w3,
      w4: item.w4,
    }));
    weeklyTargetSource = "plan_run_snapshot";
  } else {
    const [inputs, bands] = await Promise.all([
      db.select().from(planRunInputsTable).where(eq(planRunInputsTable.runId, run.id)),
      db.select().from(weeklyReleaseBandsTable).where(eq(weeklyReleaseBandsTable.segment, "PTMT")),
    ]);
    const inputByKey = new Map(inputs.map((item) => [`${item.itemCode}::${item.colour}`, item]));
    const legacyItems: CalcPlanItem[] = results.map((item) => {
      const input = inputByKey.get(`${item.itemCode}::${item.colour}`);
      const avg3MoSale = input?.avg3MoSale ?? 0;
      const stock = input?.stock ?? 0;
      return {
        itemCode: item.itemCode,
        colour: item.colour,
        category: item.category,
        avg3MoSale,
        stock,
        stockNeedsReview: false,
        bufferReq: item.bufferReq,
        minProduction: item.minProduction,
        maxProduction: item.productionPlan,
        pendingOrderLastMonth: input?.pendingLastMonth ?? 0,
        pendingOrder: input?.pendingCurrent ?? 0,
        order: 0,
        achievementPct: null,
        cover: avg3MoSale > 0 ? stock / avg3MoSale : "OS",
        week: null,
        w1: 0,
        w2: 0,
        w3: 0,
        w4: 0,
      };
    });
    annotateWeeklyRelease(legacyItems, new Map(bands.map((band) => [band.categoryName, band])));
    planItems = legacyItems;
    weeklyTargetSource = "legacy_frozen_inputs";
    weeklyBandSnapshot = bands
      .map((band) => ({
        categoryName: band.categoryName,
        w1Upper: band.w1Upper,
        w2Upper: band.w2Upper,
        w3Upper: band.w3Upper,
        w4Upper: band.w4Upper,
      }))
      .sort((a, b) => a.categoryName.localeCompare(b.categoryName));
  }
  return {
    run,
    planItems,
    weeklyTargetSource,
    weeklyBandSnapshot,
    versionTimeline,
    targets: results.map((item) => ({
      itemCode: item.itemCode,
      colour: item.colour,
      category: item.category,
      maxPcs: item.productionPlan,
      minPcs: item.minProduction,
    })),
  };
}

async function hasFinalizedTargets(month: string): Promise<boolean> {
  const [run] = await db
    .select({ id: planRunsTable.id })
    .from(planRunsTable)
    .where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, "PTMT"), eq(planRunsTable.status, "finalized")))
    .orderBy(desc(planRunsTable.id))
    .limit(1);
  if (!run) return false;
  const [result] = await db
    .select({ id: planRunResultsTable.id })
    .from(planRunResultsTable)
    .where(eq(planRunResultsTable.runId, run.id))
    .limit(1);
  return Boolean(result);
}

function decorateBundle(
  base: PlantBundle,
  status: MonitoringStatus,
  row: { thresholdsJson?: unknown } | null,
  targetsAvailable: boolean,
  unavailableReason: string | null,
  actualsAvailable = true,
): LifecyclePlantBundle {
  if (!targetsAvailable) {
    return {
      ...base,
      monitoringStatus: status,
      targetsAvailable,
      actualsAvailable,
      unavailableReason,
      warnings: [],
      recommendations: [],
    };
  }
  return {
    ...base,
    monitoringStatus: status,
    targetsAvailable,
    actualsAvailable,
    unavailableReason,
    warnings: buildPlantWarnings(base, loadThresholds(row)),
    recommendations: buildPlantRecommendations(base, loadThresholds(row)),
  };
}

function emptyBundle(
  month: string,
  lifecycle: PlantMonthLifecycle,
  config: Awaited<ReturnType<typeof loadConfig>>["config"],
  status: "future" | "unavailable",
  reason: string,
): LifecyclePlantBundle {
  const bundle = buildPlantBundle(month, [], [], {
    ...config,
    snapshotDate: null,
    lifecycle: lifecycle.state,
    workingDaysSource: config.workingDaysSource,
  });
  bundle.caveats = [reason];
  return decorateBundle(bundle, status, null, false, reason, false);
}

function buildWeekly(
  month: string,
  actuals: DailyActualRow[],
  planItems: WeeklyInputPlanItem[],
  targets: PlantTargetRow[],
  snapshotDate: string | null,
  lifecycle: PlantMonthLifecycle,
  versionTimeline: PlanVersion[] = [],
): PlantWeeklySummary {
  return buildPlantWeeklySummary(
    month,
    actuals,
    planItems,
    targets,
    snapshotDate,
    lifecycle.isCompletedCalendar,
    versionTimeline,
  );
}

async function buildReadyBundle(
  month: string,
  actuals: DailyActualRow[],
  targets: PlantTargetRow[],
  lifecycle: PlantMonthLifecycle,
  sourceInfo: Record<string, unknown> | null,
  capturedAt: string | null,
  versionTimeline: PlanVersion[] = [],
) {
  const { row, config } = await loadConfig(month);
  const snapshotDate = config.snapshotDate ?? (actuals.length ? actuals.map((r) => r.date).sort().pop()! : null);
  const base = buildPlantBundle(month, actuals, targets, {
    ...config,
    snapshotDate,
    lifecycle: lifecycle.state,
    workingDaysSource: config.workingDaysSource,
    capturedAt,
    sourceInfo,
    versionTimeline,
  });
  const status: MonitoringStatus =
    lifecycle.state === "open" ? "live" :
    lifecycle.state === "closed" ? "frozen" :
    lifecycle.state;
  return { bundle: decorateBundle(base, status, row, true, null), snapshotDate };
}

function graceActualsUnavailableBundle(
  month: string,
  lifecycle: PlantMonthLifecycle,
  configRow: { thresholdsJson?: unknown } | null,
  config: Awaited<ReturnType<typeof loadConfig>>["config"],
  finalized: NonNullable<Awaited<ReturnType<typeof loadFinalizedTargets>>>,
  reason: string,
): LifecyclePlantBundle {
  const sourceInfo = {
    targetSource: "finalized_plan_run",
    planRunId: finalized.run.id,
    weeklyTargetSource: finalized.weeklyTargetSource,
    acceptsLateActuals: true,
  };
  const base = buildPlantBundle(month, [], finalized.targets, {
    ...config,
    snapshotDate: null,
    lifecycle: lifecycle.state,
    workingDaysSource: config.workingDaysSource,
    sourceInfo,
    versionTimeline: finalized.versionTimeline,
  });
  base.caveats = [reason];
  return decorateBundle(base, "grace", configRow, true, reason, false);
}

async function loadSavedSnapshot(month: string) {
  const [snapshot] = await db
    .select()
    .from(plantMonitoringSnapshotsTable)
    .where(eq(plantMonitoringSnapshotsTable.month, month));
  return snapshot ?? null;
}

export async function captureClosedPlantMonth(
  month: string,
  now = new Date(),
  options: { refreshActuals?: boolean } = {},
): Promise<
  | { ok: true; bundle: LifecyclePlantBundle; weekly: PlantWeeklySummary; capturedAt: string }
  | { ok: false; reason: string; code: "MONTH_NOT_CLOSED" | "FINALIZED_PLAN_MISSING" | "ACTUALS_REFRESH_FAILED" | "ACTUALS_SNAPSHOT_MISSING" }
> {
  const lifecycle = resolvePlantMonthLifecycle(month, now);
  if (lifecycle.state !== "closed") {
    return { ok: false, code: "MONTH_NOT_CLOSED", reason: "Only closed months can be frozen." };
  }
  const existing = await loadSavedSnapshot(month);
  if (existing) {
    return {
      ok: true,
      bundle: existing.bundleJson as LifecyclePlantBundle,
      weekly: existing.weeklyJson as PlantWeeklySummary,
      capturedAt: existing.capturedAt.toISOString(),
    };
  }
  const finalized = await loadFinalizedTargets(month);
  if (!finalized) {
    return { ok: false, code: "FINALIZED_PLAN_MISSING", reason: "Targets unavailable — no finalized PTMT plan was issued for this month." };
  }
  if (options.refreshActuals !== false) {
    try {
      await fetchDailyActuals(month, { forceRefresh: true, requireFresh: true });
    } catch {
      return {
        ok: false,
        code: "ACTUALS_REFRESH_FAILED",
        reason: "Historical actuals unavailable — the production source could not be refreshed for snapshot capture.",
      };
    }
  }
  const stored = await loadStoredDailyActuals(month);
  if (!stored.cachedAt) {
    return { ok: false, code: "ACTUALS_SNAPSHOT_MISSING", reason: "Historical actuals unavailable — no stored production snapshot exists for this month." };
  }
  const capturedAt = new Date();
  const sourceInfo: PlantSnapshotSourceInfo = {
    targetSource: "finalized_plan_run",
    planRunId: finalized.run.id,
    planAsOfAt: finalized.run.asOfAt.toISOString(),
    weeklyTargetSource: finalized.weeklyTargetSource,
    weeklyBandSnapshot: finalized.weeklyBandSnapshot,
    actualsSource: "plant_ingestion_cache",
    actualsCachedAt: stored.cachedAt.toISOString(),
    sourceSnapshotDate: stored.snapshotDate,
    planVersions: finalized.versionTimeline.map((version) => ({
      kind: version.kind,
      sourceId: version.sourceId,
      sourceLabel: version.sourceLabel,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
      targetCount: version.targets.length,
    })),
  };
  const { bundle, snapshotDate } = await buildReadyBundle(
    month,
    stored.actuals,
    finalized.targets,
    lifecycle,
    { ...sourceInfo },
    capturedAt.toISOString(),
    finalized.versionTimeline,
  );
  const weekly = buildWeekly(
    month,
    stored.actuals,
    finalized.planItems,
    finalized.targets,
    snapshotDate,
    lifecycle,
    finalized.versionTimeline,
  );
  const weeklyWarnings = buildPlantWeeklyWarnings(weekly);
  bundle.warnings = [...bundle.warnings, ...weeklyWarnings];
  await db.insert(plantMonitoringSnapshotsTable).values({
    month,
    planRunId: finalized.run.id,
    actualsJson: stored.actuals,
    targetsJson: finalized.targets,
    bundleJson: bundle,
    weeklyJson: weekly,
    sourceInfoJson: sourceInfo,
    capturedAt,
  }).onConflictDoNothing();
  const [saved] = await db.select().from(plantMonitoringSnapshotsTable).where(eq(plantMonitoringSnapshotsTable.month, month));
  return {
    ok: true,
    bundle: saved.bundleJson as LifecyclePlantBundle,
    weekly: saved.weeklyJson as PlantWeeklySummary,
    capturedAt: saved.capturedAt.toISOString(),
  };
}

export async function computeLifecyclePlantMonitoring(
  month: string,
  now = new Date(),
  dependencies: {
    fetchActuals?: (month: string, options: { forceRefresh?: boolean; requireFresh?: boolean }) => Promise<DailyActualRow[]>;
  } = {},
): Promise<{
  bundle: LifecyclePlantBundle;
  weekly: PlantWeeklySummary;
}> {
  const lifecycle = resolvePlantMonthLifecycle(month, now);
  const { row, config } = await loadConfig(month);
  if (lifecycle.state === "future") {
    const bundle = emptyBundle(month, lifecycle, config, "future", "No plan issued — this is a future month.");
    return { bundle, weekly: buildWeekly(month, [], [], [], null, lifecycle) };
  }
  if (lifecycle.state === "closed") {
    const saved = await loadSavedSnapshot(month);
    if (saved) {
      return {
        bundle: saved.bundleJson as LifecyclePlantBundle,
        weekly: saved.weeklyJson as PlantWeeklySummary,
      };
    }
    const finalizedTargetsExist = await hasFinalizedTargets(month);
    const reason = finalizedTargetsExist
      ? "Targets unavailable — no frozen monitoring snapshot has been captured for this closed month."
      : "Targets unavailable — no finalized PTMT plan was issued for this month.";
    const bundle = emptyBundle(month, lifecycle, config, "unavailable", reason);
    return { bundle, weekly: buildWeekly(month, [], [], [], null, lifecycle) };
  }

  const fetchActuals = dependencies.fetchActuals ?? fetchDailyActuals;
  let targets: PlantTargetRow[];
  let planItems: WeeklyInputPlanItem[] = [];
  let sourceInfo: Record<string, unknown> | null = null;
  let versionTimeline: PlanVersion[] = [];
  let actuals: DailyActualRow[];
  if (lifecycle.state === "grace") {
    const finalized = await loadFinalizedTargets(month);
    if (!finalized) {
      const bundle = emptyBundle(month, lifecycle, config, "unavailable", "Targets unavailable — no finalized PTMT plan was issued for this month.");
      return { bundle, weekly: buildWeekly(month, [], [], [], config.snapshotDate, lifecycle) };
    }
    try {
      actuals = await fetchActuals(month, { forceRefresh: true, requireFresh: true });
    } catch {
      const reason = "Actuals unavailable — late production data could not be refreshed during the grace period.";
      const bundle = graceActualsUnavailableBundle(month, lifecycle, row, config, finalized, reason);
      return {
        bundle,
        weekly: buildWeekly(month, [], finalized.planItems, finalized.targets, null, lifecycle, finalized.versionTimeline),
      };
    }
    targets = finalized.targets;
    planItems = finalized.planItems;
    versionTimeline = finalized.versionTimeline;
    sourceInfo = {
      targetSource: "finalized_plan_run",
      planRunId: finalized.run.id,
      weeklyTargetSource: finalized.weeklyTargetSource,
      acceptsLateActuals: true,
      planVersions: finalized.versionTimeline.map((version) => ({
        kind: version.kind,
        sourceId: version.sourceId,
        effectiveFrom: version.effectiveFrom,
        effectiveTo: version.effectiveTo,
        targetCount: version.targets.length,
      })),
    };
  } else {
    actuals = await fetchActuals(month, {});
    const liveItems = await buildPlanItems(month, "PTMT");
    versionTimeline = await fetchMonitoringPlanTimeline(month);
    const latestVersion = versionTimeline.at(-1);
    targets = latestVersion ? latestVersion.targets.map((item) => ({
      itemCode: item.itemCode,
      colour: item.colour,
      category: item.category,
      maxPcs: item.maxPcs,
      minPcs: item.minPcs,
    })) : liveItems.map((item) => ({
      itemCode: item.itemCode,
      colour: item.colour,
      category: item.category,
      maxPcs: item.maxProduction,
      minPcs: item.minProduction,
    }));
    planItems = liveItems;
    sourceInfo = {
      targetSource: versionTimeline.length ? "issued_plan_timeline" : "live_plan",
      planVersions: versionTimeline.map((version) => ({
        kind: version.kind,
        sourceId: version.sourceId,
        effectiveFrom: version.effectiveFrom,
        effectiveTo: version.effectiveTo,
        targetCount: version.targets.length,
      })),
    };
  }
  if (targets.length === 0) {
    const bundle = emptyBundle(month, lifecycle, config, "unavailable", "Targets unavailable — no plan targets were found for this month.");
    return { bundle, weekly: buildWeekly(month, actuals, [], [], config.snapshotDate, lifecycle) };
  }
  const { bundle, snapshotDate } = await buildReadyBundle(
    month,
    actuals,
    targets,
    lifecycle,
    sourceInfo,
    null,
    versionTimeline,
  );
  const weekly = buildWeekly(
    month,
    actuals,
    planItems,
    targets,
    snapshotDate,
    lifecycle,
    versionTimeline,
  );
  bundle.warnings = [...bundle.warnings, ...buildPlantWeeklyWarnings(weekly)];
  return { bundle, weekly };
}

export function selectUnfrozenClosedMonths(
  finalizedMonths: string[],
  frozenMonths: string[],
  now = new Date(),
): string[] {
  const frozen = new Set(frozenMonths);
  return [...new Set(finalizedMonths)]
    .filter((month) => !frozen.has(month) && resolvePlantMonthLifecycle(month, now).state === "closed")
    .sort((a, b) => b.localeCompare(a));
}

export async function captureUnfrozenClosedPlantMonths(now = new Date()): Promise<Array<{
  month: string;
  result: Awaited<ReturnType<typeof captureClosedPlantMonth>>;
}>> {
  const [finalizedRuns, snapshots] = await Promise.all([
    db
      .select({ month: planRunsTable.month })
      .from(planRunsTable)
      .where(and(eq(planRunsTable.segment, "PTMT"), eq(planRunsTable.status, "finalized")))
      .orderBy(desc(planRunsTable.month)),
    db.select({ month: plantMonitoringSnapshotsTable.month }).from(plantMonitoringSnapshotsTable),
  ]);
  const months = selectUnfrozenClosedMonths(
    finalizedRuns.map((run) => run.month),
    snapshots.map((snapshot) => snapshot.month),
    now,
  );
  const outcomes: Array<{
    month: string;
    result: Awaited<ReturnType<typeof captureClosedPlantMonth>>;
  }> = [];
  for (const month of months) {
    outcomes.push({ month, result: await captureClosedPlantMonth(month, now) });
  }
  return outcomes;
}