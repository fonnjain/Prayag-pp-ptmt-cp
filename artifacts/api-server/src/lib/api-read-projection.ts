import {
  db,
  planRunInputsTable,
  planRunResultsTable,
  planRunsTable,
  plantIngestionCacheTable,
  plantMonthSnapshotsTable,
  plantPlanItemsTable,
  plantPlanUploadsTable,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { resolvePlantMonthLifecycle, resolveWorkingDays, type WorkingDaysSource } from "./plant-lifecycle";
import { countWorkingDaysElapsed } from "./monitoring-calc";
import { normalizePlantSegment, type PlantSegment } from "./plant-segments";
import { normalizeCodeStrict } from "./sheets";

export const API_READ_FRESH_MS = 5 * 60 * 1000;
export const API_READ_STALE_MS = 30 * 60 * 1000;

export type ApiCacheState = "fresh" | "stale" | "frozen";

export class CacheUnavailableError extends Error {
  readonly code = "CACHE_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "CacheUnavailableError";
  }
}

type PlanVersionMeta = {
  kind: string;
  sourceId: number;
  sourceLabel: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  targetCount: number;
  selection: unknown;
  isCurrent: boolean;
};

type Actual = { date: string; itemCode: string; colour: string; qty: number };
type PlanItem = {
  itemCode: string;
  colour: string;
  category: string;
  stock: number;
  pendingOrder: number;
  avg3MoSale: number;
  pendingLastMonth: number;
  bufferReq: number;
  minProduction: number;
  productionPlan: number;
  maxProduction: number;
  releaseWeek: number | null;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  produced: number;
  weightKgPerPiece: number | null;
  machines: string[] | null;
  machineHrs: number | null;
};

export type ApiReadProjection = {
  month: string;
  segment: PlantSegment;
  metadata: {
    snapshotDate: string | null;
    lifecycle: "future" | "open" | "grace" | "closed";
    planVersions: PlanVersionMeta[];
    workingDays: number;
    workingDaysSource: WorkingDaysSource;
    elapsed: number;
    remaining: number;
    mappedProduction: number;
    unmappedProduction: number;
    cache: { state: ApiCacheState; ageMs: number; generatedAt: string };
    caveats: string[];
  };
  calendar: {
    workingDays: number;
    workingDaysSource: WorkingDaysSource;
    elapsed: number;
    remaining: number;
    workedSundays: string[];
    idleWeekdays: string[];
  };
  items: PlanItem[];
  summary: {
    targetMax: number;
    targetMin: number;
    mappedProduced: number;
    totalProduced: number;
    unmappedProduced: number;
    projectedAttainmentPct: number | null;
    projectedMinAttainmentPct: number | null;
    runRatePerDay: number | null;
    ragBand: "green" | "amber" | "red" | null;
    weeks: Array<{ week: 1 | 2 | 3 | 4; release: number; mapped: number; unmapped: number; actual: number }>;
  };
  categories: Array<{
    category: string;
    targetMin: number;
    targetMax: number;
    mappedProduced: number;
    unmappedProduced: number;
    actual: number;
    gap: number;
    attainmentPct: number | null;
    w1: { release: number; mapped: number; unmapped: number; actual: number };
    w2: { release: number; mapped: number; unmapped: number; actual: number };
    w3: { release: number; mapped: number; unmapped: number; actual: number };
    w4: { release: number; mapped: number; unmapped: number; actual: number };
  }>;
};

type CacheEntry = { projection: ApiReadProjection; generatedAt: number; sourceAt: number; frozen: boolean };
const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<ApiReadProjection>>();

const n = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};
const round = (value: number): number => Math.round(value * 100) / 100;
const itemKey = (code: string, colour: string) => `${normalizeCodeStrict(code)}|${String(colour ?? "").trim().toUpperCase()}`;
const weekIndex = (date: string): 0 | 1 | 2 | 3 => {
  const day = Number(date.slice(8, 10));
  return day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3;
};
const datesInMonth = (month: string): string[] => {
  const [year, monthNumber] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return Array.from({ length: last }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`);
};
const isSunday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0;

function versionMetadata(raw: unknown, snapshotDate: string | null, month: string): PlanVersionMeta[] {
  if (!Array.isArray(raw)) return [];
  const versions = raw.filter((v): v is Record<string, unknown> => Boolean(v) && typeof v === "object");
  return versions.map((version) => {
    const effectiveFrom = String(version.effectiveFrom ?? "");
    const effectiveTo = version.effectiveTo == null ? null : String(version.effectiveTo);
    const isCurrent = Boolean(effectiveFrom) && effectiveFrom <= (snapshotDate ?? `${month}-31`) &&
      (effectiveTo === null || effectiveTo >= (snapshotDate ?? `${month}-31`));
    return {
      kind: String(version.kind ?? ""),
      sourceId: n(version.sourceId),
      sourceLabel: typeof version.sourceLabel === "string" ? version.sourceLabel : null,
      effectiveFrom,
      effectiveTo,
      targetCount: n(version.targetCount),
      selection: version.selection ?? null,
      isCurrent,
    };
  });
}

function actualsFromSnapshot(value: unknown): Actual[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    const date = String(r.date ?? "");
    const itemCode = String(r.itemCode ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !itemCode) return [];
    return [{ date, itemCode, colour: String(r.colour ?? ""), qty: n(r.qty) }];
  });
}

function snapshotPayload(snapshot: typeof plantMonthSnapshotsTable.$inferSelect): { actualsJson: unknown; targetsJson: unknown; bundleJson: unknown; sourceInfoJson: unknown } {
  const payload = snapshot.payloadJson && typeof snapshot.payloadJson === "object" && !Array.isArray(snapshot.payloadJson)
    ? snapshot.payloadJson as Record<string, unknown>
    : {};
  return {
    actualsJson: payload.actualsJson ?? [],
    targetsJson: payload.targetsJson ?? [],
    bundleJson: payload.bundleJson ?? {},
    sourceInfoJson: payload.sourceInfoJson ?? snapshot.planEvidenceJson,
  };
}

async function readLocalProjection(month: string, segment: PlantSegment): Promise<{ projection: ApiReadProjection; sourceAt: number; frozen: boolean }> {
  const lifecycle = resolvePlantMonthLifecycle(month);
  const [snapshot] = await db.select().from(plantMonthSnapshotsTable).where(and(
    eq(plantMonthSnapshotsTable.month, month),
    eq(plantMonthSnapshotsTable.segment, segment),
    eq(plantMonthSnapshotsTable.planStatus, "monitoring"),
  )).limit(1);
  const [run] = await db.select().from(planRunsTable).where(and(
    eq(planRunsTable.month, month),
    eq(planRunsTable.segment, segment),
    eq(planRunsTable.status, "finalized"),
  )).orderBy(desc(planRunsTable.id)).limit(1);
  const [ingestion] = await db.select().from(plantIngestionCacheTable).where(and(
    eq(plantIngestionCacheTable.month, month),
    eq(plantIngestionCacheTable.segment, segment),
  )).limit(1);
  if (!snapshot && !run) throw new CacheUnavailableError(`No local plan snapshot is available for ${segment} ${month}.`);

  const savedPayload = snapshot ? snapshotPayload(snapshot) : null;
  const actuals: Actual[] = savedPayload
    ? actualsFromSnapshot(savedPayload.actualsJson)
    : (Array.isArray(ingestion?.rawActualsJson) ? actualsFromSnapshot(ingestion.rawActualsJson) : []);
  if (!snapshot && !ingestion) throw new CacheUnavailableError(`No local actuals cache is available for ${segment} ${month}.`);

  const [results, inputs, upload] = await Promise.all([
    run ? db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, run.id)) : Promise.resolve([]),
    run ? db.select().from(planRunInputsTable).where(eq(planRunInputsTable.runId, run.id)) : Promise.resolve([]),
    segment === "Plumbing"
      ? db.select().from(plantPlanUploadsTable).where(and(eq(plantPlanUploadsTable.month, month), eq(plantPlanUploadsTable.segment, segment))).orderBy(desc(plantPlanUploadsTable.uploadedAt)).limit(1)
      : Promise.resolve([]),
  ]);
  if (!snapshot && results.length === 0) throw new CacheUnavailableError(`No local plan items are available for ${segment} ${month}.`);
  const uploadItems = upload[0] ? await db.select().from(plantPlanItemsTable).where(eq(plantPlanItemsTable.uploadId, upload[0].id)) : [];
  const inputMap = new Map(inputs.map((row) => [itemKey(row.itemCode, row.colour), row]));
  const uploadMap = new Map(uploadItems.map((row) => [normalizeCodeStrict(row.itemCode), row]));
  const actualByKey = new Map<string, number>();
  const actualByCode = new Map<string, number>();
  for (const row of actuals) {
    actualByKey.set(itemKey(row.itemCode, row.colour), n(actualByKey.get(itemKey(row.itemCode, row.colour))) + row.qty);
    actualByCode.set(normalizeCodeStrict(row.itemCode), n(actualByCode.get(normalizeCodeStrict(row.itemCode))) + row.qty);
  }
  const resultRows = results as Array<typeof planRunResultsTable.$inferSelect>;
  const bundle = savedPayload?.bundleJson && typeof savedPayload.bundleJson === "object"
    ? savedPayload.bundleJson as Record<string, unknown>
    : null;
  const bundleContext = bundle?.context && typeof bundle.context === "object" ? bundle.context as Record<string, unknown> : {};
  const snapshotDate = String(bundleContext.snapshotDate ?? ingestion?.snapshotDate ?? (actuals.length ? actuals.map((row) => row.date).sort().at(-1) : "")) || null;
  const targetRows = resultRows.length > 0
    ? resultRows
    : Array.isArray(savedPayload?.targetsJson) ? savedPayload.targetsJson as Array<Record<string, unknown>> : [];
  const items: PlanItem[] = targetRows.map((row) => {
    const code = String(row.itemCode ?? "");
    const colour = String(row.colour ?? "");
    const input = inputMap.get(itemKey(code, colour));
    const uploadItem = uploadMap.get(normalizeCodeStrict(code));
    const requestedPcs = n(uploadItem?.requestedPcs);
    return {
      itemCode: code,
      colour,
      category: String(row.category ?? ""),
      stock: n(input?.stock),
      pendingOrder: n(input?.pendingCurrent),
      avg3MoSale: n(input?.avg3MoSale),
      pendingLastMonth: n(input?.pendingLastMonth),
      bufferReq: n(row.bufferReq),
      minProduction: n(row.minProduction),
      productionPlan: n(row.productionPlan),
      maxProduction: n(row.productionPlan),
      releaseWeek: row.releaseWeek == null ? null : n(row.releaseWeek),
      w1: n(row.w1), w2: n(row.w2), w3: n(row.w3), w4: n(row.w4),
      produced: n(actualByKey.get(itemKey(code, colour)) ?? actualByCode.get(normalizeCodeStrict(code))),
      weightKgPerPiece: uploadItem && requestedPcs > 0 ? n(uploadItem.requestedKg) / requestedPcs : null,
      machines: uploadItem?.machines ? uploadItem.machines.split(/[,/]+/).map((v) => v.trim()).filter(Boolean) : null,
      machineHrs: uploadItem ? n(uploadItem.machineHrs) : null,
    };
  });
  const plannedCodes = new Set(items.map((row) => normalizeCodeStrict(row.itemCode)));
  const mappedActuals = actuals.filter((row) => plannedCodes.has(normalizeCodeStrict(row.itemCode)));
  const mappedProduction = mappedActuals.reduce((sum, row) => sum + row.qty, 0);
  const totalProduction = actuals.reduce((sum, row) => sum + row.qty, 0);
  const unmappedProduction = totalProduction - mappedProduction;
  const positiveDates = [...new Set(actuals.filter((row) => row.qty > 0).map((row) => row.date))].sort();
  const workingResolution = bundleContext.workingDaysSource === "configured"
    ? resolveWorkingDays(month, n(bundleContext.workingDays), positiveDates, snapshotDate, lifecycle.state)
    : resolveWorkingDays(month, null, positiveDates, snapshotDate, lifecycle.state);
  const workingDays = n(bundleContext.workingDays) || workingResolution.workingDays;
  const configuredElapsed = bundleContext.elapsed == null ? null : n(bundleContext.elapsed);
  const elapsed = configuredElapsed ?? (lifecycle.state === "closed" || lifecycle.state === "grace"
    ? workingDays
    : countWorkingDaysElapsed(month, snapshotDate) + positiveDates.filter((date) => date <= (snapshotDate ?? "") && isSunday(date)).length);
  const remaining = Math.max(workingDays - elapsed, 0);
  const datesThroughSnapshot = datesInMonth(month).filter((date) => !snapshotDate || date <= snapshotDate);
  const positiveDateSet = new Set(positiveDates);
  const workedSundays = positiveDates.filter(isSunday);
  const idleWeekdays = datesThroughSnapshot.filter((date) => !isSunday(date) && !positiveDateSet.has(date));
  const weeks = ([0, 1, 2, 3] as const).map((index) => {
    const rows = actuals.filter((row) => weekIndex(row.date) === index);
    const mapped = rows.filter((row) => plannedCodes.has(normalizeCodeStrict(row.itemCode))).reduce((sum, row) => sum + row.qty, 0);
    const actual = rows.reduce((sum, row) => sum + row.qty, 0);
    const release = items.reduce((sum, row) => sum + [row.w1, row.w2, row.w3, row.w4][index], 0);
    return { week: (index + 1) as 1 | 2 | 3 | 4, release: round(release), mapped: round(mapped), unmapped: round(actual - mapped), actual: round(actual) };
  });
  const categories = [...new Set([...items.map((row) => row.category), ...actuals.map((row) => items.find((item) => normalizeCodeStrict(item.itemCode) === normalizeCodeStrict(row.itemCode))?.category).filter((v): v is string => Boolean(v))])].map((category) => {
    const catItems = items.filter((row) => row.category === category);
    const catActuals = actuals.filter((row) => catItems.some((item) => normalizeCodeStrict(item.itemCode) === normalizeCodeStrict(row.itemCode)));
    const catMapped = catActuals.reduce((sum, row) => sum + row.qty, 0);
    const catRows = ([0, 1, 2, 3] as const).map((index) => {
      const rows = catActuals.filter((row) => weekIndex(row.date) === index);
      const actual = rows.reduce((sum, row) => sum + row.qty, 0);
      const mapped = actual;
      const release = catItems.reduce((sum, row) => sum + [row.w1, row.w2, row.w3, row.w4][index], 0);
      return { release: round(release), mapped: round(mapped), unmapped: 0, actual: round(actual) };
    });
    const targetMax = catItems.reduce((sum, row) => sum + row.maxProduction, 0);
    const targetMin = catItems.reduce((sum, row) => sum + row.minProduction, 0);
    return {
      category, targetMin: round(targetMin), targetMax: round(targetMax),
      mappedProduced: round(catMapped), unmappedProduced: 0, actual: round(catMapped),
      gap: round(Math.max(targetMax - catMapped, 0)), attainmentPct: targetMax > 0 ? round((catMapped / targetMax) * 100) : null,
      w1: catRows[0], w2: catRows[1], w3: catRows[2], w4: catRows[3],
    };
  });
  const targetMax = items.reduce((sum, row) => sum + row.maxProduction, 0);
  const targetMin = items.reduce((sum, row) => sum + row.minProduction, 0);
  const runRatePerDay = elapsed > 0 ? round(mappedProduction / elapsed) : null;
  const projected = runRatePerDay === null ? null : round(runRatePerDay * workingDays);
  const projectedAttainmentPct = projected !== null && targetMax > 0 ? round((projected / targetMax) * 100) : null;
  const projectedMinAttainmentPct = projected !== null && targetMin > 0 ? round((projected / targetMin) * 100) : null;
  const sourceInfo = bundleContext.sourceInfo && typeof bundleContext.sourceInfo === "object" ? bundleContext.sourceInfo as Record<string, unknown> : savedPayload?.sourceInfoJson;
  const planVersions = versionMetadata((sourceInfo as Record<string, unknown> | null)?.planVersions ?? (sourceInfo as Record<string, unknown> | null)?.planVersionTimeline, snapshotDate, month);
  const sourceAt = Math.max(
    snapshot?.capturedAt?.getTime() ?? 0,
    ingestion?.cachedAt?.getTime() ?? 0,
    run?.asOfAt?.getTime() ?? 0,
  );
  const caveats = [
    segment === "Plumbing" ? "Plumbing actuals are piece-based; kg fields are only present where the local plan upload contains weight data." : "PTMT is piece-based in this API; machine-level kg is outside the plan-item projection.",
    unmappedProduction > 0 ? `${round(unmappedProduction)} pieces were produced under codes not present in the selected plan.` : null,
    lifecycle.state === "open" ? "Open-month values reflect the latest locally cached snapshot and may lag the source system." : null,
  ].filter((value): value is string => Boolean(value));
  const metadata = {
    snapshotDate, lifecycle: lifecycle.state, planVersions, workingDays, workingDaysSource: workingResolution.workingDaysSource,
    elapsed, remaining, mappedProduction: round(mappedProduction), unmappedProduction: round(unmappedProduction),
    cache: { state: lifecycle.state === "closed" ? "frozen" as const : "fresh" as const, ageMs: Math.max(0, Date.now() - sourceAt), generatedAt: new Date().toISOString() },
    caveats,
  };
  return {
    projection: {
      month, segment, metadata,
      calendar: { workingDays, workingDaysSource: workingResolution.workingDaysSource, elapsed, remaining, workedSundays, idleWeekdays },
      items,
      summary: {
        targetMax: round(targetMax), targetMin: round(targetMin), mappedProduced: round(mappedProduction), totalProduced: round(totalProduction),
        unmappedProduced: round(unmappedProduction), projectedAttainmentPct, projectedMinAttainmentPct, runRatePerDay,
        ragBand: projectedAttainmentPct === null ? null : projectedAttainmentPct >= 95 ? "green" : projectedAttainmentPct >= 85 ? "amber" : "red",
        weeks,
      },
      categories,
    },
    sourceAt,
    frozen: lifecycle.state === "closed" && Boolean(snapshot),
  };
}

export async function getApiReadProjection(month: string, rawSegment: unknown): Promise<ApiReadProjection> {
  const segment = normalizePlantSegment(rawSegment);
  if (!segment) throw new CacheUnavailableError("segment must be PTMT or Plumbing");
  const key = `${segment}:${month}`;
  const existing = cache.get(key);
  const age = existing ? Date.now() - existing.generatedAt : Infinity;
  if (existing && (existing.frozen || age < API_READ_FRESH_MS)) {
    existing.projection.metadata.cache = { ...existing.projection.metadata.cache, state: existing.frozen ? "frozen" : "fresh", ageMs: age };
    return existing.projection;
  }
  const pending = inFlight.get(key);
  if (pending) return pending;
  const stale = existing && age <= API_READ_STALE_MS ? existing : null;
  const promise = Promise.race([
    readLocalProjection(month, segment).then(({ projection, sourceAt, frozen }) => {
      cache.set(key, { projection, generatedAt: Date.now(), sourceAt, frozen });
      return projection;
    }),
    new Promise<ApiReadProjection>((_, reject) => setTimeout(() => reject(new CacheUnavailableError("Local projection exceeded the 2 second read budget.")), 2000)),
  ]).catch((error) => {
    if (stale) {
      stale.projection.metadata.cache = { ...stale.projection.metadata.cache, state: "stale", ageMs: age };
      return stale.projection;
    }
    throw error;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, promise);
  return promise;
}

export function invalidateApiReadProjection(month?: string): void {
  if (!month) {
    cache.clear();
    inFlight.clear();
    return;
  }
  for (const key of cache.keys()) if (key.endsWith(`:${month}`)) cache.delete(key);
  for (const key of inFlight.keys()) if (key.endsWith(`:${month}`)) inFlight.delete(key);
}

export function _resetApiReadProjectionCacheForTest(): void {
  cache.clear();
  inFlight.clear();
}