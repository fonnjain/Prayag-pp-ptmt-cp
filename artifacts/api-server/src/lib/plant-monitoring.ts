import {
  db,
  planRunInputsTable,
  planRunResultsTable,
  planRunsTable,
  plantConfigsTable,
  plantIngestionCacheTable,
  plantMonthSnapshotsTable,
  plantPlanVersionsTable,
  weeklyReleaseBandsTable,
} from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { buildPlantBundle, type PlantBundle } from "./plant-engine";
import {
  fetchDailyActuals,
  fetchMonitoringPlanTimeline,
  loadStoredDailyActualsForSegment,
  refreshPlumbingActualsCache,
  type DailyActualRow,
  type PlantTargetRow,
} from "./plant-ingestion";
import type { PlanVersion, VersionTarget } from "./plant-plan-timeline";
import {
  lastProductionDay,
  resolvePlantMonthLifecycle,
  resolveWorkingDays,
  type PlantMonthLifecycle,
} from "./plant-lifecycle";
import { buildPlantWeeklySummary, type PlantWeeklySummary, type WeeklyInputPlanItem } from "./plant-weekly-engine";
import { buildPlantWarnings, buildPlantWeeklyWarnings, DEFAULT_PLANT_WARNING_THRESHOLDS, type PlantWarningThresholds } from "./plant-warnings";
import { buildPlantRecommendations } from "./plant-recommendations";
import { buildPlanItems } from "../routes/plan";
import { annotateWeeklyRelease, type CalcPlanItem } from "./calc";
import type { PlantSegment } from "./plant-segments";
import { commitSha } from "./buildInfo";

export type MonitoringStatus = "live" | "grace" | "frozen" | "unavailable" | "future";
export type MonitoringSegment = PlantSegment;

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
  targetBasis?: "fitted" | "demand";
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
  actualsSource: "plant_ingestion_cache" | "plumbing_sheet3";
  actualsCachedAt: string;
  sourceSnapshotDate: string | null;
  planVersions: Array<{
    kind: PlanVersion["kind"];
    sourceId: number;
    sourceLabel: string | null;
    effectiveFrom: string;
    effectiveTo: string | null;
    targetCount: number;
    selection: PlanVersion["selection"];
    supersededSameDaySources?: PlanVersion["supersededSameDaySources"];
  }>;
  /**
   * Complete issued timeline, including item-level W1-W4 targets, frozen at
   * capture time for downstream auditable historical reports.
   */
  planVersionTimeline?: PlanVersion[];
  /**
   * Set only when a pre-timeline monitoring snapshot was restored from the
   * immutable issued-version rows named in its own captured provenance.
   */
  planVersionTimelineBackfilledAt?: string;
  planVersionTimelineSource?: "issued_plan_version_snapshot";
}

export interface LegacyWeeklyResult {
  itemCode: string;
  colour: string;
  category: string;
  productionPlan: number;
  minProduction: number;
  bufferReq: number | null;
}

export interface LegacyWeeklyInput {
  itemCode: string;
  colour: string;
  avg3MoSale: number;
  stock: number;
  pendingLastMonth: number;
  pendingCurrent: number;
}

export interface LegacyWeeklyBand {
  categoryName: string;
  w1Upper: number;
  w2Upper: number;
  w3Upper: number;
  w4Upper: number;
}

type SnapshotPlanVersionReference = {
  kind: PlanVersion["kind"];
  sourceId: number;
  sourceLabel: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  targetCount: number;
  selection?: PlanVersion["selection"];
  supersededSameDaySources?: PlanVersion["supersededSameDaySources"];
};

export type LegacySnapshotTimelineBackfillResult = {
  snapshot: typeof plantMonthSnapshotsTable.$inferSelect | null;
  restored: boolean;
  reason: string | null;
};

type MonitoringSnapshotPayload = {
  kind: "plant_monitoring";
  actualsJson: unknown;
  targetsJson: unknown;
  bundleJson: unknown;
  weeklyJson: unknown;
  sourceInfoJson: unknown;
};

function snapshotPayload(snapshot: typeof plantMonthSnapshotsTable.$inferSelect): MonitoringSnapshotPayload {
  const payload = isRecord(snapshot.payloadJson) ? snapshot.payloadJson : {};
  return {
    kind: "plant_monitoring",
    actualsJson: payload.actualsJson ?? [],
    targetsJson: payload.targetsJson ?? [],
    bundleJson: payload.bundleJson ?? {},
    weeklyJson: payload.weeklyJson ?? {},
    sourceInfoJson: payload.sourceInfoJson ?? snapshot.planEvidenceJson,
  };
}

export function getPlantMonitoringSnapshotPayload(
  snapshot: typeof plantMonthSnapshotsTable.$inferSelect,
): MonitoringSnapshotPayload {
  return snapshotPayload(snapshot);
}

const PLAN_VERSION_KINDS = new Set<PlanVersion["kind"]>(["run", "import", "corrective"]);
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const pendingLegacySnapshotBackfills = new Map<string, Promise<LegacySnapshotTimelineBackfillResult>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSnapshotPlanVersionReference(value: unknown, month: string): value is SnapshotPlanVersionReference {
  if (!isRecord(value)) return false;
  return PLAN_VERSION_KINDS.has(value.kind as PlanVersion["kind"])
    && typeof value.sourceId === "number"
    && Number.isInteger(value.sourceId)
    && (typeof value.sourceLabel === "string" || value.sourceLabel === null)
    && typeof value.effectiveFrom === "string"
    && ISO_DATE_RE.test(value.effectiveFrom)
    && value.effectiveFrom.slice(0, 7) === month
    && (value.effectiveTo === null || (
      typeof value.effectiveTo === "string"
      && ISO_DATE_RE.test(value.effectiveTo)
      && value.effectiveTo.slice(0, 7) === month
    ))
    && typeof value.targetCount === "number"
    && Number.isInteger(value.targetCount)
    && value.targetCount >= 0;
}

function isVersionTarget(value: unknown): value is VersionTarget {
  if (!isRecord(value)) return false;
  return typeof value.itemCode === "string"
    && typeof value.colour === "string"
    && typeof value.category === "string"
    && ["maxPcs", "minPcs", "w1", "w2", "w3", "w4"]
      .every((field) => typeof value[field] === "number" && Number.isFinite(value[field] as number));
}

function legacyTimelineReferences(
  sourceInfo: unknown,
  month: string,
): { refs: SnapshotPlanVersionReference[]; reason: string | null } {
  if (!isRecord(sourceInfo) || !Array.isArray(sourceInfo.planVersions) || sourceInfo.planVersions.length === 0) {
    return {
      refs: [],
      reason: "The frozen snapshot predates item-level plan-version retention and has no captured issued-version provenance to restore it safely.",
    };
  }
  if (!sourceInfo.planVersions.every((version) => isSnapshotPlanVersionReference(version, month))) {
    return {
      refs: [],
      reason: "The frozen snapshot has incomplete issued-version provenance, so its item-level weekly plan cannot be proven.",
    };
  }
  const refs = sourceInfo.planVersions as SnapshotPlanVersionReference[];
  if (refs.length !== 1 || refs[0]?.kind !== "run") {
    return {
      refs: [],
      reason: "The frozen snapshot contains multiple issued plan revisions without captured item-level evidence for each revision, so its historical weekly plan remains unavailable.",
    };
  }
  const sourceKeys = new Set(refs.map((version) => `${version.kind}:${version.sourceId}`));
  if (sourceKeys.size !== refs.length) {
    return {
      refs: [],
      reason: "The frozen snapshot has duplicate issued-version provenance, so its governing plan sequence is ambiguous.",
    };
  }
  if (new Set(refs.map((version) => version.effectiveFrom)).size !== refs.length) {
    return {
      refs: [],
      reason: "The frozen snapshot has same-day issued versions without a captured canonical selection, so its governing plan sequence is ambiguous.",
    };
  }
  for (let index = 0; index < refs.length; index++) {
    const expectedEnd = refs[index + 1]?.effectiveFrom ?? null;
    if (refs[index]!.effectiveTo !== expectedEnd) {
      return {
        refs: [],
        reason: "The frozen snapshot has an incomplete issued-version date range, so its weekly plan sequence cannot be proven.",
      };
    }
  }
  return { refs, reason: null };
}

function withBackfilledSourceInfo(
  sourceInfo: Record<string, unknown>,
  timeline: PlanVersion[],
  restoredAt: string,
): PlantSnapshotSourceInfo {
  return {
    ...(sourceInfo as unknown as PlantSnapshotSourceInfo),
    planVersionTimeline: timeline,
    planVersionTimelineSource: "issued_plan_version_snapshot",
    planVersionTimelineBackfilledAt: restoredAt,
  };
}

function withBackfilledBundle(
  bundleJson: unknown,
  sourceInfo: PlantSnapshotSourceInfo,
): unknown {
  if (!isRecord(bundleJson) || !isRecord(bundleJson.context)) return bundleJson;
  return {
    ...bundleJson,
    context: {
      ...bundleJson.context,
      sourceInfo,
    },
  };
}

function frozenTargetsMatchIssuedRun(
  snapshotTargets: unknown,
  issuedTargets: VersionTarget[],
): boolean {
  if (!Array.isArray(snapshotTargets)) return false;
  const snapshotByKey = new Map<string, { maxPcs: number; minPcs: number }>();
  for (const target of snapshotTargets) {
    if (!isRecord(target)
      || typeof target.itemCode !== "string"
      || typeof target.colour !== "string"
      || typeof target.category !== "string"
      || typeof target.maxPcs !== "number"
      || !Number.isFinite(target.maxPcs)
      || typeof target.minPcs !== "number"
      || !Number.isFinite(target.minPcs)) {
      return false;
    }
    snapshotByKey.set(
      `${target.itemCode}::${target.colour}::${target.category}`,
      { maxPcs: target.maxPcs, minPcs: target.minPcs },
    );
  }
  if (snapshotByKey.size !== issuedTargets.length) return false;
  return issuedTargets.every((target) => {
    const frozen = snapshotByKey.get(`${target.itemCode}::${target.colour}::${target.category}`);
    return frozen?.maxPcs === target.maxPcs && frozen.minPcs === target.minPcs;
  });
}

async function restoreLegacySnapshotTimeline(
  snapshot: typeof plantMonthSnapshotsTable.$inferSelect,
): Promise<LegacySnapshotTimelineBackfillResult> {
  const payload = snapshotPayload(snapshot);
  const existingSourceInfo = payload.sourceInfoJson;
  if (isRecord(existingSourceInfo)
    && Array.isArray(existingSourceInfo.planVersionTimeline)
    && existingSourceInfo.planVersionTimeline.length > 0) {
    return { snapshot, restored: false, reason: null };
  }

  const { refs, reason } = legacyTimelineReferences(existingSourceInfo, snapshot.month);
  if (reason) return { snapshot, restored: false, reason };

  // This reads only the immutable issued-version snapshots explicitly named by
  // the original monitoring snapshot. It deliberately does not call the live
  // timeline hydrator, rebuild a plan, or read editable release-band settings.
  const immutableRows = await db
    .select()
    .from(plantPlanVersionsTable)
    .where(and(
      eq(plantPlanVersionsTable.month, snapshot.month),
      eq(plantPlanVersionsTable.segment, snapshot.segment),
    ));
  const immutableBySource = new Map(immutableRows.map((row) => [`${row.kind}:${row.sourceId}`, row]));
  const timeline: PlanVersion[] = [];
  let capturedFinalRunTargets: VersionTarget[] | null = null;

  for (const ref of refs) {
    const immutable = immutableBySource.get(`${ref.kind}:${ref.sourceId}`);
    if (!immutable
      || immutable.kind !== ref.kind
      || immutable.effectiveFrom !== ref.effectiveFrom
      || immutable.createdAt.getTime() > snapshot.capturedAt.getTime()) {
      return {
        snapshot,
        restored: false,
        reason: "The frozen snapshot's captured plan-version provenance has no matching immutable issued snapshot from the time of capture.",
      };
    }
    const targets = immutable.targetsJson;
    if (!Array.isArray(targets) || targets.length !== ref.targetCount || !targets.every(isVersionTarget)) {
      return {
        snapshot,
        restored: false,
        reason: "The matching immutable issued snapshot does not contain complete item-level W1–W4 targets.",
      };
    }
    if (
      ref.kind === "run"
      && isRecord(existingSourceInfo)
      && ref.sourceId === existingSourceInfo.planRunId
    ) {
      capturedFinalRunTargets = targets;
    }
    timeline.push({
      kind: ref.kind,
      sourceId: ref.sourceId,
      sourceLabel: ref.sourceLabel,
      effectiveFrom: ref.effectiveFrom,
      effectiveTo: ref.effectiveTo,
      targets,
      ...(ref.selection ? { selection: ref.selection } : {}),
      ...(ref.supersededSameDaySources ? { supersededSameDaySources: ref.supersededSameDaySources } : {}),
    });
  }
  if (!capturedFinalRunTargets || !frozenTargetsMatchIssuedRun(payload.targetsJson, capturedFinalRunTargets)) {
    return {
      snapshot,
      restored: false,
      reason: "The immutable issued plan does not match the final target roster frozen in this snapshot, so its item-level weekly detail cannot be proven.",
    };
  }

  const restoredAt = new Date().toISOString();
  const sourceInfo = withBackfilledSourceInfo(existingSourceInfo as Record<string, unknown>, timeline, restoredAt);
  const [saved] = await db
    .update(plantMonthSnapshotsTable)
    .set({
      payloadJson: {
        ...payload,
        sourceInfoJson: sourceInfo,
        bundleJson: withBackfilledBundle(payload.bundleJson, sourceInfo),
      },
      sourcePlanVersionsJson: timeline,
      planEvidenceJson: {
        ...(isRecord(snapshot.planEvidenceJson) ? snapshot.planEvidenceJson : {}),
        ...sourceInfo,
      },
    })
    // A request and the scheduler can both discover the legacy row. Only the
    // first writer may attach a timeline; later callers reload that winner.
    .where(and(
      eq(plantMonthSnapshotsTable.month, snapshot.month),
      eq(plantMonthSnapshotsTable.segment, snapshot.segment),
      sql`coalesce(${plantMonthSnapshotsTable.payloadJson} -> 'sourceInfoJson' -> 'planVersionTimeline', '[]'::jsonb) = '[]'::jsonb`,
    ))
    .returning();
  if (saved) return { snapshot: saved, restored: true, reason: null };

  const [winner] = await db
    .select()
    .from(plantMonthSnapshotsTable)
    .where(and(
      eq(plantMonthSnapshotsTable.month, snapshot.month),
      eq(plantMonthSnapshotsTable.segment, snapshot.segment),
    ));
  const winnerSourceInfo = winner ? snapshotPayload(winner).sourceInfoJson : null;
  if (isRecord(winnerSourceInfo)
    && Array.isArray(winnerSourceInfo.planVersionTimeline)
    && winnerSourceInfo.planVersionTimeline.length > 0) {
    return { snapshot: winner, restored: false, reason: null };
  }
  return {
    snapshot: winner ?? snapshot,
    restored: false,
    reason: "The frozen snapshot changed while its immutable plan timeline was being restored. It was left unavailable rather than overwrite concurrent data.",
  };
}

/**
 * Restore a legacy closed-month snapshot only when its own captured version
 * provenance can be matched to immutable item-level issued snapshots. This is
 * intentionally narrower than getPlanVersionTimeline(): it never hydrates from
 * mutable current source tables or substitutes today's plan history.
 */
export async function backfillLegacyPlantMonitoringSnapshot(
  month: string,
  segment: MonitoringSegment = "PTMT",
): Promise<LegacySnapshotTimelineBackfillResult> {
  const key = `${month}:${segment}`;
  const pending = pendingLegacySnapshotBackfills.get(key);
  if (pending) return pending;
  const work = (async () => {
    const snapshot = await loadSavedSnapshot(month, segment);
    if (!snapshot) return { snapshot: null, restored: false, reason: "No frozen monitoring snapshot exists for this closed month." };
    return restoreLegacySnapshotTimeline(snapshot);
  })().finally(() => pendingLegacySnapshotBackfills.delete(key));
  pendingLegacySnapshotBackfills.set(key, work);
  return work;
}

/** Backfill every eligible legacy PTMT monitoring snapshot without recapturing data. */
export async function backfillLegacyPlantMonitoringSnapshots(): Promise<Array<{
  month: string;
  segment: MonitoringSegment;
  restored: boolean;
  reason: string | null;
}>> {
  const snapshots = await db
    .select({ month: plantMonthSnapshotsTable.month, segment: plantMonthSnapshotsTable.segment })
    .from(plantMonthSnapshotsTable)
    .where(eq(plantMonthSnapshotsTable.planStatus, "monitoring"));
  const outcomes: Array<{ month: string; segment: MonitoringSegment; restored: boolean; reason: string | null }> = [];
  for (const snapshot of snapshots) {
    if (snapshot.segment !== "PTMT" && snapshot.segment !== "Plumbing") continue;
    const result = await backfillLegacyPlantMonitoringSnapshot(snapshot.month, snapshot.segment);
    outcomes.push({ month: snapshot.month, segment: snapshot.segment, restored: result.restored, reason: result.reason });
  }
  return outcomes;
}

/**
 * Legacy plan-run result rows did not persist W1–W4. Reconstruct their
 * release from the immutable inputs captured with the run and the retained
 * release-band source, never from today's live plan.
 */
export function reconstructLegacyWeeklyPlanItems(
  results: LegacyWeeklyResult[],
  inputs: LegacyWeeklyInput[],
  bands: LegacyWeeklyBand[],
): WeeklyInputPlanItem[] {
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
  return legacyItems;
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

async function loadConfig(month: string, segment: MonitoringSegment = "PTMT") {
  const [row] = await db.select().from(plantConfigsTable).where(and(
    eq(plantConfigsTable.month, month),
    eq(plantConfigsTable.segment, segment),
  ));
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

async function fetchSegmentActuals(
  month: string,
  segment: MonitoringSegment,
  options: { forceRefresh?: boolean; requireFresh?: boolean } = {},
): Promise<DailyActualRow[]> {
  if (segment === "PTMT") return fetchDailyActuals(month, options, segment);
  return (await refreshPlumbingActualsCache(month)).actuals;
}

async function loadSegmentActuals(month: string, segment: MonitoringSegment) {
  if (segment === "PTMT") return loadStoredDailyActualsForSegment(month, segment);
  return refreshPlumbingActualsCache(month);
}

async function loadFinalizedTargets(month: string, segment: MonitoringSegment = "PTMT"): Promise<{
  run: typeof planRunsTable.$inferSelect;
  targets: PlantTargetRow[];
  planItems: WeeklyInputPlanItem[];
  weeklyTargetSource: PlantSnapshotSourceInfo["weeklyTargetSource"];
  weeklyBandSnapshot: PlantSnapshotSourceInfo["weeklyBandSnapshot"];
  targetBasis: "fitted" | "demand";
  versionTimeline: PlanVersion[];
} | null> {
  const [run] = await db
    .select()
    .from(planRunsTable)
    .where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, segment), eq(planRunsTable.status, "finalized")))
    .orderBy(sql`CASE WHEN ${planRunsTable.planType} = 'production' THEN 0 ELSE 1 END`, desc(planRunsTable.id))
    .limit(1);
  if (!run) return null;
  const [results, versionTimeline] = await Promise.all([
    db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, run.id)),
    fetchMonitoringPlanTimeline(month, segment),
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
      db.select().from(weeklyReleaseBandsTable).where(eq(weeklyReleaseBandsTable.segment, segment)),
    ]);
    planItems = reconstructLegacyWeeklyPlanItems(results, inputs, bands);
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
    targetBasis: run.planType === "temporary" ? "demand" : "fitted",
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

async function hasFinalizedTargets(month: string, segment: MonitoringSegment = "PTMT"): Promise<boolean> {
  const [run] = await db
    .select({ id: planRunsTable.id })
    .from(planRunsTable)
    .where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, segment), eq(planRunsTable.status, "finalized")))
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
  segment: MonitoringSegment = "PTMT",
) {
  const { row, config } = await loadConfig(month, segment);
  const observedDates = actuals.map((row) => row.date);
  const latestObservedDate = actuals.length ? observedDates.sort().at(-1)! : null;
  const snapshotDate = config.snapshotDate ?? (
    lifecycle.state === "closed" || lifecycle.state === "grace"
      ? (actuals.length ? lastProductionDay(month, observedDates) : null)
      : latestObservedDate
  );
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
    targetBasis: finalized.targetBasis,
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

async function loadSavedSnapshot(month: string, segment: MonitoringSegment = "PTMT") {
  const [snapshot] = await db
    .select()
    .from(plantMonthSnapshotsTable)
    .where(and(
      eq(plantMonthSnapshotsTable.month, month),
      eq(plantMonthSnapshotsTable.segment, segment),
      eq(plantMonthSnapshotsTable.planStatus, "monitoring"),
    ));
  return snapshot ?? null;
}

export async function backfillPlantSnapshotProvenance(
  month: string,
  segment: MonitoringSegment,
  verifiedOn: string,
): Promise<
  | { ok: true; snapshotId: number; capturedCommitSha: string; planStatusReason: string }
  | { ok: false; reason: "SNAPSHOT_NOT_FOUND" | "PROVENANCE_ALREADY_SET" }
> {
  const existing = await loadSavedSnapshot(month, segment);
  if (!existing) return { ok: false, reason: "SNAPSHOT_NOT_FOUND" };
  if (existing.capturedCommitSha) return { ok: false, reason: "PROVENANCE_ALREADY_SET" };

  const capturedCommitSha = commitSha === "(unknown)" ? "unknown-lazy-capture" : commitSha;
  const planStatusReason =
    `Captured by lazy capture after the parity deploy; figures verified against the source on ${verifiedOn}.`;
  const [updated] = await db
    .update(plantMonthSnapshotsTable)
    .set({ capturedCommitSha, backfilled: true, planStatusReason })
    .where(and(
      eq(plantMonthSnapshotsTable.id, existing.id),
      isNull(plantMonthSnapshotsTable.capturedCommitSha),
    ))
    .returning({
      id: plantMonthSnapshotsTable.id,
      capturedCommitSha: plantMonthSnapshotsTable.capturedCommitSha,
      planStatusReason: plantMonthSnapshotsTable.planStatusReason,
    });

  if (!updated) return { ok: false, reason: "PROVENANCE_ALREADY_SET" };
  return {
    ok: true,
    snapshotId: updated.id,
    capturedCommitSha: updated.capturedCommitSha ?? capturedCommitSha,
    planStatusReason: updated.planStatusReason ?? planStatusReason,
  };
}

export async function captureClosedPlantMonth(
  month: string,
  now = new Date(),
  options: { refreshActuals?: boolean } = {},
  segment: MonitoringSegment = "PTMT",
): Promise<
  | { ok: true; bundle: LifecyclePlantBundle; weekly: PlantWeeklySummary; capturedAt: string }
  | { ok: false; reason: string; code: "MONTH_NOT_CLOSED" | "FINALIZED_PLAN_MISSING" | "ACTUALS_REFRESH_FAILED" | "ACTUALS_SNAPSHOT_MISSING" }
> {
  const lifecycle = resolvePlantMonthLifecycle(month, now);
  if (lifecycle.state !== "closed") {
    return { ok: false, code: "MONTH_NOT_CLOSED", reason: "Only closed months can be frozen." };
  }
  const existing = await loadSavedSnapshot(month, segment);
  if (existing) {
    const payload = snapshotPayload(existing);
    return {
      ok: true,
      bundle: payload.bundleJson as LifecyclePlantBundle,
      weekly: payload.weeklyJson as PlantWeeklySummary,
      capturedAt: existing.capturedAt.toISOString(),
    };
  }
  const finalized = await loadFinalizedTargets(month, segment);
  if (!finalized) {
    return { ok: false, code: "FINALIZED_PLAN_MISSING", reason: `Targets unavailable — no finalized ${segment} plan was issued for this month.` };
  }
  if (options.refreshActuals !== false) {
    try {
      await fetchSegmentActuals(month, segment, { forceRefresh: true, requireFresh: true });
    } catch {
      return {
        ok: false,
        code: "ACTUALS_REFRESH_FAILED",
        reason: "Historical actuals unavailable — the production source could not be refreshed for snapshot capture.",
      };
    }
  }
  const stored = await loadSegmentActuals(month, segment);
  if (!stored.cachedAt) {
    return { ok: false, code: "ACTUALS_SNAPSHOT_MISSING", reason: "Historical actuals unavailable — no stored production snapshot exists for this month." };
  }
  const capturedAt = new Date();
  const sourceInfo: PlantSnapshotSourceInfo = {
    targetSource: "finalized_plan_run",
    targetBasis: finalized.targetBasis,
    planRunId: finalized.run.id,
    planAsOfAt: finalized.run.asOfAt.toISOString(),
    weeklyTargetSource: finalized.weeklyTargetSource,
    weeklyBandSnapshot: finalized.weeklyBandSnapshot,
    actualsSource: segment === "PTMT" ? "plant_ingestion_cache" : "plumbing_sheet3",
    actualsCachedAt: stored.cachedAt.toISOString(),
    sourceSnapshotDate: stored.snapshotDate,
    planVersions: finalized.versionTimeline.map((version) => ({
      kind: version.kind,
      sourceId: version.sourceId,
      sourceLabel: version.sourceLabel,
      effectiveFrom: version.effectiveFrom,
      effectiveTo: version.effectiveTo,
      targetCount: version.targets.length,
      selection: version.selection,
      supersededSameDaySources: version.supersededSameDaySources,
    })),
    planVersionTimeline: finalized.versionTimeline,
  };
  const { bundle, snapshotDate } = await buildReadyBundle(
    month,
    stored.actuals,
    finalized.targets,
    lifecycle,
    { ...sourceInfo, segment },
    capturedAt.toISOString(),
    finalized.versionTimeline,
    segment,
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
  await db.insert(plantMonthSnapshotsTable).values({
    month,
    segment,
    payloadJson: {
      kind: "plant_monitoring",
      actualsJson: stored.actuals,
      targetsJson: finalized.targets,
      bundleJson: bundle,
      weeklyJson: weekly,
      sourceInfoJson: sourceInfo,
    },
    sourcePlanVersionsJson: finalized.versionTimeline,
    closedAt: new Date(lifecycle.closedAt ?? capturedAt),
    capturedAt,
    capturedCommitSha: commitSha === "(unknown)" ? "unknown-lazy-capture" : commitSha,
    planStatus: "monitoring",
    planEvidenceJson: sourceInfo,
  }).onConflictDoNothing({
    target: [plantMonthSnapshotsTable.month, plantMonthSnapshotsTable.segment],
  });
  const [saved] = await db
    .select()
    .from(plantMonthSnapshotsTable)
    .where(and(
      eq(plantMonthSnapshotsTable.month, month),
      eq(plantMonthSnapshotsTable.segment, segment),
      eq(plantMonthSnapshotsTable.planStatus, "monitoring"),
    ));
  if (!saved) {
    return { ok: false, code: "ACTUALS_SNAPSHOT_MISSING", reason: "Historical actuals unavailable — the monitoring snapshot could not be persisted." };
  }
  const savedPayload = snapshotPayload(saved);
  return {
    ok: true,
    bundle: savedPayload.bundleJson as LifecyclePlantBundle,
    weekly: savedPayload.weeklyJson as PlantWeeklySummary,
    capturedAt: saved.capturedAt.toISOString(),
  };
}

export async function computeLifecyclePlantMonitoring(
  month: string,
  now = new Date(),
  dependencies: {
    fetchActuals?: (month: string, options: { forceRefresh?: boolean; requireFresh?: boolean }) => Promise<DailyActualRow[]>;
  } = {},
  segment: MonitoringSegment = "PTMT",
): Promise<{
  bundle: LifecyclePlantBundle;
  weekly: PlantWeeklySummary;
  planItems?: CalcPlanItem[];
}> {
  const lifecycle = resolvePlantMonthLifecycle(month, now);
  const { row, config } = await loadConfig(month, segment);
  if (lifecycle.state === "future") {
    const bundle = emptyBundle(month, lifecycle, config, "future", "No plan issued — this is a future month.");
    return { bundle, weekly: buildWeekly(month, [], [], [], null, lifecycle) };
  }
  if (lifecycle.state === "closed") {
    const saved = await loadSavedSnapshot(month, segment);
    if (saved) {
      const payload = snapshotPayload(saved);
      return {
        bundle: payload.bundleJson as LifecyclePlantBundle,
        weekly: payload.weeklyJson as PlantWeeklySummary,
      };
    }
    const finalizedTargetsExist = await hasFinalizedTargets(month, segment);
    const reason = finalizedTargetsExist
      ? "Targets unavailable — no frozen monitoring snapshot has been captured for this closed month."
      : `Targets unavailable — no finalized ${segment} plan was issued for this month.`;
    const bundle = emptyBundle(month, lifecycle, config, "unavailable", reason);
    return { bundle, weekly: buildWeekly(month, [], [], [], null, lifecycle) };
  }

  const fetchActuals = dependencies.fetchActuals ?? (
    (selectedMonth, options) => fetchSegmentActuals(selectedMonth, segment, options)
  );
  let targets: PlantTargetRow[];
  let planItems: WeeklyInputPlanItem[] = [];
  let alertPlanItems: CalcPlanItem[] | undefined;
  let sourceInfo: Record<string, unknown> | null = null;
  let versionTimeline: PlanVersion[] = [];
  let actuals: DailyActualRow[];
  if (lifecycle.state === "grace") {
    const finalized = await loadFinalizedTargets(month, segment);
    if (!finalized) {
      const bundle = emptyBundle(month, lifecycle, config, "unavailable", `Targets unavailable — no finalized ${segment} plan was issued for this month.`);
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
      targetBasis: finalized.targetBasis,
      planRunId: finalized.run.id,
      weeklyTargetSource: finalized.weeklyTargetSource,
      acceptsLateActuals: true,
      planVersions: finalized.versionTimeline.map((version) => ({
        kind: version.kind,
        sourceId: version.sourceId,
        sourceLabel: version.sourceLabel,
        effectiveFrom: version.effectiveFrom,
        effectiveTo: version.effectiveTo,
        targetCount: version.targets.length,
        selection: version.selection,
        supersededSameDaySources: version.supersededSameDaySources,
      })),
    };
  } else {
    actuals = await fetchActuals(month, {});
    const liveItems = await buildPlanItems(month, segment);
    alertPlanItems = liveItems;
    versionTimeline = await fetchMonitoringPlanTimeline(month, segment);
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
        sourceLabel: version.sourceLabel,
        effectiveFrom: version.effectiveFrom,
        effectiveTo: version.effectiveTo,
        targetCount: version.targets.length,
        selection: version.selection,
        supersededSameDaySources: version.supersededSameDaySources,
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
    segment,
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
  return { bundle, weekly, planItems: alertPlanItems };
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
  segment: MonitoringSegment;
  result: Awaited<ReturnType<typeof captureClosedPlantMonth>>;
}>> {
  const [finalizedRuns, snapshots] = await Promise.all([
    db
      .select({ month: planRunsTable.month, segment: planRunsTable.segment })
      .from(planRunsTable)
      .where(and(
        eq(planRunsTable.status, "finalized"),
        sql`${planRunsTable.segment} in ('PTMT', 'Plumbing')`,
      ))
      .orderBy(desc(planRunsTable.month)),
    db
      .select({ month: plantMonthSnapshotsTable.month, segment: plantMonthSnapshotsTable.segment })
      .from(plantMonthSnapshotsTable)
      .where(eq(plantMonthSnapshotsTable.planStatus, "monitoring")),
  ]);
  const frozen = new Set(snapshots.map((snapshot) => `${snapshot.month}:${snapshot.segment}`));
  const candidates = [...new Map(
    finalizedRuns
      .filter((run): run is { month: string; segment: MonitoringSegment } =>
        (run.segment === "PTMT" || run.segment === "Plumbing")
        && resolvePlantMonthLifecycle(run.month, now).state === "closed"
        && !frozen.has(`${run.month}:${run.segment}`),
      )
      .map((run) => [`${run.month}:${run.segment}`, run]),
  ).values()].sort((a, b) => b.month.localeCompare(a.month) || a.segment.localeCompare(b.segment));
  const outcomes: Array<{
    month: string;
    segment: MonitoringSegment;
    result: Awaited<ReturnType<typeof captureClosedPlantMonth>>;
  }> = [];
  for (const { month, segment } of candidates) {
    outcomes.push({ month, segment, result: await captureClosedPlantMonth(month, now, {}, segment) });
  }
  return outcomes;
}