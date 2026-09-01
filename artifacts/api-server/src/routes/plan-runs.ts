import { Router, type IRouter } from "express";
import { db, bufferCategoriesTable, categoryCapacityTable, planRunsTable, planRunInputsTable, planRunResultsTable, pendingSnapshotsTable, planRunInputSnapshotsTable, pendingReadSnapshotsTable, correctivePlanRunsTable, plantMonthSnapshotsTable, planScheduleResultsTable, plumbingMachineCapacityTable } from "@workspace/db";
import { and, asc, eq, desc, ne, sql } from "drizzle-orm";
import { buildPlanItems, loadLatestUploadSnapshotByKind, type UploadRowsSnapshot, handlePlanError } from "./plan";
import { getMrpPlanningGate } from "../lib/mrp-control";
import {
  fetchPlumbingBomWeights,
  fetchLivePendingOrderTotals,
  normalizeCodeStrict,
  pendingOrderRecordsFromRows,
  pendingPlanDiagnosticsFromParsedRows,
  type PendingOrderRow,
} from "../lib/sheets";
import {
  livePendingFailureDiagnostics,
  pendingReadSnapshotValues,
} from "../lib/pending-read-snapshot";
import { summarizePlan } from "../lib/calc";
import {
  buildPlanRunInputSnapshot,
  pendingSnapshotStatus as getPendingSnapshotStatus,
  type PlanRunInputSnapshotPayload,
} from "../lib/plan-input-snapshot";
import {
  assertEffectiveDate,
  defaultEffectiveDate,
  monthStart,
  savePlanVersionSnapshot,
  setPlanVersionSnapshotEffectiveDate,
  validateNewVersionDate,
} from "../lib/plant-plan-timeline";
import { loadSession, requireAdmin } from "./session-middleware";
import { type FrozenPlanRow } from "../lib/excel-export";
import { exportFrozenRunExcel } from "../lib/frozen-plan-export";
import { exportTimestamp } from "../lib/export-filename";
import { loadStoredDailyActualsForSegment } from "../lib/plant-ingestion";
import { isSunday } from "../lib/working-days";
import { runPtmtPass2, type PtmtPass2Result, PtmtPass2InputError } from "../lib/ptmt-pass2-engine";
import { runPlumbingSchedule, PLUMBING_SCHEDULE_KINDS, type PlumbingScheduleDemand } from "../lib/plumbing-scheduler";

const router: IRouter = Router();

function pendingSourceKinds(segment: string): {
  current: string;
  lastMonth: string;
} {
  return segment === "Plumbing"
    ? { current: "pending_orders", lastMonth: "plumbing_fg_stock" }
    : { current: "pending_orders", lastMonth: "last_month_pending" };
}

type PendingSourceSnapshot = UploadRowsSnapshot & { sourceContentHash?: string };

async function loadPendingSources(segment: string, month: string): Promise<{
  current: PendingSourceSnapshot;
  lastMonth: PendingSourceSnapshot;
}> {
  const kinds = pendingSourceKinds(segment);
  const [current, lastMonth] = await Promise.all([
    loadLatestUploadSnapshotByKind(kinds.current, month),
    loadLatestUploadSnapshotByKind(kinds.lastMonth, month),
  ]);
  return {
    current,
    lastMonth,
  };
}

function firstValue(row: Record<string, unknown>, aliases: string[]): unknown {
  return aliases
    .map((alias) => row[alias])
    .find((value) => value !== undefined && value !== null && value !== "");
}

function asNumber(value: unknown): number {
  return typeof value === "number"
    ? value
    : Number(String(value ?? "0").replace(/,/g, "")) || 0;
}

function pendingSourceRowsForSegment(
  rows: Record<string, unknown>[],
  segment: string,
): Record<string, unknown>[] {
  const acceptedSegments = segment === "Plumbing"
    ? new Set(["PLUMBING", "P", "PL", "AGRI", "CPVC", "UPVC", "SWR"])
    : new Set(["PTMT", "PT"]);
  return rows.filter((row) => acceptedSegments.has(
    String(firstValue(row, ["Segment", "SEGMENT", "Group", "GROUP"]) ?? "").trim().toUpperCase(),
  ));
}

function pendingRowsForSnapshot(
  segment: string,
  sourceRole: "pending_current" | "pending_last_month",
  rows: Record<string, unknown>[],
): PendingOrderRow[] {
  if (sourceRole === "pending_current") {
    return pendingOrderRecordsFromRows(rows, segment);
  }

  const isPlumbing = segment === "Plumbing";
  const codeAliases = isPlumbing
    ? ["Item Code"]
    : ["Item Code", "Cat No", "Cat-No", "Old Item Code"];
  const colourAliases = isPlumbing ? [] : ["Colour", "Color"];
  const quantityAliases = isPlumbing
    ? ["Net Stock"]
    : ["Qty", "Qty.", "Balance_Qty", "Balance Qty"];

  return rows.flatMap((row): PendingOrderRow[] => {
    const rawCode = firstValue(row, codeAliases);
    if (rawCode === undefined || String(rawCode).trim() === "") return [];
    const rawQuantity = asNumber(firstValue(row, quantityAliases));
    const quantity = isPlumbing ? Math.max(-rawQuantity, 0) : rawQuantity;
    return [{
      segment,
      catNo: String(rawCode).trim(),
      colour: String(firstValue(row, colourAliases) ?? "").trim(),
      description: String(firstValue(row, ["Description", "Item Description", "Product Name", "Item Name"]) ?? "").trim(),
      qty: quantity,
    }];
  });
}

function sameUploadSnapshot(a: PendingSourceSnapshot, b: PendingSourceSnapshot): boolean {
  if (a.sourceContentHash !== undefined || b.sourceContentHash !== undefined) {
    return a.sourceContentHash === b.sourceContentHash;
  }
  return a.id === b.id
    && a.rowCount === b.rowCount
    && a.uploadedAt?.getTime() === b.uploadedAt?.getTime();
}

function makePendingSnapshotPayloads(
  segment: string,
  sources: { current: PendingSourceSnapshot; lastMonth: PendingSourceSnapshot },
): PlanRunInputSnapshotPayload[] {
  const kinds = pendingSourceKinds(segment);
  const currentAliases = {
    code: ["Old Item Code", "Item Code", "Item No."],
    colour: ["Colour", "Color", "COLOR", "COLUOR"],
    quantity: segment === "PTMT"
      ? ["Balance_Qty", "Balance Qty", "Bal.Qty", "Bal. Qty"]
      : ["Balance_Qty", "Balance Qty", "Bal.Qty", "Bal. Qty"],
  };
  const lastMonthAliases = segment === "PTMT"
    ? {
      code: ["Item Code", "Cat No", "Cat-No", "Old Item Code"],
      colour: ["Colour", "Color"],
      quantity: ["Qty", "Qty.", "Balance_Qty", "Balance Qty"],
    }
    : {
      code: ["Item Code"],
      colour: [],
      quantity: ["Net Stock"],
    };

  // DATA.xlsx is a global upload. Keep the run snapshot scoped to the same
  // segment rows that pendingOrderTotalsFromRows() gives to the plan builder;
  // otherwise pendingSnapshotsTable would mix PTMT and Plumbing demand.
  const currentRows = pendingSourceRowsForSegment(sources.current.rows, segment);
  const currentDiagnosticNotes = currentRows.length === 0
    ? [`uploaded pending order source returned no ${segment} rows; pending contributes 0 for this segment`]
    : [];
  return [
    buildPlanRunInputSnapshot({
      segment,
      sourceRole: "pending_current",
      sourceKind: kinds.current,
      source: sources.current,
      rows: currentRows,
      aliases: currentAliases,
      diagnosticNotes: currentDiagnosticNotes,
    }),
    buildPlanRunInputSnapshot({
      segment,
      sourceRole: "pending_last_month",
      sourceKind: kinds.lastMonth,
      source: sources.lastMonth,
      rows: sources.lastMonth.rows,
      aliases: lastMonthAliases,
      transformQuantity: segment === "Plumbing" ? (qty) => Math.max(-qty, 0) : undefined,
    }),
  ];
}

function makeSummary(run: typeof planRunsTable.$inferSelect, items: typeof planRunResultsTable.$inferSelect[]) {
  const grandMinTotal = items.reduce((s, r) => s + Math.max(r.minProduction, 0), 0);
  const grandDemandTotal = items.reduce((s, r) => s + Math.max(r.demandPlan ?? r.productionPlan, 0), 0);
  const grandFittedTotal = run.planType === "production"
    ? items.reduce((s, r) => s + Math.max(r.productionPlan, 0), 0)
    : null;
  return {
    id: run.id,
    month: run.month,
    segment: run.segment,
    planType: run.planType,
    temporaryRunId: run.temporaryRunId ?? null,
    asOfAt: run.asOfAt,
    status: run.status,
    effectiveFrom: run.effectiveFrom ?? null,
    note: run.note ?? null,
    planStatusReason: run.planStatusReason ?? null,
    pass2: run.pass2Json ?? null,
    itemCount: items.length,
    grandMinTotal: Math.round(grandMinTotal),
    // Compatibility alias: the old Max total is the issued demand total.
    grandMaxTotal: Math.round(grandDemandTotal),
    grandDemandTotal: Math.round(grandDemandTotal),
    grandFittedTotal: grandFittedTotal === null ? null : Math.round(grandFittedTotal),
    demandBasis: "demand",
    fittedBasis: grandFittedTotal === null ? null : "executable",
    createdAt: run.createdAt,
  };
}

function pairRunInputsWithResults(
  results: typeof planRunResultsTable.$inferSelect[],
  inputs: typeof planRunInputsTable.$inferSelect[],
): Array<{
  result: typeof planRunResultsTable.$inferSelect;
  input: typeof planRunInputsTable.$inferSelect | undefined;
}> {
  // plan_run_inputs intentionally has no category column. Inputs and results
  // are inserted from the same planItems array, so their per-run id order is
  // the only lossless way to pair duplicate code/colour rows.
  const orderedResults = [...results].sort((a, b) => a.id - b.id);
  const orderedInputs = [...inputs].sort((a, b) => a.id - b.id);
  return orderedResults.map((result, index) => ({
    result,
    input: orderedInputs[index],
  }));
}

function frozenRows(
  results: typeof planRunResultsTable.$inferSelect[],
  inputs: typeof planRunInputsTable.$inferSelect[],
  planType: "temporary" | "production",
): FrozenPlanRow[] {
  return pairRunInputsWithResults(results, inputs).map(({ result, input }) => {
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

export function parseStatusReasonInput(
  body: unknown,
): { ok: true; reason: string } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || !("planStatusReason" in body)) {
    return { ok: false, error: "planStatusReason is required" };
  }
  const value = (body as { planStatusReason?: unknown }).planStatusReason;
  if (typeof value !== "string") {
    return { ok: false, error: "planStatusReason must be a string" };
  }
  const reason = value.trim();
  if (!reason) {
    return { ok: false, error: "planStatusReason must not be empty" };
  }
  if (reason.length > 4_000) {
    return { ok: false, error: "planStatusReason must be at most 4000 characters" };
  }
  return { ok: true, reason };
}

/** POST /api/plan/runs — create a draft run, snapshot all inputs & computed results */
router.post("/plan/runs", async (req, res): Promise<void> => {
  const {
    month,
    note,
    segment: segmentRaw,
    effectiveFrom: effectiveFromRaw,
    planType: planTypeRaw,
    temporaryRunId: temporaryRunIdRaw,
  } = req.body ?? {};

  // Normalise segment casing the same way GET /plan does, then validate.
  // A casing mismatch previously produced a silent zero-item run that was
  // indistinguishable from a genuine empty result and could poison a corrective
  // baseline. Reject unrecognised values explicitly rather than silently defaulting.
  const RECOGNISED_SEGMENTS: Record<string, string> = { ptmt: "PTMT", plumbing: "Plumbing" };
  const rawStr = typeof segmentRaw === "string" && segmentRaw ? segmentRaw.trim() : "PTMT";
  const segment = RECOGNISED_SEGMENTS[rawStr.toLowerCase()] ?? null;
  if (!segment) {
    res.status(400).json({
      error: "UNRECOGNISED_SEGMENT",
      message: `"${rawStr}" is not a recognised segment. Accepted values: PTMT, Plumbing.`,
    });
    return;
  }

  if (!month || typeof month !== "string") {
    res.status(400).json({ error: "month is required (YYYY-MM)" });
    return;
  }

  const planType = planTypeRaw === "temporary" ? "temporary" : "production";
  const temporaryRunId = temporaryRunIdRaw == null ? null : Number(temporaryRunIdRaw);
  if (temporaryRunIdRaw != null && (temporaryRunId === null || !Number.isInteger(temporaryRunId) || temporaryRunId <= 0)) {
    res.status(400).json({ error: "temporaryRunId must be a positive integer" });
    return;
  }
  if (planType === "temporary" && temporaryRunId != null) {
    res.status(400).json({ error: "A Temporary Plan cannot have a temporaryRunId lineage" });
    return;
  }
  if (planType === "production" && segment === "PTMT" && temporaryRunId == null) {
    res.status(400).json({
      error: "TEMPORARY_PLAN_REQUIRED",
      message: "PTMT Production Plans must be fitted from a finalized Temporary Plan.",
    });
    return;
  }
  if (planType === "production" && segment === "PTMT") {
    const mrpGate = await getMrpPlanningGate();
    if (mrpGate.held) {
      res.status(422).json({
        error: "PTMT_MRP_APPROVAL_REQUIRED",
        message: `PTMT Production planning is held by authoritative MRP controls (source ${mrpGate.sourceId ?? "latest"}): ${mrpGate.reason}`,
        month,
        segment,
      });
      return;
    }
  }
  if (planType === "production" && temporaryRunId != null) {
    const [temporaryRun] = await db.select({
      id: planRunsTable.id,
      month: planRunsTable.month,
      segment: planRunsTable.segment,
      planType: planRunsTable.planType,
      status: planRunsTable.status,
    }).from(planRunsTable).where(eq(planRunsTable.id, temporaryRunId));
    if (!temporaryRun || temporaryRun.planType !== "temporary") {
      res.status(400).json({ error: `Temporary Plan #${temporaryRunId} was not found` });
      return;
    }
    if (temporaryRun.month !== month || temporaryRun.segment !== segment) {
      res.status(400).json({ error: "The Temporary Plan lineage must use the same month and segment" });
      return;
    }
    if (temporaryRun.status !== "finalized") {
      res.status(422).json({
        error: "TEMPORARY_PLAN_NOT_FINALIZED",
        message: `Temporary Plan #${temporaryRunId} must be finalized before a Production Plan can be fitted.`,
        temporaryRunId,
      });
      return;
    }
  }

  // Read current buffer factors for the snapshot (scoped to segment)
  const bufferRows = await db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, segment));
  const factorsJson: Record<string, number> = {};
  for (const b of bufferRows) factorsJson[b.name] = b.multiplier;

  // A PTMT Production Plan is fitted from the finalized Temporary Plan. It
  // deliberately does not rebuild the live plan inputs, so a later upload
  // cannot silently change the demand being fitted.
  let planItems: Awaited<ReturnType<typeof buildPlanItems>>;
  let pendingSnapshotPayloads: PlanRunInputSnapshotPayload[];
  let pass2Summary: PtmtPass2Result | null = null;
  let livePendingRead: Awaited<ReturnType<typeof fetchLivePendingOrderTotals>> | null = null;
  let livePendingReadError: unknown = null;
  try {
    // Keep this audit read independent from the source used by planning. The
    // plan still consumes its configured upload/live source; this captures the
    // contemporaneous live report without changing that decision.
    livePendingRead = await fetchLivePendingOrderTotals(segment);
  } catch (error) {
    livePendingReadError = error;
  }

  if (planType === "production" && segment === "PTMT" && temporaryRunId != null) {
    try {
      const [temporaryResults, temporaryInputs, temporarySnapshots] = await Promise.all([
        db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, temporaryRunId)).orderBy(asc(planRunResultsTable.id)),
        db.select().from(planRunInputsTable).where(eq(planRunInputsTable.runId, temporaryRunId)).orderBy(asc(planRunInputsTable.id)),
        db.select().from(planRunInputSnapshotsTable).where(eq(planRunInputSnapshotsTable.runId, temporaryRunId)),
      ]);
      if (temporaryResults.length === 0) {
        throw new PtmtPass2InputError(`Temporary Plan #${temporaryRunId} has no item results to fit.`);
      }

      const capacityRows = await db.select().from(categoryCapacityTable).where(eq(categoryCapacityTable.segment, "PTMT"));
      const storedActuals = await loadStoredDailyActualsForSegment(month, "PTMT");
      const workedSundayDates = [...new Set(
        storedActuals.actuals.filter((actual) => actual.qty > 0 && isSunday(actual.date)).map((actual) => actual.date),
      )];
      pass2Summary = runPtmtPass2(
        month,
        pairRunInputsWithResults(temporaryResults, temporaryInputs).map(({ result, input }) => {
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
            temporaryPlan: Math.max(
              Number((result as typeof result & { temporaryPlan?: number }).temporaryPlan || result.productionPlan),
              0,
            ),
          };
        }),
        capacityRows,
        workedSundayDates,
      );

      const temporaryPairs = pairRunInputsWithResults(temporaryResults, temporaryInputs);
      planItems = temporaryPairs.map(({ result, input }, index) => {
        const fitted = pass2Summary!.items[index];
        if (!fitted || fitted.itemCode !== result.itemCode || fitted.colour !== result.colour || fitted.category !== result.category) {
          throw new PtmtPass2InputError(`Temporary Plan item ${result.itemCode} could not be fitted at ordinal ${index}.`);
        }
        return {
          itemCode: result.itemCode,
          colour: result.colour,
          category: result.category,
          avg3MoSale: input?.avg3MoSale ?? 0,
          stock: input?.stock ?? 0,
          pendingOrder: input?.pendingCurrent ?? 0,
          pendingOrderLastMonth: input?.pendingLastMonth ?? 0,
          bufferReq: result.bufferReq,
          minProduction: result.minProduction,
          maxProduction: fitted.productionPlan,
          week: fitted.releaseWeek,
          w1: fitted.w1,
          w2: fitted.w2,
          w3: fitted.w3,
          w4: fitted.w4,
        };
      }) as Awaited<ReturnType<typeof buildPlanItems>>;

      // Keep the Temporary Plan's original upload provenance attached to the
      // Production Plan; the production run is still reproducible if uploads
      // are later replaced or deleted.
      pendingSnapshotPayloads = temporarySnapshots.map((snapshot) => ({
        segment: snapshot.segment,
        sourceRole: snapshot.sourceRole as "pending_current" | "pending_last_month",
        sourceKind: snapshot.sourceKind,
        sourceUploadId: snapshot.sourceUploadId,
        sourceFilename: snapshot.sourceFilename,
        sourceUploadedAt: snapshot.sourceUploadedAt,
        rawRows: snapshot.rawRowsJson,
        parsedRows: snapshot.parsedRowsJson,
        diagnostics: snapshot.diagnosticsJson as unknown as PlanRunInputSnapshotPayload["diagnostics"],
      }));
      if (pendingSnapshotPayloads.length === 0) {
        // Runs created before input-snapshot capture are still valid frozen
        // baselines. Preserve their frozen input rows with an explicit
        // "legacy source unavailable" diagnostic instead of reading live data.
        const parsedRows = temporaryInputs.map((input) => ({
          itemCode: input.itemCode,
          colour: input.colour,
          qty: input.pendingCurrent,
        }));
        const legacyDiagnostics = {
          source: "legacy Temporary Plan inputs",
          uploadId: null,
          filename: null,
          rowCount: temporaryInputs.length,
          codeRows: temporaryInputs.length,
          quantityRows: temporaryInputs.length,
          recognizedRows: temporaryInputs.length,
          skippedRows: 0,
          resolvedFields: { code: null, colour: null, quantity: null },
          acceptedAliases: { code: [], colour: [], quantity: [] },
          presentHeaders: [],
          missingRequiredFields: [],
          reasons: ["Original Temporary Plan source snapshot was not captured."],
        };
        pendingSnapshotPayloads = (["pending_current", "pending_last_month"] as const).map((sourceRole) => ({
          segment,
          sourceRole,
          sourceKind: "legacy-plan-run-inputs",
          sourceUploadId: null,
          sourceFilename: null,
          sourceUploadedAt: null,
          rawRows: [],
          parsedRows,
          diagnostics: legacyDiagnostics,
        }));
      }
    } catch (err) {
      if (err instanceof PtmtPass2InputError) {
        res.status(422).json({ error: "PTMT_PASS2_INPUT", message: err.message, month, segment });
      } else {
        handlePlanError(res, err);
      }
      return;
    }
  } else {
    // Legacy live-input path for Temporary Plans and Plumbing Production Plans.
    // The plan builder reads these same uploads internally; checking source
    // identity around the build prevents a replacement upload from being
    // paired with the wrong frozen plan run.
    let pendingSourcesBefore: Awaited<ReturnType<typeof loadPendingSources>>;
    try {
      pendingSourcesBefore = await loadPendingSources(segment, month);
      planItems = await buildPlanItems(month, segment, {
        allowUnapprovedMrp: planType === "temporary" && segment === "PTMT",
      });
      const pendingSourcesAfter = await loadPendingSources(segment, month);
      if (
        !sameUploadSnapshot(pendingSourcesBefore.current, pendingSourcesAfter.current)
        || !sameUploadSnapshot(pendingSourcesBefore.lastMonth, pendingSourcesAfter.lastMonth)
      ) {
        res.status(409).json({
          error: "PENDING_SOURCE_CHANGED",
          message: "A pending-order source changed while the plan was being built. Retry to create a run with one consistent input snapshot.",
          segment,
          month,
        });
        return;
      }
      pendingSnapshotPayloads = makePendingSnapshotPayloads(segment, pendingSourcesBefore).map((snapshot) => ({
        ...snapshot,
        diagnostics: {
          ...snapshot.diagnostics,
          pendingPlan: pendingPlanDiagnosticsFromParsedRows(
            pendingRowsForSnapshot(segment, snapshot.sourceRole, snapshot.rawRows),
            planItems,
            { sourceRole: snapshot.sourceRole },
          ),
        },
      }));
    } catch (err) {
      handlePlanError(res, err); // 422 naming the missing/broken upload
      return;
    }
  }

  // Guard against silent zero-item runs. A zero result is indistinguishable
  // from a legitimate empty result and could be cited as a corrective baseline,
  // poisoning everything downstream. Fail loudly so the caller knows immediately.
  if (planItems.length === 0) {
    res.status(422).json({
      error: "EMPTY_PLAN",
      message: `No plan items were produced for segment="${segment}", month="${month}". ` +
        `Check that all required uploads are present and non-empty, and that the workbook ` +
        `for this segment/month is accessible.`,
      segment,
      month,
    });
    return;
  }

  let effectiveFrom: string;
  try {
    effectiveFrom = effectiveFromRaw === undefined
      ? defaultEffectiveDate(month)
      : assertEffectiveDate(month, effectiveFromRaw);
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
    return;
  }

  // Insert inputs (one row per item)
  const inputValues = planItems.map((item) => ({
    runId: 0,
    itemCode: item.itemCode,
    colour: item.colour,
    avg3MoSale: item.avg3MoSale,
    stock: item.stock,
    pendingCurrent: item.pendingOrder,
    pendingLastMonth: item.pendingOrderLastMonth,
  }));

  // Insert results (one row per item)
  const resultValues = planItems.map((item, index) => {
    const fitted = planType === "production" ? pass2Summary?.items[index] : undefined;
    const demandPlan = planType === "temporary"
      ? item.maxProduction
      : fitted?.temporaryPlan ?? item.maxProduction;
    return {
    runId: 0,
    itemCode: item.itemCode,
    colour: item.colour,
    category: item.category,
    // Omit nullable buffer requirements so Postgres stores NULL for unresolved
    // classifications rather than forcing a fake zero buffer.
    bufferReq: item.bufferReq ?? undefined,
    minProduction: item.minProduction,
    // A production run stores executable output in productionPlan, while a
    // temporary run remains demand-true. demandPlan makes both meanings
    // explicit without breaking older consumers.
    demandPlan,
    productionPlan: planType === "production" && segment === "Plumbing"
      ? 0
      : item.maxProduction,
    temporaryPlan: planType === "temporary"
      ? item.maxProduction
      : fitted?.temporaryPlan ?? item.maxProduction,
    cannotBeMade: planType === "production"
      ? fitted?.cannotBeMade ?? 0
      : 0,
    feasibilityStatus: planType === "temporary"
      ? "not-scheduled"
      : segment === "Plumbing"
        ? "not-scheduled"
        : item.maxProduction > 0 ? "fitted" : "not-scheduled",
    material: segment === "Plumbing" ? item.category.split(" ")[0] ?? null : null,
    weightKg: (item as { weightKg?: number }).weightKg ?? null,
    urgencyRank: item.pendingOrderLastMonth > 0 ? 1 : item.pendingOrder > 0 ? 2 : 3,
    // Temporary Plans are demand-true snapshots, not a floor release plan.
    releaseWeek: planType === "temporary" ? null : item.week,
    w1: planType === "temporary" ? 0 : item.w1,
    w2: planType === "temporary" ? 0 : item.w2,
    w3: planType === "temporary" ? 0 : item.w3,
    w4: planType === "temporary" ? 0 : item.w4,
    };
  });

  const currentSnapshot = pendingSnapshotPayloads.find((snapshot) => snapshot.sourceRole === "pending_current");
  const snapshotValues = (currentSnapshot?.parsedRows ?? []).map((row) => ({
    runId: 0,
    catNo: row.itemCode,
    colour: row.colour,
    qty: row.qty,
  }));

  // Batch inserts (500 rows at a time to stay within PG limits)
  const BATCH = 500;
  // Create the run and all of its frozen input/result rows atomically. A run
  // must never exist claiming provenance while its input snapshot is partial.
  const run = await db.transaction(async (tx) => {
    const [createdRun] = await tx
      .insert(planRunsTable)
      .values({
        month,
        segment,
        planType,
        temporaryRunId,
        effectiveFrom,
        status: "draft",
        weeklyReleaseVersion: planType === "temporary" ? 0 : 1,
        factorsJson,
        note: note ?? null,
        pass2Json: pass2Summary ? pass2Summary as unknown as Record<string, unknown> : null,
      })
      .returning();
    const runId = createdRun.id;

    for (let i = 0; i < inputValues.length; i += BATCH) {
      await tx.insert(planRunInputsTable).values(
        inputValues.slice(i, i + BATCH).map((row) => ({ ...row, runId })),
      );
    }
    for (let i = 0; i < resultValues.length; i += BATCH) {
      await tx.insert(planRunResultsTable).values(
        resultValues.slice(i, i + BATCH).map((row) => ({ ...row, runId })),
      );
    }
    if (snapshotValues.length > 0) {
      for (let i = 0; i < snapshotValues.length; i += BATCH) {
        await tx.insert(pendingSnapshotsTable).values(
          snapshotValues.slice(i, i + BATCH).map((row) => ({ ...row, runId })),
        );
      }
    }
    for (const snapshot of pendingSnapshotPayloads) {
      await tx.insert(planRunInputSnapshotsTable).values({
        runId,
        segment: snapshot.segment,
        sourceRole: snapshot.sourceRole,
        sourceKind: snapshot.sourceKind,
        sourceUploadId: snapshot.sourceUploadId,
        sourceFilename: snapshot.sourceFilename,
        sourceUploadedAt: snapshot.sourceUploadedAt,
        rawRowsJson: snapshot.rawRows,
        parsedRowsJson: snapshot.parsedRows,
        diagnosticsJson: { ...snapshot.diagnostics } as Record<string, unknown>,
      });
    }
    const livePendingDiagnostics = livePendingRead
      ? {
        ...(livePendingRead.diagnostics ?? {}),
        pendingPlan: pendingPlanDiagnosticsFromParsedRows(
          livePendingRead.pendingRows ?? [],
          planItems,
          { sourceRole: "pending_current_live" },
        ),
      }
      : livePendingFailureDiagnostics(segment, livePendingReadError);
    await tx.insert(pendingReadSnapshotsTable).values({
      ...pendingReadSnapshotValues({
        runId,
        captureContext: "plan_run",
        segment,
        totals: livePendingRead ?? undefined,
        diagnostics: livePendingDiagnostics,
        status: livePendingRead ? "captured" : "failed",
        errorText: livePendingReadError instanceof Error
          ? livePendingReadError.message
          : livePendingReadError == null ? null : String(livePendingReadError),
      }),
      runId,
    });
    return createdRun;
  });

  const summary = makeSummary(run, resultValues as any);
  res.status(201).json(summary);
});

/** GET /api/plan/runs?month=YYYY-MM&segment=PTMT — list all runs for a month, newest first */
router.get("/plan/runs", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  // Normalise casing so "plumbing" / "PLUMBING" / "Plumbing" and "ptmt" / "PTMT"
  // all resolve to the stored value. An exact eq() with the raw string returns []
  // for any casing variant, which the caller then silently misreads as "no runs".
  const RECOGNISED_SEGMENTS_GET: Record<string, string> = { ptmt: "PTMT", plumbing: "Plumbing" };
  const rawSegGet = String(req.query.segment ?? "PTMT");
  const segment = RECOGNISED_SEGMENTS_GET[rawSegGet.toLowerCase()] ?? rawSegGet;

  const runs = await db
    .select()
    .from(planRunsTable)
    .where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, segment)))
    .orderBy(desc(planRunsTable.id)); // id DESC matches the auto-select order in corrective replan

  const summaries = await Promise.all(
    runs.map(async (run) => {
      const results = await db
        .select({
          minProduction: planRunResultsTable.minProduction,
          demandPlan: planRunResultsTable.demandPlan,
          productionPlan: planRunResultsTable.productionPlan,
        })
        .from(planRunResultsTable)
        .where(eq(planRunResultsTable.runId, run.id));
      return makeSummary(run, results as any);
    }),
  );

  res.json(summaries);
});

/** GET /api/plan/runs/compare?run1=id&run2=id — per-item diff between two frozen runs */
router.get("/plan/runs/compare", async (req, res): Promise<void> => {
  const run1Id = Number(req.query.run1);
  const run2Id = Number(req.query.run2);
  if (!run1Id || !run2Id) {
    res.status(400).json({ error: "run1 and run2 query params are required" });
    return;
  }

  const [results1, results2, inputs1, inputs2] = await Promise.all([
    db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, run1Id)),
    db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, run2Id)),
    db.select().from(planRunInputsTable).where(eq(planRunInputsTable.runId, run1Id)),
    db.select().from(planRunInputsTable).where(eq(planRunInputsTable.runId, run2Id)),
  ]);

  const byKey1 = new Map(results1.map((r) => [`${r.itemCode}::${r.colour}::${r.category}`, r]));
  const byKey2 = new Map(results2.map((r) => [`${r.itemCode}::${r.colour}::${r.category}`, r]));
  const inp1 = new Map(inputs1.map((r) => [`${r.itemCode}::${r.colour}`, r]));
  const inp2 = new Map(inputs2.map((r) => [`${r.itemCode}::${r.colour}`, r]));

  const allKeys = new Set([...byKey1.keys(), ...byKey2.keys()]);
  let grandMinDelta = 0;
  let grandMaxDelta = 0;

  const items = [...allKeys].map((key) => {
    const r1 = byKey1.get(key);
    const r2 = byKey2.get(key);
    const itemCode = (r1 ?? r2)!.itemCode;
    const colour = (r1 ?? r2)!.colour;
    const category = (r1 ?? r2)!.category;
    const inpKey = `${itemCode}::${colour}`;

    const minDelta = (r2?.minProduction ?? 0) - (r1?.minProduction ?? 0);
    const maxDelta = (r2?.productionPlan ?? 0) - (r1?.productionPlan ?? 0);
    const pendingDelta = (inp2.get(inpKey)?.pendingCurrent ?? 0) - (inp1.get(inpKey)?.pendingCurrent ?? 0);
    const stockDelta = (inp2.get(inpKey)?.stock ?? 0) - (inp1.get(inpKey)?.stock ?? 0);

    grandMinDelta += minDelta;
    grandMaxDelta += maxDelta;

    return { itemCode, colour, category, minProductionDelta: minDelta, productionPlanDelta: maxDelta, pendingCurrentDelta: pendingDelta, stockDelta };
  });

  res.json({
    run1Id,
    run2Id,
    grandMinDelta: Math.round(grandMinDelta),
    grandMaxDelta: Math.round(grandMaxDelta),
    items,
  });
});

/** GET /api/plan/runs/:id — frozen plan run with all per-item results */
router.get("/plan/runs/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [run] = await db.select().from(planRunsTable).where(eq(planRunsTable.id, id));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const [results, inputs, pendingInputSnapshots, pendingReadSnapshots] = await Promise.all([
    db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, id)),
    db.select().from(planRunInputsTable).where(eq(planRunInputsTable.runId, id)),
    db.select().from(planRunInputSnapshotsTable).where(eq(planRunInputSnapshotsTable.runId, id)),
    db.select().from(pendingReadSnapshotsTable).where(eq(pendingReadSnapshotsTable.runId, id)),
  ]);

  const inputByKey = new Map(inputs.map((inp) => [`${inp.itemCode}::${inp.colour}`, inp]));
  const pendingSnapshotStatus = getPendingSnapshotStatus(
    pendingInputSnapshots.map((snapshot) => snapshot.sourceRole),
  );

  const items = results.map((r) => {
    const inp = inputByKey.get(`${r.itemCode}::${r.colour}`);
    const dummy = Math.max(inp?.pendingLastMonth ?? 0, 0);
    const orders = Math.max(inp?.pendingCurrent ?? 0, 0);
    const buffer = r.bufferReq == null ? 0 : Math.max(r.bufferReq - (inp?.stock ?? 0), 0);
    return {
      itemCode: r.itemCode,
      colour: r.colour,
      category: r.category,
      avg3MoSale: inp?.avg3MoSale ?? 0,
      stock: inp?.stock ?? 0,
      pendingCurrent: inp?.pendingCurrent ?? 0,
      pendingLastMonth: inp?.pendingLastMonth ?? 0,
      bufferReq: r.bufferReq,
      minProduction: r.minProduction,
      demandPlan: r.demandPlan ?? r.productionPlan,
      productionPlan: r.productionPlan,
      temporaryPlan: r.temporaryPlan || (run.planType === "temporary" ? r.productionPlan : 0),
      cannotBeMade: r.cannotBeMade,
      feasibilityStatus: r.feasibilityStatus,
      dummy,
      orders,
      buffer,
      material: r.material,
      weightKg: r.weightKg,
      urgencyRank: r.urgencyRank,
      releaseWeek: r.releaseWeek,
      w1: r.w1,
      w2: r.w2,
      w3: r.w3,
      w4: r.w4,
    };
  });

  res.json({
    run: {
      ...makeSummary(run, results),
      pendingSnapshotStatus,
      pendingAuditability: pendingSnapshotStatus === "captured"
        ? "source-auditable"
        : "reproducible-but-not-source-auditable",
    },
    items,
    pendingInputSnapshots: pendingInputSnapshots.map((snapshot) => ({
      id: snapshot.id,
      segment: snapshot.segment,
      sourceRole: snapshot.sourceRole,
      sourceKind: snapshot.sourceKind,
      sourceUploadId: snapshot.sourceUploadId,
      sourceFilename: snapshot.sourceFilename,
      sourceUploadedAt: snapshot.sourceUploadedAt,
      capturedAt: snapshot.capturedAt,
      rawRows: snapshot.rawRowsJson,
      parsedRows: snapshot.parsedRowsJson,
      diagnostics: snapshot.diagnosticsJson,
    })),
    pendingReadSnapshots: pendingReadSnapshots.map((snapshot) => ({
      id: snapshot.id,
      captureContext: snapshot.captureContext,
      segment: snapshot.segment,
      sourceRole: snapshot.sourceRole,
      sourceKind: snapshot.sourceKind,
      sourceName: snapshot.sourceName,
      sourceSpreadsheetId: snapshot.sourceSpreadsheetId,
      sourceTabName: snapshot.sourceTabName,
      capturedAt: snapshot.capturedAt,
      status: snapshot.status,
      rawRows: snapshot.rawRowsJson,
      parsedRows: snapshot.parsedRowsJson,
      diagnostics: snapshot.diagnosticsJson,
      error: snapshot.errorText,
    })),
  });
});

/** GET /api/plan/pending-read-snapshots/:id — standalone validation evidence */
router.get("/plan/pending-read-snapshots/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [snapshot] = await db
    .select()
    .from(pendingReadSnapshotsTable)
    .where(eq(pendingReadSnapshotsTable.id, id));
  if (!snapshot) {
    res.status(404).json({ error: "Pending read snapshot not found" });
    return;
  }

  res.json({
    id: snapshot.id,
    runId: snapshot.runId,
    captureContext: snapshot.captureContext,
    segment: snapshot.segment,
    sourceRole: snapshot.sourceRole,
    sourceKind: snapshot.sourceKind,
    sourceName: snapshot.sourceName,
    sourceSpreadsheetId: snapshot.sourceSpreadsheetId,
    sourceTabName: snapshot.sourceTabName,
    capturedAt: snapshot.capturedAt,
    status: snapshot.status,
    rawRows: snapshot.rawRowsJson,
    parsedRows: snapshot.parsedRowsJson,
    diagnostics: snapshot.diagnosticsJson,
    error: snapshot.errorText,
  });
});

/** GET /api/plan/runs/:id/schedule-request — demand lines for the external fitter */
router.get("/plan/runs/:id/schedule-request", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [run] = await db.select().from(planRunsTable).where(eq(planRunsTable.id, id));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const results = await db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, id));
  res.json({
    contract: {
      name: "external-capacity-schedule-request",
      version: 1,
      segment: run.segment,
      month: run.month,
      period: "month",
      sourceRunId: run.id,
      sourcePlanType: run.planType,
      lineageTemporaryRunId: run.temporaryRunId ?? null,
      fields: ["itemCode", "colour", "quantity", "material", "weightKg", "category", "urgencyRank"],
    },
    items: results
      .filter((item) => item.productionPlan > 0)
      .map((item) => ({
        itemCode: item.itemCode,
        colour: item.colour,
        quantity: Math.round(item.productionPlan),
        material: item.material ?? item.category.split(" ")[0] ?? null,
        weightKg: item.weightKg,
        category: item.category,
        urgencyRank: item.urgencyRank ?? 3,
      })),
  });
});

/**
 * POST /api/plan/runs/:id/schedule — run the Plumbing demand through the
 * external machine scheduler. The two upstream results are persisted as
 * separate rows under one batch id and merged only in the response.
 */
router.post("/plan/runs/:id/schedule", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Run id must be a positive integer" });
    return;
  }
  const [run] = await db.select().from(planRunsTable).where(eq(planRunsTable.id, id));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (run.segment !== "Plumbing") {
    res.status(422).json({ error: "EXTERNAL_PLUMBING_SCHEDULER_ONLY", message: "The machine scheduler adapter accepts Plumbing runs only." });
    return;
  }
  if (run.status !== "finalized") {
    res.status(422).json({ error: "RUN_NOT_FINALIZED", message: "Finalize the Plumbing run before scheduling it." });
    return;
  }

  try {
    const [runResults, storedActuals, bomWeights, machineRows] = await Promise.all([
      db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, id)).orderBy(asc(planRunResultsTable.id)),
      loadStoredDailyActualsForSegment(run.month, "Plumbing"),
      fetchPlumbingBomWeights(),
      db.select().from(plumbingMachineCapacityTable).where(eq(plumbingMachineCapacityTable.segment, "Plumbing")),
    ]);
    const workedSundayDates: string[] = [...new Set(
      storedActuals.actuals
        .filter((actual: { qty: number; date: string }) => actual.qty > 0 && isSunday(actual.date))
        .map((actual: { qty: number; date: string }) => actual.date),
    )];
    const demandByKind: Record<"pipe" | "fitting", PlumbingScheduleDemand[]> = { pipe: [], fitting: [] };
    const weightByCode = new Map<string, number>();
    const normalizedBomWeights = new Map<string, number>(
      [...bomWeights.entries()].map(([code, weight]) => [normalizeCodeStrict(code), weight]),
    );
    for (const item of runResults) {
      const quantity = Math.round(item.demandPlan ?? item.productionPlan);
      if (quantity <= 0) continue;
      const isPipe = item.category.endsWith("Pipe");
      const isFitting = item.category.endsWith("Fitting");
      // Solvents intentionally stay out of the machine app: the local
      // capacity model treats them as unconstrained/pass-through demand.
      if (!isPipe && !isFitting) continue;
      const material = String(item.material ?? item.category.split(" ")[0] ?? "").trim().toUpperCase();
      const demandItem: PlumbingScheduleDemand = {
        item_code: item.itemCode,
        material,
        qty_pcs: quantity,
      };
      demandByKind[isPipe ? "pipe" : "fitting"].push(demandItem);
      const weight = normalizedBomWeights.get(normalizeCodeStrict(item.itemCode))
        ?? bomWeights.get(item.itemCode.trim().toUpperCase());
      if (weight !== undefined) weightByCode.set(item.itemCode, weight);
    }
    const schedule = await runPlumbingSchedule({
      month: run.month,
      workedSundayDates,
      demandByKind,
      weightByCode,
      machineLockedOut: new Map(machineRows.map((machine) => [machine.machineId, machine.lockedOut])),
    });
    const solventExclusions = runResults
      .filter((item) => item.category.endsWith("Solvent") && (item.demandPlan ?? item.productionPlan) > 0)
      .map((item) => ({
        item_code: item.itemCode,
        category: item.category,
        qty_pcs: Math.round(item.demandPlan ?? item.productionPlan),
      }));
    const requestsByKind = new Map(schedule.results.map((result) => [
      result.kind,
      {
        segment: "PLUMBING",
        month: run.month,
        kind: result.kind,
        week_days: schedule.week_days,
        demand: demandByKind[result.kind].filter((item) => !schedule.unroutable.some((row) => row.kind === result.kind && row.item_code === item.item_code)),
      },
    ]));
    await db.insert(planScheduleResultsTable).values(
      schedule.results.map((result) => {
        const sentDemand = demandByKind[result.kind].filter(
          (item) => !schedule.unroutable.some((row) => row.kind === result.kind && row.item_code === item.item_code),
        );
        return {
          batchId: schedule.batchId,
          runId: id,
          month: run.month,
          segment: "Plumbing",
          kind: result.kind,
          weekDays: schedule.week_days,
          requestJson: requestsByKind.get(result.kind)!,
          resultJson: result.raw,
          demandPieces: sentDemand.reduce((sum, item) => sum + item.qty_pcs, 0),
          demandKg: schedule.demand.kg === null ? null : sentDemand.reduce((sum, item) => sum + item.qty_pcs * (weightByCode.get(item.item_code) ?? 0), 0),
          scheduledPieces: result.total_scheduled_pcs,
          scheduledKg: result.total_scheduled_kg,
          unfinishedPieces: result.total_unfinished_pcs,
          unfinishedKg: result.total_unfinished_kg,
          unfinishedHours: result.total_unfinished_hours,
          capacityHours: result.total_capacity_hrs,
          scheduledHours: result.total_scheduled_hrs,
          idleHours: result.total_idle_hrs,
          downtimeHoursLost: result.total_downtime_hours_lost,
          downtimeMachineDays: result.total_downtime_machine_days,
        };
      }),
    );

    // Promote the scheduler's executable quantity into the frozen production
    // run. Demand remains in demandPlan, so downstream consumers can choose
    // an explicit basis instead of guessing what productionPlan means.
    const unfinishedByCode = new Map<string, number>();
    for (const unfinished of schedule.merged.unfinished) {
      const code = normalizeCodeStrict(String(unfinished.item_code ?? ""));
      if (code) unfinishedByCode.set(code, (unfinishedByCode.get(code) ?? 0) + Math.max(0, Number(unfinished.remaining_pcs ?? 0)));
    }
    const unroutableCodes = new Set(schedule.unroutable.map((row) => normalizeCodeStrict(row.item_code)));
    for (const item of runResults) {
      const demand = Math.max(0, Math.round(item.demandPlan ?? item.productionPlan));
      if (demand <= 0) continue;
      if (item.category.endsWith("Solvent")) {
        await db.update(planRunResultsTable)
          .set({
            productionPlan: demand,
            cannotBeMade: 0,
            feasibilityStatus: "fitted",
          })
          .where(eq(planRunResultsTable.id, item.id));
        continue;
      }
      const unfinished = Math.min(demand, Math.round(unfinishedByCode.get(normalizeCodeStrict(item.itemCode)) ?? 0));
      const scheduled = Math.max(0, demand - unfinished);
      const residual = Math.max(0, demand - scheduled);
      await db.update(planRunResultsTable)
        .set({
          productionPlan: scheduled,
          cannotBeMade: residual,
          feasibilityStatus: residual > 0 || unroutableCodes.has(normalizeCodeStrict(item.itemCode))
            ? "unfulfillable"
            : "fitted",
        })
        .where(eq(planRunResultsTable.id, item.id));
    }

    res.json({
      ...schedule,
      sourceRunId: id,
      storedKinds: PLUMBING_SCHEDULE_KINDS,
      solventsExcludedAsUnconstrained: solventExclusions.length,
      solventExclusions,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Machine scheduler failed";
    res.status(502).json({
      error: "PLUMBING_SCHEDULER_FAILED",
      message,
    });
  }
});

/** GET /api/plan/runs/:id/export/excel — export only persisted frozen rows */
router.get("/plan/runs/:id/export/excel", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [run] = await db.select().from(planRunsTable).where(eq(planRunsTable.id, id));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  const buffer = await exportFrozenRunExcel(run, run.planType as "temporary" | "production");
  const prefix = run.segment === "Plumbing" ? "Plumbing" : "PTMT";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${prefix}_${run.planType === "temporary" ? "Temporary" : "Production"}_Plan_${run.month}_${exportTimestamp()}.xlsx"`);
  res.send(buffer);
});

/** GET /api/plan/runs/:id/drift — frozen "as issued" vs live rebuild "if re-run today" */
router.get("/plan/runs/:id/drift", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [run] = await db.select().from(planRunsTable).where(eq(planRunsTable.id, id));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  let liveItems: Awaited<ReturnType<typeof buildPlanItems>>;
  try {
    liveItems = await buildPlanItems(run.month, run.segment);
  } catch (err) {
    handlePlanError(res, err);
    return;
  }

  const frozen = await db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, id));

  // Category-qualified identity: the same code+colour can legitimately appear in
  // multiple categories (documented dual-category roster pattern), so keying only
  // by code::colour would silently collapse those rows.
  const frozenByKey = new Map(frozen.map((r) => [`${r.itemCode}::${r.colour}::${r.category}`, r]));
  const liveByKey = new Map(liveItems.map((i) => [`${i.itemCode}::${i.colour}::${i.category}`, i]));
  const allKeys = new Set([...frozenByKey.keys(), ...liveByKey.keys()]);

  const catAgg = new Map<string, { frozenMax: number; liveMax: number }>();
  const itemDiffs: Array<{
    itemCode: string; colour: string; category: string;
    frozenPlan: number; livePlan: number; delta: number;
  }> = [];
  let frozenGrand = 0;
  let liveGrand = 0;

  for (const key of allKeys) {
    const f = frozenByKey.get(key);
    const l = liveByKey.get(key);
    const category = f?.category ?? l?.category ?? "";
    const frozenPlan = Math.round(Math.max(f?.productionPlan ?? 0, 0));
    const livePlan = Math.round(Math.max(l?.maxProduction ?? 0, 0));
    frozenGrand += frozenPlan;
    liveGrand += livePlan;
    const agg = catAgg.get(category) ?? { frozenMax: 0, liveMax: 0 };
    agg.frozenMax += frozenPlan;
    agg.liveMax += livePlan;
    catAgg.set(category, agg);
    if (frozenPlan !== livePlan) {
      const itemCode = f?.itemCode ?? l?.itemCode ?? "";
      const colour = f?.colour ?? l?.colour ?? "";
      itemDiffs.push({ itemCode, colour, category, frozenPlan, livePlan, delta: livePlan - frozenPlan });
    }
  }
  itemDiffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  res.json({
    runId: run.id,
    month: run.month,
    segment: run.segment,
    status: run.status,
    asOfAt: run.asOfAt,
    frozenGrandTotal: frozenGrand,
    liveGrandTotal: liveGrand,
    grandDelta: liveGrand - frozenGrand,
    categories: [...catAgg.entries()]
      .map(([category, v]) => ({ category, frozenMax: v.frozenMax, liveMax: v.liveMax, delta: v.liveMax - v.frozenMax }))
      .sort((a, b) => a.category.localeCompare(b.category)),
    changedItems: itemDiffs,
    changedItemCount: itemDiffs.length,
  });
});

/** PATCH /api/plan/runs/:id/status-reason — admin-only provenance annotation */
router.patch("/plan/runs/:id/status-reason", loadSession, requireAdmin, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0) {
    res.status(400).json({ error: "Invalid plan run id" });
    return;
  }

  const parsed = parseStatusReasonInput(req.body);
  if (!parsed.ok) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const [updated] = await db
    .update(planRunsTable)
    .set({ planStatusReason: parsed.reason })
    .where(eq(planRunsTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Run not found" });
    return;
  }

  const results = await db
    .select()
    .from(planRunResultsTable)
    .where(eq(planRunResultsTable.runId, id));
  req.log.info({ runId: id }, "Plan run status reason updated by admin");
  res.json(makeSummary(updated, results));
});

/** DELETE /api/plan/runs/:id — permanently delete a run and all its data */
router.delete("/plan/runs/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [run] = await db.select().from(planRunsTable).where(eq(planRunsTable.id, id));
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }

  // A plan run cited by a corrective run is an immutable audit reference —
  // deleting it would erase the "measured against" citation from history.
  const citing = await db
    .select({ id: correctivePlanRunsTable.id })
    .from(correctivePlanRunsTable)
    .where(eq(correctivePlanRunsTable.planRunId, id));
  if (citing.length > 0) {
    res.status(409).json({
      error: `Plan run #${id} is cited as the baseline by ${citing.length} corrective run(s) (#${citing.slice(0, 5).map(c => c.id).join(", #")}${citing.length > 5 ? ", …" : ""}) and cannot be deleted.`,
    });
    return;
  }
  const frozenMonths = await db
    .select({ month: plantMonthSnapshotsTable.month })
    .from(plantMonthSnapshotsTable)
    .where(and(
      eq(plantMonthSnapshotsTable.planStatus, "monitoring"),
      eq(plantMonthSnapshotsTable.segment, "PTMT"),
      sql`${plantMonthSnapshotsTable.planEvidenceJson}->>'planRunId' = ${String(id)}`,
    ));
  if (frozenMonths.length > 0) {
    res.status(409).json({
      error: `Plan run #${id} is the finalized target source for frozen plant month ${frozenMonths[0].month} and cannot be deleted.`,
    });
    return;
  }

  await db.delete(planRunsTable).where(eq(planRunsTable.id, id));
  res.status(204).end();
});

/** POST /api/plan/runs/:id/finalize — lock a draft run */
router.post("/plan/runs/:id/finalize", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const [run] = await db.select().from(planRunsTable).where(eq(planRunsTable.id, id));
  if (!run) {
    res.status(404).json({ error: "Run not found" });
    return;
  }
  if (run.status === "finalized") {
    res.json({ message: "Already finalized", run: run.id });
    return;
  }
  const earlierFinalized = await db
    .select({ id: planRunsTable.id })
    .from(planRunsTable)
    .where(and(
      eq(planRunsTable.month, run.month),
      eq(planRunsTable.segment, run.segment),
      eq(planRunsTable.status, "finalized"),
      ne(planRunsTable.planType, "temporary"),
      ne(planRunsTable.id, id),
    ))
    .limit(1);
  let effectiveFrom: string;
  try {
    // Version one governs the whole month even if the run was issued later.
    effectiveFrom = earlierFinalized.length === 0
      ? monthStart(run.month)
      : req.body?.effectiveFrom === undefined
        ? (run.effectiveFrom ?? defaultEffectiveDate(run.month))
        : assertEffectiveDate(run.month, req.body.effectiveFrom);
    await validateNewVersionDate({ month: run.month, segment: run.segment, effectiveFrom, kind: "run", sourceId: id });
  } catch (err) {
    res.status(400).json({ error: String(err instanceof Error ? err.message : err) });
    return;
  }
  const results = await db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, id));
  // A draft is not yet a governing production version. Persist the immutable
  // timeline snapshot only after the run passes the finalization guard.
  if (run.planType === "production") {
    await savePlanVersionSnapshot({
      month: run.month,
      segment: run.segment,
      kind: "run",
      sourceId: id,
      effectiveFrom,
      sourceLabel: run.note ?? `Plan run #${id}`,
      targets: results.map((item) => ({
        itemCode: item.itemCode,
        colour: item.colour,
        category: item.category,
        maxPcs: item.productionPlan,
        minPcs: item.minProduction,
        w1: item.w1 ?? 0,
        w2: item.w2 ?? 0,
        w3: item.w3 ?? 0,
        w4: item.w4 ?? 0,
      })),
    });
  }
  await db.update(planRunsTable).set({ status: "finalized", effectiveFrom }).where(eq(planRunsTable.id, id));
  await setPlanVersionSnapshotEffectiveDate({ kind: "run", sourceId: id, effectiveFrom });
  const updated = { ...run, status: "finalized", effectiveFrom };
  res.json(makeSummary(updated, results));
});

export default router;
