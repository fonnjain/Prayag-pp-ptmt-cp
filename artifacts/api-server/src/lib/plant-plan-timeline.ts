import {
  db,
  plantPlanVersionsTable,
  planRunsTable,
  planRunResultsTable,
  planRunInputsTable,
  plantPlanUploadsTable,
  plantPlanItemsTable,
  correctivePlanRunsTable,
  correctivePlanItemsTable,
  weeklyReleaseBandsTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { annotateWeeklyRelease, type CalcPlanItem } from "./calc";

export type PlanVersionKind = "run" | "import" | "corrective";

export interface VersionTarget {
  itemCode: string;
  colour: string;
  category: string;
  maxPcs: number;
  minPcs: number;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
}

export interface PlanVersion {
  kind: PlanVersionKind;
  sourceId: number;
  sourceLabel: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  targets: VersionTarget[];
  /** Compatibility summary of same-day legacy sources superseded by this revision. */
  supersededSameDaySources?: Array<{
    kind: PlanVersionKind;
    sourceId: number;
    sourceLabel: string | null;
  }>;
  /**
   * Legacy history can contain more than one issued source for a single
   * effective date. We retain every row in storage, but expose the exact
   * deterministic choice made for monitoring and audit consumers.
   */
  selection?: {
    candidateCount: number;
    reason: "only_issued_version_for_date" | "latest_source_issuance" | "source_id_tiebreaker";
    canonicalIssuedAt: string | null;
    canonicalIssuedAtSource: "plan_created_at" | "upload_timestamp" | "corrective_created_at" | "snapshot_created_at";
    superseded: Array<{
      kind: PlanVersionKind;
      sourceId: number;
      sourceLabel: string | null;
      issuedAt: string | null;
      issuedAtSource: "plan_created_at" | "upload_timestamp" | "corrective_created_at" | "snapshot_created_at";
    }>;
  };
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function monthStart(month: string): string {
  return `${month}-01`;
}

function legacyEffectiveFrom(month: string, value: string | null | undefined, createdAt: Date): string | null {
  const candidate = value ?? createdAt.toISOString().slice(0, 10);
  return candidate.startsWith(`${month}-`) ? candidate : null;
}

function targetKey(target: Pick<VersionTarget, "itemCode" | "colour" | "category">): string {
  return `${target.itemCode}|${target.colour}|${target.category}`;
}

function hasNoWeeklyAllocation(targets: VersionTarget[]): boolean {
  return targets.length > 0 && targets.every((target) =>
    target.w1 === 0 && target.w2 === 0 && target.w3 === 0 && target.w4 === 0,
  );
}

/**
 * Legacy run-result rows predate persisted W1–W4 columns. Rebuild an
 * allocation only for a zeroed legacy snapshot, using the immutable run input
 * rows and the retained release-band configuration. The returned values
 * override the monitoring timeline only; source history remains untouched.
 */
async function reconstructLegacyWeeklyTargets(
  runIds: number[],
  segment: string,
): Promise<Map<number, Map<string, Pick<VersionTarget, "w1" | "w2" | "w3" | "w4">>>> {
  if (runIds.length === 0) return new Map();
  const [results, inputs, bands] = await Promise.all([
    db.select().from(planRunResultsTable).where(inArray(planRunResultsTable.runId, runIds)),
    db.select().from(planRunInputsTable).where(inArray(planRunInputsTable.runId, runIds)),
    db.select().from(weeklyReleaseBandsTable).where(eq(weeklyReleaseBandsTable.segment, segment)),
  ]);
  const inputsByRunAndKey = new Map(inputs.map((input) => [
    `${input.runId}|${input.itemCode}|${input.colour}`,
    input,
  ]));
  const bandsByCategory = new Map(bands.map((band) => [band.categoryName, band]));
  const rowsByRun = new Map<number, typeof results>();
  for (const result of results) {
    const rows = rowsByRun.get(result.runId) ?? [];
    rows.push(result);
    rowsByRun.set(result.runId, rows);
  }

  const output = new Map<number, Map<string, Pick<VersionTarget, "w1" | "w2" | "w3" | "w4">>>();
  for (const [runId, runResults] of rowsByRun) {
    const items: CalcPlanItem[] = runResults.map((result) => {
      const input = inputsByRunAndKey.get(`${runId}|${result.itemCode}|${result.colour}`);
      const avg3MoSale = input?.avg3MoSale ?? 0;
      const stock = input?.stock ?? 0;
      return {
        itemCode: result.itemCode,
        colour: result.colour,
        category: result.category,
        avg3MoSale,
        stock,
        stockNeedsReview: false,
        bufferReq: result.bufferReq,
        minProduction: result.minProduction,
        maxProduction: result.productionPlan,
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
    annotateWeeklyRelease(items, bandsByCategory);
    output.set(runId, new Map(items.map((item) => [
      targetKey(item),
      { w1: item.w1, w2: item.w2, w3: item.w3, w4: item.w4 },
    ])));
  }
  return output;
}

export function assertEffectiveDate(month: string, value: unknown): string {
  if (typeof value !== "string" || !DATE_RE.test(value) || value.slice(0, 7) !== month) {
    throw new Error(`effectiveFrom must be a YYYY-MM-DD date within ${month}`);
  }
  const [year, monthNumber, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, monthNumber - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== monthNumber - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new Error(`effectiveFrom must be a valid calendar date within ${month}`);
  }
  return value;
}

export function defaultEffectiveDate(month: string, now = new Date()): string {
  const today = now.toISOString().slice(0, 10);
  return today.slice(0, 7) === month ? today : monthStart(month);
}

export async function savePlanVersionSnapshot(input: {
  month: string;
  segment: string;
  kind: PlanVersionKind;
  sourceId: number;
  effectiveFrom: string;
  sourceLabel?: string | null;
  targets: VersionTarget[];
}): Promise<void> {
  assertEffectiveDate(input.month, input.effectiveFrom);
  await db
    .insert(plantPlanVersionsTable)
    .values({
      month: input.month,
      segment: input.segment,
      kind: input.kind,
      sourceId: input.sourceId,
      effectiveFrom: input.effectiveFrom,
      sourceLabel: input.sourceLabel ?? null,
      targetsJson: input.targets,
    })
    // A source ID represents one issued plan revision. Its item-level target
    // content must never be rewritten, because closed monitoring snapshots may
    // later cite this exact row as their immutable historical evidence.
    .onConflictDoNothing();
}

/**
 * Return plan versions in the order in which they governed production. Source
 * status is checked here rather than trusting a snapshot alone, so draft runs
 * can never influence monitoring.
 */
export async function getPlanVersionTimeline(month: string, segment: string): Promise<PlanVersion[]> {
  const key = `${segment}|${month}`;
  const inFlightHydration = pendingLegacyHydrations.get(key);
  if (inFlightHydration) await inFlightHydration;
  let snapshots = await db
    .select()
    .from(plantPlanVersionsTable)
    .where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, segment)))
    .orderBy(asc(plantPlanVersionsTable.effectiveFrom), asc(plantPlanVersionsTable.createdAt), asc(plantPlanVersionsTable.id));
  if (snapshots.length === 0) {
    let hydration = pendingLegacyHydrations.get(key);
    if (!hydration) {
      hydration = hydrateLegacyPlanVersions(month, segment).finally(() => pendingLegacyHydrations.delete(key));
      pendingLegacyHydrations.set(key, hydration);
    }
    await hydration;
    snapshots = await db
      .select()
      .from(plantPlanVersionsTable)
      .where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, segment)))
      .orderBy(asc(plantPlanVersionsTable.effectiveFrom), asc(plantPlanVersionsTable.createdAt), asc(plantPlanVersionsTable.id));
  }

  const runIds = snapshots.filter((row) => row.kind === "run").map((row) => row.sourceId);
  const finalizedRunIds = runIds.length === 0
    ? new Set<number>()
    : new Set(
      (await db.select({ id: planRunsTable.id }).from(planRunsTable)
        .where(and(inArray(planRunsTable.id, runIds), eq(planRunsTable.status, "finalized"))))
        .map((row) => row.id),
    );

  // Legacy data can contain several issued revisions on one effective date.
  // New writes are rejected by validateNewVersionDate, but source history must
  // remain intact. Select the source issued latest on that day rather than
  // relying on the order in which version-table backfill happened.
  const runIdsForAudit = snapshots.filter((row) => row.kind === "run").map((row) => row.sourceId);
  const importIdsForAudit = snapshots.filter((row) => row.kind === "import").map((row) => row.sourceId);
  const correctiveIdsForAudit = snapshots.filter((row) => row.kind === "corrective").map((row) => row.sourceId);
  const [runsForAudit, importsForAudit, correctivesForAudit] = await Promise.all([
    runIdsForAudit.length
      ? db.select({
        id: planRunsTable.id,
        createdAt: planRunsTable.createdAt,
        weeklyReleaseVersion: planRunsTable.weeklyReleaseVersion,
      }).from(planRunsTable).where(inArray(planRunsTable.id, runIdsForAudit))
      : Promise.resolve([]),
    importIdsForAudit.length
      ? db.select({
        id: plantPlanUploadsTable.id,
        uploadedAt: plantPlanUploadsTable.uploadedAt,
      }).from(plantPlanUploadsTable).where(inArray(plantPlanUploadsTable.id, importIdsForAudit))
      : Promise.resolve([]),
    correctiveIdsForAudit.length
      ? db.select({
        id: correctivePlanRunsTable.id,
        createdAt: correctivePlanRunsTable.createdAt,
      }).from(correctivePlanRunsTable).where(inArray(correctivePlanRunsTable.id, correctiveIdsForAudit))
      : Promise.resolve([]),
  ]);
  type IssuedAtSource = NonNullable<PlanVersion["selection"]>["canonicalIssuedAtSource"];
  const sourceIssuedAt = new Map<string, { value: Date; source: IssuedAtSource }>();
  for (const run of runsForAudit) {
    sourceIssuedAt.set(`run:${run.id}`, {
      value: run.createdAt,
      source: "plan_created_at",
    });
  }
  for (const upload of importsForAudit) {
    sourceIssuedAt.set(`import:${upload.id}`, { value: upload.uploadedAt, source: "upload_timestamp" });
  }
  for (const run of correctivesForAudit) {
    sourceIssuedAt.set(`corrective:${run.id}`, { value: run.createdAt, source: "corrective_created_at" });
  }
  const runWeeklyReleaseVersion = new Map(runsForAudit.map((run) => [run.id, run.weeklyReleaseVersion]));
  const legacyRunsNeedingReconstruction = snapshots
    .filter((snapshot) =>
      snapshot.kind === "run"
      && (runWeeklyReleaseVersion.get(snapshot.sourceId) ?? 1) < 1
      && hasNoWeeklyAllocation(snapshot.targetsJson as VersionTarget[]),
    )
    .map((snapshot) => snapshot.sourceId);
  const reconstructedLegacyWeeks = await reconstructLegacyWeeklyTargets(
    [...new Set(legacyRunsNeedingReconstruction)],
    segment,
  );

  const candidatesByDate = new Map<string, Array<{
    row: typeof snapshots[number];
    issuedAt: Date;
    issuedAtSource: IssuedAtSource;
  }>>();
  for (const row of snapshots) {
    if (row.kind === "run" && !finalizedRunIds.has(row.sourceId)) continue;
    const source = sourceIssuedAt.get(`${row.kind}:${row.sourceId}`);
    const candidate = {
      row,
      issuedAt: source?.value ?? row.createdAt,
      issuedAtSource: source?.source ?? "snapshot_created_at",
    };
    const candidates = candidatesByDate.get(row.effectiveFrom) ?? [];
    candidates.push(candidate);
    candidatesByDate.set(row.effectiveFrom, candidates);
  }
  const selected = [...candidatesByDate.entries()]
    .map(([effectiveFrom, candidates]) => {
      const orderedCandidates = [...candidates].sort((a, b) =>
        a.issuedAt.getTime() - b.issuedAt.getTime()
        || a.row.sourceId - b.row.sourceId
        || a.row.id - b.row.id,
      );
      const canonical = orderedCandidates.at(-1)!;
      const hasSameSourceTime = orderedCandidates.length > 1
        && orderedCandidates.at(-2)!.issuedAt.getTime() === canonical.issuedAt.getTime();
      return {
        effectiveFrom,
        canonical,
        selection: {
          candidateCount: orderedCandidates.length,
          reason: (orderedCandidates.length === 1
            ? "only_issued_version_for_date"
            : hasSameSourceTime
              ? "source_id_tiebreaker"
              : "latest_source_issuance") as NonNullable<PlanVersion["selection"]>["reason"],
          canonicalIssuedAt: canonical.issuedAt.toISOString(),
          canonicalIssuedAtSource: canonical.issuedAtSource,
          superseded: orderedCandidates.slice(0, -1).map((candidate) => ({
            kind: candidate.row.kind as PlanVersionKind,
            sourceId: candidate.row.sourceId,
            sourceLabel: candidate.row.sourceLabel,
            issuedAt: candidate.issuedAt.toISOString(),
            issuedAtSource: candidate.issuedAtSource,
          })),
        },
      };
    })
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return selected.map(({ canonical, selection }, index) => {
    const legacyWeeks = canonical.row.kind === "run"
      ? reconstructedLegacyWeeks.get(canonical.row.sourceId)
      : undefined;
    const targets = (canonical.row.targetsJson as VersionTarget[]).map((target) => ({
      ...target,
      ...(legacyWeeks?.get(targetKey(target)) ?? {}),
    }));
    return {
      kind: canonical.row.kind as PlanVersionKind,
      sourceId: canonical.row.sourceId,
      sourceLabel: canonical.row.sourceLabel,
      effectiveFrom: canonical.row.effectiveFrom,
      effectiveTo: selected[index + 1]?.effectiveFrom ?? null,
      targets,
      selection,
      ...(selection.superseded.length > 0 ? {
        supersededSameDaySources: selection.superseded.map(({ kind, sourceId, sourceLabel }) => ({
          kind,
          sourceId,
          sourceLabel,
        })),
      } : {}),
    };
  });
}

const pendingLegacyHydrations = new Map<string, Promise<void>>();

/**
 * Pre-version-table records still contain immutable plan and corrective item
 * rows. Hydrate them once so existing months adopt timeline semantics on their
 * first read instead of falling back to a live rebuild.
 */
async function hydrateLegacyPlanVersions(month: string, segment: string): Promise<void> {
  const [runs, imports, correctiveRuns] = await Promise.all([
    db.select().from(planRunsTable).where(and(
      eq(planRunsTable.month, month),
      eq(planRunsTable.segment, segment),
      eq(planRunsTable.status, "finalized"),
    )).orderBy(asc(planRunsTable.createdAt)),
    db.select().from(plantPlanUploadsTable).where(and(
      eq(plantPlanUploadsTable.month, month),
      eq(plantPlanUploadsTable.segment, segment),
    )).orderBy(asc(plantPlanUploadsTable.uploadedAt)),
    db.select().from(correctivePlanRunsTable).where(and(
      eq(correctivePlanRunsTable.month, month),
      eq(correctivePlanRunsTable.segment, segment),
    )).orderBy(asc(correctivePlanRunsTable.createdAt)),
  ]);

  for (const run of runs) {
    const effectiveFrom = legacyEffectiveFrom(month, run.effectiveFrom, run.createdAt);
    if (!effectiveFrom) continue;
    const [results, linkedCorrectiveRows] = await Promise.all([
      db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, run.id)),
      db.select().from(correctivePlanRunsTable).where(eq(correctivePlanRunsTable.planRunId, run.id)).orderBy(asc(correctivePlanRunsTable.createdAt)).limit(1),
    ]);
    const linkedCorrective = linkedCorrectiveRows[0];
    const allocationRows = linkedCorrective
      ? await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, linkedCorrective.id))
      : [];
    const allocationByKey = new Map(allocationRows.map((item) => [
      `${item.itemCode}|${item.colour}|${item.category}`,
      item.originalWeek ?? 0,
    ]));
    await savePlanVersionSnapshot({
      month,
      segment,
      kind: "run",
      sourceId: run.id,
      effectiveFrom,
      sourceLabel: run.note ?? `Plan run #${run.id} (legacy)`,
      targets: results.map((item) => {
        const week = allocationByKey.get(`${item.itemCode}|${item.colour}|${item.category}`) ?? 0;
        return {
          itemCode: item.itemCode,
          colour: item.colour,
          category: item.category,
          maxPcs: item.productionPlan,
          minPcs: item.minProduction,
          w1: week === 1 ? item.productionPlan : 0,
          w2: week === 2 ? item.productionPlan : 0,
          w3: week === 3 ? item.productionPlan : 0,
          w4: week === 4 ? item.productionPlan : 0,
        };
      }),
    });
  }

  for (const upload of imports) {
    const effectiveFrom = legacyEffectiveFrom(month, upload.effectiveFrom, upload.uploadedAt);
    if (!effectiveFrom) continue;
    const items = await db.select().from(plantPlanItemsTable).where(eq(plantPlanItemsTable.uploadId, upload.id));
    await savePlanVersionSnapshot({
      month,
      segment,
      kind: "import",
      sourceId: upload.id,
      effectiveFrom,
      sourceLabel: upload.filename,
      targets: items.map((item) => ({
        itemCode: item.itemCode,
        colour: "",
        category: item.material || item.itemType,
        maxPcs: item.feasiblePcs,
        minPcs: 0,
        w1: 0,
        w2: 0,
        w3: 0,
        w4: 0,
      })),
    });
  }

  for (const run of correctiveRuns) {
    const effectiveFrom = legacyEffectiveFrom(month, run.effectiveFrom ?? run.asOfDate, run.createdAt);
    if (!effectiveFrom) continue;
    const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, run.id));
    await savePlanVersionSnapshot({
      month,
      segment,
      kind: "corrective",
      sourceId: run.id,
      effectiveFrom,
      sourceLabel: `Corrective run #${run.id} (legacy)`,
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
}

export function versionForDate(versions: PlanVersion[], date: string): PlanVersion | null {
  return versions.find((version) =>
    version.effectiveFrom <= date && (version.effectiveTo === null || date < version.effectiveTo),
  ) ?? null;
}

export async function validateNewVersionDate(input: {
  month: string;
  segment: string;
  effectiveFrom: string;
  sourceId?: number;
  kind?: PlanVersionKind;
}): Promise<void> {
  assertEffectiveDate(input.month, input.effectiveFrom);
  const existing = await getPlanVersionTimeline(input.month, input.segment);
  const conflict = existing.find((version) => version.effectiveFrom === input.effectiveFrom);
  if (conflict && !(conflict.kind === input.kind && conflict.sourceId === input.sourceId)) {
    throw new Error(`A ${input.segment} plan version already takes effect on ${input.effectiveFrom}; choose a later date.`);
  }
  const latest = existing.at(-1);
  if (latest && input.effectiveFrom < latest.effectiveFrom) {
    throw new Error(`effectiveFrom ${input.effectiveFrom} precedes the latest issued plan (${latest.effectiveFrom}). Plan versions must be strictly ordered.`);
  }
}

export async function setSourceEffectiveDate(input: {
  kind: PlanVersionKind;
  sourceId: number;
  effectiveFrom: string;
}): Promise<void> {
  if (input.kind === "run") {
    await db.update(planRunsTable).set({ effectiveFrom: input.effectiveFrom }).where(eq(planRunsTable.id, input.sourceId));
  } else if (input.kind === "import") {
    await db.update(plantPlanUploadsTable).set({ effectiveFrom: input.effectiveFrom }).where(eq(plantPlanUploadsTable.id, input.sourceId));
  } else {
    await db.update(correctivePlanRunsTable).set({ effectiveFrom: input.effectiveFrom }).where(eq(correctivePlanRunsTable.id, input.sourceId));
  }
}

export async function setPlanVersionSnapshotEffectiveDate(input: {
  kind: PlanVersionKind;
  sourceId: number;
  effectiveFrom: string;
}): Promise<void> {
  await db
    .update(plantPlanVersionsTable)
    .set({ effectiveFrom: input.effectiveFrom })
    .where(and(eq(plantPlanVersionsTable.kind, input.kind), eq(plantPlanVersionsTable.sourceId, input.sourceId)));
}