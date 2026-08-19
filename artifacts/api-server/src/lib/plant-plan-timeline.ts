import {
  db,
  plantPlanVersionsTable,
  planRunsTable,
  planRunResultsTable,
  plantPlanUploadsTable,
  plantPlanItemsTable,
  correctivePlanRunsTable,
  correctivePlanItemsTable,
} from "@workspace/db";
import { and, asc, eq, inArray } from "drizzle-orm";

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
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function assertEffectiveDate(month: string, value: unknown): string {
  if (typeof value !== "string" || !DATE_RE.test(value) || value.slice(0, 7) !== month) {
    throw new Error(`effectiveFrom must be a YYYY-MM-DD date within ${month}`);
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
    .onConflictDoUpdate({
      target: [plantPlanVersionsTable.kind, plantPlanVersionsTable.sourceId],
      set: {
        effectiveFrom: input.effectiveFrom,
        sourceLabel: input.sourceLabel ?? null,
        targetsJson: input.targets,
      },
    });
}

/**
 * Return plan versions in the order in which they governed production. Source
 * status is checked here rather than trusting a snapshot alone, so draft runs
 * can never influence monitoring.
 */
export async function getPlanVersionTimeline(month: string, segment: string): Promise<PlanVersion[]> {
  let snapshots = await db
    .select()
    .from(plantPlanVersionsTable)
    .where(and(eq(plantPlanVersionsTable.month, month), eq(plantPlanVersionsTable.segment, segment)))
    .orderBy(asc(plantPlanVersionsTable.effectiveFrom), asc(plantPlanVersionsTable.createdAt), asc(plantPlanVersionsTable.id));
  if (snapshots.length === 0) {
    await hydrateLegacyPlanVersions(month, segment);
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

  // Legacy data may contain identical repeat recomputes. New writes are
  // rejected by validateNewVersionDate; retain only the last legacy snapshot
  // at a date to make the historical timeline deterministic.
  const byDate = new Map<string, typeof snapshots[number]>();
  for (const row of snapshots) {
    if (row.kind === "run" && !finalizedRunIds.has(row.sourceId)) continue;
    byDate.set(row.effectiveFrom, row);
  }
  const ordered = [...byDate.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  return ordered.map((row, index) => ({
    kind: row.kind as PlanVersionKind,
    sourceId: row.sourceId,
    sourceLabel: row.sourceLabel,
    effectiveFrom: row.effectiveFrom,
    effectiveTo: ordered[index + 1]?.effectiveFrom ?? null,
    targets: row.targetsJson as VersionTarget[],
  }));
}

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
    )),
    db.select().from(plantPlanUploadsTable).where(and(
      eq(plantPlanUploadsTable.month, month),
      eq(plantPlanUploadsTable.segment, segment),
    )),
    db.select().from(correctivePlanRunsTable).where(and(
      eq(correctivePlanRunsTable.month, month),
      eq(correctivePlanRunsTable.segment, segment),
    )),
  ]);

  for (const run of runs) {
    const [results, linkedCorrective] = await Promise.all([
      db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, run.id)),
      db.select().from(correctivePlanRunsTable).where(eq(correctivePlanRunsTable.planRunId, run.id)).orderBy(asc(correctivePlanRunsTable.createdAt)).limit(1),
    ]);
    const allocationRows = linkedCorrective
      ? await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, linkedCorrective[0].id))
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
      effectiveFrom: run.effectiveFrom ?? monthStart(month),
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
    const items = await db.select().from(plantPlanItemsTable).where(eq(plantPlanItemsTable.uploadId, upload.id));
    await savePlanVersionSnapshot({
      month,
      segment,
      kind: "import",
      sourceId: upload.id,
      effectiveFrom: upload.effectiveFrom ?? monthStart(month),
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
    const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, run.id));
    await savePlanVersionSnapshot({
      month,
      segment,
      kind: "corrective",
      sourceId: run.id,
      effectiveFrom: run.effectiveFrom ?? run.asOfDate ?? monthStart(month),
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