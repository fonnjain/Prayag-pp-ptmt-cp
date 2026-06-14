import { sql, eq, and, desc } from "drizzle-orm";
import {
  db,
  planRuns,
  planLines,
  type PlanRun as DbPlanRun,
  type PlanLine as DbPlanLine,
  type InsertPlanLine,
} from "@workspace/db";
import {
  computeLines,
  type EngineConfig,
  type MultiplierMode,
} from "../lib/engine";

export type { MultiplierMode } from "../lib/engine";
import { gatherInputs } from "./plan-data";

// Thrown when the engine produces no lines (no data pulled for this
// division/month). Routes map this to a 409 with a user-facing message.
export class EmptyPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmptyPlanError";
  }
}

function n(v: unknown): number {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function nn(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function round(x: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((x + Number.EPSILON) * f) / f;
}

export interface BuildPlanArgs {
  division: string;
  planMonth: string;
  mode: MultiplierMode;
  multiplier?: number | null;
  multiplierMin?: number | null;
  multiplierMax?: number | null;
  includeCurrentPending?: boolean;
  floor0?: boolean;
  overrides?: Record<string, number>;
  createdBy?: string;
}

export interface ApiPlanRun {
  id: number;
  division: string;
  planMonth: string;
  version: number;
  workingDays: number | null;
  multiplierMode: string | null;
  multiplier: number | null;
  multiplierMin: number | null;
  multiplierMax: number | null;
  overrides: Record<string, number> | null;
  reportModel: string | null;
  reportTier: string | null;
  createdAt: string | null;
  createdBy: string | null;
  lineCount: number;
}

function mapRun(row: DbPlanRun, lineCount: number): ApiPlanRun {
  const params = (row.params as { overrides?: Record<string, number> } | null) ?? null;
  return {
    id: row.id,
    division: row.division,
    planMonth: String(row.planMonth).slice(0, 10),
    version: row.version,
    workingDays: row.workingDays ?? null,
    multiplierMode: row.multiplierMode ?? null,
    multiplier: nn(row.multiplierMin === row.multiplierMax ? row.multiplierMin : null),
    multiplierMin: nn(row.multiplierMin),
    multiplierMax: nn(row.multiplierMax),
    overrides: params?.overrides ?? null,
    reportModel: row.reportModel ?? null,
    reportTier: row.reportTier ?? null,
    createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
    createdBy: row.createdBy ?? null,
    lineCount,
  };
}

export async function buildPlan(args: BuildPlanArgs): Promise<ApiPlanRun> {
  const cfg: EngineConfig = {
    mode: args.mode,
    multiplier: args.multiplier ?? null,
    multiplierMin: args.multiplierMin ?? null,
    multiplierMax: args.multiplierMax ?? null,
    overrides: args.overrides ?? {},
    includeCurrentPending: args.includeCurrentPending ?? true,
    floor0: args.floor0 ?? true,
  };

  const { inputs, workingDays } = await gatherInputs(
    args.division,
    args.planMonth,
  );
  const lines = computeLines(inputs, cfg);

  // Never persist an empty plan run — that yields a blank export and hides the
  // real problem (no data was pulled for this division/month). Fail loudly so the
  // caller can tell the user to pull data first.
  if (lines.length === 0) {
    throw new EmptyPlanError(
      `No data to plan for ${args.division} ${args.planMonth.slice(0, 7)}. Pull the data for this division and month before building the plan.`,
    );
  }

  const planMonth = args.planMonth.slice(0, 10);
  const verRes = await db
    .select({ v: planRuns.version })
    .from(planRuns)
    .where(
      and(eq(planRuns.division, args.division), eq(planRuns.planMonth, planMonth)),
    )
    .orderBy(desc(planRuns.version))
    .limit(1);
  const version = (verRes[0]?.v ?? 0) + 1;

  // For single/overrides modes both min and max columns hold the single
  // multiplier so the run records exactly what was used.
  const storedMin =
    args.mode === "minmax" ? (args.multiplierMin ?? null) : (args.multiplier ?? null);
  const storedMax =
    args.mode === "minmax" ? (args.multiplierMax ?? null) : (args.multiplier ?? null);

  const [run] = await db
    .insert(planRuns)
    .values({
      division: args.division,
      planMonth,
      version,
      workingDays,
      multiplierMode: args.mode,
      multiplierMin: storedMin === null ? null : String(storedMin),
      multiplierMax: storedMax === null ? null : String(storedMax),
      params: {
        overrides: args.overrides ?? {},
        includeCurrentPending: cfg.includeCurrentPending,
        floor0: cfg.floor0,
      },
      createdBy: args.createdBy ?? null,
    })
    .returning();

  if (!run) throw new Error("Failed to create plan run");

  if (lines.length > 0) {
    const rows: InsertPlanLine[] = lines.map((l) => ({
      planRunId: run.id,
      itemCode: l.itemCode,
      colour: l.colour,
      model: l.model,
      category: l.category,
      report: l.report,
      last3Sale: String(l.last3Sale),
      runRate: String(l.runRate),
      lastMonthSale: String(l.lastMonthSale),
      avgSaleAnnual: String(l.avgSaleAnnual),
      sale2m: String(l.sale2m),
      sale10m: String(l.sale10m),
      pendingCurrent: String(l.pendingCurrent),
      pendingLast: String(l.pendingLast),
      openingStock: String(l.openingStock),
      multiplier: l.multiplier === null ? null : String(l.multiplier),
      bufferTarget: l.bufferTarget === null ? null : String(l.bufferTarget),
      minRequired: l.minRequired === null ? null : String(l.minRequired),
      maxRequired: l.maxRequired === null ? null : String(l.maxRequired),
      orderAsOn: String(l.orderAsOn),
      productionAsOn: String(l.produced),
      productionLeft: String(l.left),
      coveragePct: String(l.coverage),
      urgentFlag: l.urgent,
      valueAmount: String(l.valueAmount),
    }));
    // chunk inserts to stay within parameter limits
    const chunk = 500;
    for (let i = 0; i < rows.length; i += chunk) {
      await db.insert(planLines).values(rows.slice(i, i + chunk));
    }
  }

  return mapRun(run, lines.length);
}

async function lineCountFor(runId: number): Promise<number> {
  const res = await db.execute(
    sql`SELECT COUNT(*)::int AS c FROM plan_lines WHERE plan_run_id = ${runId}`,
  );
  return n((res.rows[0] as { c?: number } | undefined)?.c);
}

export async function getRun(id: number): Promise<ApiPlanRun | null> {
  const rows = await db.select().from(planRuns).where(eq(planRuns.id, id)).limit(1);
  if (!rows[0]) return null;
  return mapRun(rows[0], await lineCountFor(id));
}

export async function listRuns(
  division?: string,
  planMonth?: string,
): Promise<ApiPlanRun[]> {
  const conds = [];
  if (division) conds.push(eq(planRuns.division, division));
  if (planMonth) conds.push(eq(planRuns.planMonth, planMonth.slice(0, 10)));
  const rows = await db
    .select()
    .from(planRuns)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(planRuns.planMonth), desc(planRuns.version));
  const out: ApiPlanRun[] = [];
  for (const r of rows) out.push(mapRun(r, await lineCountFor(r.id)));
  return out;
}

export async function getLatestRun(
  division: string,
  planMonth: string,
): Promise<ApiPlanRun | null> {
  const rows = await db
    .select()
    .from(planRuns)
    .where(
      and(
        eq(planRuns.division, division),
        eq(planRuns.planMonth, planMonth.slice(0, 10)),
      ),
    )
    .orderBy(desc(planRuns.version))
    .limit(1);
  if (!rows[0]) return null;
  return mapRun(rows[0], await lineCountFor(rows[0].id));
}

export interface ApiPlanLine {
  id: number;
  itemCode: string | null;
  colour: string | null;
  model: string | null;
  category: string | null;
  report: string | null;
  runRate: number;
  last3Sale: number;
  lastMonthSale: number;
  avgSaleAnnual: number;
  openingStock: number;
  pendingLast: number;
  pendingCurrent: number;
  multiplier: number | null;
  bufferTarget: number | null;
  bufferTargetMin: number | null;
  bufferTargetMax: number | null;
  minRequired: number | null;
  maxRequired: number | null;
  productionRequired: number;
  orderAsOn: number;
  produced: number;
  left: number;
  coverage: number;
  urgent: boolean;
  valueAmount: number | null;
}

function mapLine(row: DbPlanLine, run: DbPlanRun): ApiPlanLine {
  const runRate = n(row.runRate);
  const isMinmax = run.multiplierMode === "minmax";
  const bufferTargetMin = isMinmax ? round(runRate * n(run.multiplierMin)) : null;
  const bufferTargetMax = isMinmax ? round(runRate * n(run.multiplierMax)) : null;
  return {
    id: row.id,
    itemCode: row.itemCode,
    colour: row.colour,
    model: row.model,
    category: row.category,
    report: row.report,
    runRate,
    last3Sale: n(row.last3Sale),
    lastMonthSale: n(row.lastMonthSale),
    avgSaleAnnual: n(row.avgSaleAnnual),
    openingStock: n(row.openingStock),
    pendingLast: n(row.pendingLast),
    pendingCurrent: n(row.pendingCurrent),
    multiplier: nn(row.multiplier),
    bufferTarget: nn(row.bufferTarget),
    bufferTargetMin,
    bufferTargetMax,
    minRequired: nn(row.minRequired),
    maxRequired: nn(row.maxRequired),
    productionRequired: n(row.maxRequired),
    orderAsOn: n(row.orderAsOn),
    produced: n(row.productionAsOn),
    left: n(row.productionLeft),
    coverage: n(row.coveragePct),
    urgent: Boolean(row.urgentFlag),
    valueAmount: nn(row.valueAmount),
  };
}

export async function getLines(runId: number): Promise<ApiPlanLine[]> {
  const runRows = await db
    .select()
    .from(planRuns)
    .where(eq(planRuns.id, runId))
    .limit(1);
  const run = runRows[0];
  if (!run) return [];
  const rows = await db
    .select()
    .from(planLines)
    .where(eq(planLines.planRunId, runId))
    .orderBy(desc(planLines.urgentFlag), desc(planLines.valueAmount));
  return rows.map((r) => mapLine(r, run));
}
