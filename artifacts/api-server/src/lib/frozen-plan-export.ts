import { and, desc, eq } from "drizzle-orm";
import {
  db,
  planRunInputsTable,
  planRunResultsTable,
  planRunsTable,
  planScheduleResultsTable,
} from "@workspace/db";
import type { CalcPlanItem, PlanSummaryResult } from "./calc";
import { summarizePlan } from "./calc";
import {
  exportFrozenPlanExcel,
  type FrozenPlanRow,
} from "./excel-export";
import { exportPlanPdf } from "./pdf-export";
import {
  applyPlumbingScheduleToFrozenRows,
  type PersistedPlumbingScheduleRow,
} from "./plumbing-schedule-export";

export type FrozenExportRun = typeof planRunsTable.$inferSelect;

export function frozenRows(
  results: typeof planRunResultsTable.$inferSelect[],
  inputs: typeof planRunInputsTable.$inferSelect[],
  planType: "temporary" | "production",
): FrozenPlanRow[] {
  // plan_run_inputs has no category column. Pair by insertion order because
  // both tables were written from the same planItems array and code/colour can
  // legitimately repeat across categories.
  const orderedResults = [...results].sort((a, b) => a.id - b.id);
  const orderedInputs = [...inputs].sort((a, b) => a.id - b.id);
  return orderedResults.map((result, index) => {
    const input = orderedInputs[index];
    const dummy = Math.max(input?.pendingLastMonth ?? 0, 0);
    const orders = Math.max(input?.pendingCurrent ?? 0, 0);
    const buffer = result.bufferReq == null ? 0 : Math.max(result.bufferReq - (input?.stock ?? 0), 0);
    return {
      itemCode: result.itemCode,
      colour: result.colour,
      category: result.category,
      avg3MoSale: input?.avg3MoSale ?? 0,
      stock: input?.stock ?? 0,
      pendingCurrent: input?.pendingCurrent ?? 0,
      pendingLastMonth: input?.pendingLastMonth ?? 0,
      bufferReq: result.bufferReq,
      minProduction: result.minProduction,
      productionPlan: result.productionPlan,
      temporaryPlan: result.temporaryPlan || (planType === "temporary" ? result.productionPlan : 0),
      cannotBeMade: result.cannotBeMade,
      dummy,
      orders,
      buffer,
      material: result.material,
      weightKg: result.weightKg,
      urgencyRank: result.urgencyRank,
      releaseWeek: result.releaseWeek,
      w1: result.w1,
      w2: result.w2,
      w3: result.w3,
      w4: result.w4,
    };
  });
}

export async function getLatestFinalizedRun(
  month: string,
  segment: string,
  planType: "temporary" | "production",
): Promise<FrozenExportRun | undefined> {
  const [run] = await db
    .select()
    .from(planRunsTable)
    .where(and(
      eq(planRunsTable.month, month),
      eq(planRunsTable.segment, segment),
      eq(planRunsTable.status, "finalized"),
      eq(planRunsTable.planType, planType),
    ))
    .orderBy(desc(planRunsTable.id))
    .limit(1);
  return run;
}

export async function loadFrozenRows(
  run: FrozenExportRun,
): Promise<FrozenPlanRow[]> {
  const [results, inputs] = await Promise.all([
    db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, run.id)),
    db.select().from(planRunInputsTable).where(eq(planRunInputsTable.runId, run.id)),
  ]);
  return frozenRows(results, inputs, run.planType as "temporary" | "production");
}

export async function loadLatestPlumbingSchedule(
  runId: number,
): Promise<PersistedPlumbingScheduleRow[]> {
  const stored = await db
    .select()
    .from(planScheduleResultsTable)
    .where(eq(planScheduleResultsTable.runId, runId))
    .orderBy(desc(planScheduleResultsTable.id));
  if (stored.length === 0) return [];

  const newestBatch = stored[0]!.batchId;
  const latestBatch = stored.filter((row) => row.batchId === newestBatch);
  return latestBatch.map((row) => ({
    kind: row.kind as "pipe" | "fitting",
    batchId: row.batchId,
    weekDays: row.weekDays,
    requestJson: row.requestJson,
    resultJson: row.resultJson,
  }));
}

export async function loadProductionExportRows(
  run: FrozenExportRun,
): Promise<{ rows: FrozenPlanRow[]; temporaryRows: FrozenPlanRow[] }> {
  let rows = await loadFrozenRows(run);
  if (run.segment === "Plumbing") {
    rows = applyPlumbingScheduleToFrozenRows(rows, await loadLatestPlumbingSchedule(run.id));
  }

  let temporaryRows: FrozenPlanRow[] = [];
  if (run.temporaryRunId != null) {
    const [temporaryRun] = await db
      .select()
      .from(planRunsTable)
      .where(and(
        eq(planRunsTable.id, run.temporaryRunId),
        eq(planRunsTable.planType, "temporary"),
      ));
    if (temporaryRun) temporaryRows = await loadFrozenRows(temporaryRun);
  }
  return { rows, temporaryRows };
}

function frozenRowsAsCalcItems(rows: FrozenPlanRow[]): CalcPlanItem[] {
  return rows.map((row) => ({
    itemCode: row.itemCode,
    colour: row.colour,
    category: row.category,
    avg3MoSale: row.avg3MoSale,
    stock: row.stock,
    stockNeedsReview: false,
    bufferReq: row.bufferReq,
    minProduction: row.minProduction,
    maxProduction: row.productionPlan,
    pendingOrderLastMonth: row.pendingLastMonth,
    pendingOrder: row.pendingCurrent,
    order: row.pendingCurrent,
    achievementPct: null,
    cover: row.avg3MoSale > 0 ? row.stock / row.avg3MoSale : "OS",
    week: row.releaseWeek as 1 | 2 | 3 | 4 | null,
    w1: row.w1,
    w2: row.w2,
    w3: row.w3,
    w4: row.w4,
  }));
}

export function frozenRowsSummary(rows: FrozenPlanRow[]): PlanSummaryResult {
  return summarizePlan(frozenRowsAsCalcItems(rows));
}

export async function exportFrozenProductionPdf(
  month: string,
  rows: FrozenPlanRow[],
): Promise<Buffer> {
  return exportPlanPdf(month, frozenRowsAsCalcItems(rows), frozenRowsSummary(rows));
}

export async function exportFrozenRunExcel(
  run: FrozenExportRun,
  planType: "temporary" | "production" = run.planType as "temporary" | "production",
): Promise<Buffer> {
  const { rows, temporaryRows } = planType === "production"
    ? await loadProductionExportRows(run)
    : { rows: await loadFrozenRows(run), temporaryRows: [] };
  return exportFrozenPlanExcel(run.month, planType, rows, temporaryRows);
}