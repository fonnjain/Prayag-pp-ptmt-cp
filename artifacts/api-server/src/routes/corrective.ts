import { Router, type IRouter } from "express";
import { launchBrowser } from "../lib/browser";
import { exportTimestamp } from "../lib/export-filename";
import { db, correctivePlanRunsTable, correctivePlanItemsTable, categoryCapacityTable, planRunsTable, planRunResultsTable } from "@workspace/db";
import { eq, desc, and, sql } from "drizzle-orm";
import { runCorrectiveReplan, type CorrectiveItemResult } from "../lib/corrective-engine";
import { exportPlanExcel, ITEM_COLUMNS, addLegendSheet, RED_FILL, GREEN_FILL } from "../lib/excel-export";
import { summarizePlan, type CalcPlanItem } from "../lib/calc";
import ExcelJS from "exceljs";

const router: IRouter = Router();

const STATUS_COLORS: Record<string, string> = {
  "on-plan":     "FF22C55E",
  "carried-over":"FFFBBF24",
  "demand-spike":"FFED8936",
  "deferred":    "FFEF4444",
  "unfulfillable":"FFDC2626",
  "replenished": "FF94A3B8",
  "new-item":    "FF6366F1",
};

const STATUS_FLAG: Record<string, string> = {
  "unfulfillable": "UNFULFILLABLE_THIS_MONTH",
  "carried-over":  "CARRIED_OVER",
  "demand-spike":  "DEMAND_SPIKE",
  "deferred":      "DEFERRED",
  "new-item":      "NEW_ITEM",
  "replenished":   "REPLENISHED",
  "on-plan":       "",
};

const PLUMBING_CATS_ORDER = [
  "CPVC Pipe", "CPVC Fitting", "CPVC Solvent",
  "UPVC Pipe", "UPVC Fitting", "UPVC Solvent",
  "SWR Pipe",  "SWR Fitting",  "SWR Solvent",
  "AGRI Pipe", "AGRI Fitting", "AGRI Solvent",
];

const CORRECTIVE_EXTRA_COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "Produced To Date",     key: "producedToDate",    width: 16 },
  { header: "Remaining To Produce", key: "remainingToProduce", width: 18 },
  { header: "Capacity/Day",         key: "capPerDay",          width: 34 },
  { header: "Feasible",             key: "feasible",           width: 12 },
  { header: "Shortfall",            key: "shortfall",          width: 12 },
  { header: "Revised Week",         key: "revisedWeek",        width: 13 },
  { header: "Spill From Week",      key: "spillFromWeek",      width: 15 },
  { header: "Status/Flags",         key: "statusFlags",        width: 24 },
];

type CorrectiveItem = typeof correctivePlanItemsTable.$inferSelect;
type CorrectiveRun  = typeof correctivePlanRunsTable.$inferSelect;
type CatCapRow = { category: string; overrideCapacity: number | null; suggestedCapacity: number };

function groupByCategory(items: CorrectiveItem[], requiredCats?: string[]): Map<string, CorrectiveItem[]> {
  const map = new Map<string, CorrectiveItem[]>();
  if (requiredCats) {
    for (const cat of requiredCats) map.set(cat, []);
  }
  for (const item of items) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return map;
}

// ─── POST /corrective/replan ─────────────────────────────────────────────────
router.post("/corrective/replan", async (req, res): Promise<void> => {
  const { month, weekClosed, asOfDate, segment, dailyCapacity, workingDaysPerWeek, planRunId, dryRun } = req.body as {
    month?: string;
    weekClosed?: number;
    asOfDate?: string;
    segment?: string;
    dailyCapacity?: number;
    workingDaysPerWeek?: number;
    /** number = use that frozen plan run; null = force live rebuild; undefined = auto (latest finalized) */
    planRunId?: number | null;
    /** true = compute but do not persist a run (used by the regression suite) */
    dryRun?: boolean;
  };

  if (!month || typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month is required (YYYY-MM)" });
    return;
  }

  if (asOfDate !== undefined) {
    if (typeof asOfDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
      res.status(400).json({ error: "asOfDate must be YYYY-MM-DD" });
      return;
    }
  } else {
    if (weekClosed === undefined || typeof weekClosed !== "number" || weekClosed < 0 || weekClosed > 3) {
      res.status(400).json({ error: "weekClosed is required (0=none, 1=after W1, 2=after W2, 3=after W3) unless asOfDate is provided" });
      return;
    }
  }

  const seg = (typeof segment === "string" && segment.trim()) ? segment.trim() : "PTMT";
  const effectiveWeekClosed = asOfDate !== undefined ? 0 : (weekClosed as number);

  // When weekClosed=0 and no asOfDate, default to today so workingDaysRemaining
  // reflects actual days left in the month (not the full month count).
  // This mirrors the Plumbing GET /plan/corrective-replan which defaults asOfDate=today.
  const effectiveAsOfDate = (asOfDate === undefined && effectiveWeekClosed === 0)
    ? new Date().toISOString().slice(0, 10)
    : asOfDate;

  // Resolve the baseline plan run:
  //   explicit number → that frozen run; explicit null → force live rebuild;
  //   undefined → latest FINALIZED plan run for this month+segment, else live.
  let resolvedPlanRunId: number | undefined;
  let resolvedPlanRunGrandMax: number | undefined;
  if (typeof planRunId === "number") {
    // Explicit baseline must exist, match month+segment, and be finalized —
    // a draft is not "as issued". Reject with a client error, not a 500.
    const [baseline] = await db.select().from(planRunsTable).where(eq(planRunsTable.id, planRunId));
    if (!baseline) {
      res.status(400).json({ error: `Plan run #${planRunId} not found` });
      return;
    }
    if (baseline.month !== month || baseline.segment !== seg) {
      res.status(400).json({ error: `Plan run #${planRunId} is for ${baseline.segment}/${baseline.month}, not ${seg}/${month}` });
      return;
    }
    if (baseline.status !== "finalized") {
      res.status(400).json({ error: `Plan run #${planRunId} is still a draft — finalize it before citing it as the corrective baseline` });
      return;
    }
    resolvedPlanRunId = planRunId;
  } else if (planRunId === undefined) {
    const [latest] = await db
      .select()
      .from(planRunsTable)
      .where(and(
        eq(planRunsTable.month, month),
        eq(planRunsTable.segment, seg),
        eq(planRunsTable.status, "finalized"),
      ))
      .orderBy(desc(planRunsTable.id))
      .limit(1);
    resolvedPlanRunId = latest?.id;
  }

  // Compute the plan run grand max for ANY resolved baseline — whether the
  // planRunId was supplied explicitly by the caller or auto-resolved above.
  // This value is (a) passed to the engine so BASELINE_INTEGRITY_ERROR fires
  // when the frozen items disagree with the plan run header, and (b) persisted
  // as frozen_plan_grand_max on the corrective run row (migration 022).
  //
  // IMPORTANT: this block MUST live outside the if/else branches above.
  // The old placement (inside the `planRunId === undefined` branch) silently
  // skipped the query for explicit-planRunId calls, leaving frozenPlanGrandMax
  // NULL and disabling the integrity guard for pinned baselines — the exact
  // scenario the guard was designed to protect.
  if (resolvedPlanRunId != null) {
    const [agg] = await db
      .select({ total: sql<number>`coalesce(sum(${planRunResultsTable.productionPlan}), 0)` })
      .from(planRunResultsTable)
      .where(eq(planRunResultsTable.runId, resolvedPlanRunId));
    resolvedPlanRunGrandMax = agg?.total != null ? Math.round(Number(agg.total)) : undefined;
  }

  try {
    const result = await runCorrectiveReplan({ month, weekClosed: effectiveWeekClosed, asOfDate: effectiveAsOfDate, segment: seg, dailyCapacity, workingDaysPerWeek, planRunId: resolvedPlanRunId, planRunGrandMax: resolvedPlanRunGrandMax, dryRun: dryRun === true });

    // Guard: a live rebuild with zero items is indistinguishable from a
    // legitimate "empty month" plan — but in practice it means the upstream
    // data (workbook / uploads) has not been seeded for this month.  Return a
    // named error so callers get a clear signal instead of a silent plan of zeros.
    if (result.baselinePlanRunId === null && result.categories.length === 0 && result.items.length === 0) {
      res.status(422).json({
        error: "EMPTY_BASELINE",
        message: `Corrective replan for ${seg}/${month} fell back to a live rebuild but produced zero items and zero categories. ` +
          `This usually means no finalized plan run exists for this month/segment and no upload data has been seeded. ` +
          `Finalize a plan run first (POST /plan/runs → POST /plan/runs/:id/finalize) before running the corrective.`,
        segment: seg,
        month,
        baselinePlanRunId: null,
        baselineSource: result.baselineSource,
      });
      return;
    }

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "corrective/replan failed");
    res.status(500).json({ error: "Corrective replan failed", detail: String(err) });
  }
});

// ─── DELETE /corrective/runs/:id ─────────────────────────────────────────────
router.delete("/corrective/runs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  // Atomic conditional delete: only removes the row when pinned = false.
  // This prevents a TOCTOU race between reading pinned and deleting.
  const deleted = await db
    .delete(correctivePlanRunsTable)
    .where(and(eq(correctivePlanRunsTable.id, id), eq(correctivePlanRunsTable.pinned, false)))
    .returning({ id: correctivePlanRunsTable.id });

  if (deleted.length > 0) {
    // Row existed and was not pinned — deleted successfully.
    res.status(204).end();
    return;
  }

  // No row deleted: either the run doesn't exist, or it is pinned.
  const [run] = await db
    .select({ id: correctivePlanRunsTable.id, pinned: correctivePlanRunsTable.pinned })
    .from(correctivePlanRunsTable)
    .where(eq(correctivePlanRunsTable.id, id))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: `No corrective run found with id ${id}.` });
    return;
  }

  // Row exists and pinned = true (the WHERE clause excluded it from the DELETE).
  res.status(409).json({
    error: `Corrective run #${id} is pinned and cannot be deleted. ` +
      `This run is protected because it is used as a regression-suite golden reference. ` +
      `To delete it, first unpin it via PATCH /api/corrective/runs/${id}/pin with { "pinned": false }.`,
    code: "PINNED_RUN",
    runId: id,
  });
});

// ─── PATCH /corrective/runs/:id/pin ──────────────────────────────────────────
router.patch("/corrective/runs/:id/pin", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const { pinned } = req.body as { pinned?: boolean };
  if (typeof pinned !== "boolean") {
    res.status(400).json({ error: "Request body must include { pinned: true } or { pinned: false }" });
    return;
  }

  const [run] = await db.select()
    .from(correctivePlanRunsTable)
    .where(eq(correctivePlanRunsTable.id, id))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: `No corrective run found with id ${id}.` });
    return;
  }

  await db.update(correctivePlanRunsTable)
    .set({ pinned })
    .where(eq(correctivePlanRunsTable.id, id));

  res.json({ runId: id, pinned, message: pinned ? `Run #${id} is now pinned and protected from deletion.` : `Run #${id} has been unpinned and can now be deleted.` });
});

// ─── PATCH /corrective/runs/:id ──────────────────────────────────────────────
// General-purpose update: note and/or frozenPlanGrandMax.
// frozenPlanGrandMax may be patched to an intentionally wrong value by the
// regression-suite fixture seed (NC22h-api drift-banner check).
router.patch("/corrective/runs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const { note, frozenPlanGrandMax } = req.body as { note?: string; frozenPlanGrandMax?: number };
  if (note === undefined && frozenPlanGrandMax === undefined) {
    res.status(400).json({ error: "Request body must include at least one of: note, frozenPlanGrandMax" });
    return;
  }
  if (frozenPlanGrandMax !== undefined && (typeof frozenPlanGrandMax !== "number" || !Number.isFinite(frozenPlanGrandMax))) {
    res.status(400).json({ error: "frozenPlanGrandMax must be a finite number" });
    return;
  }

  const [run] = await db.select()
    .from(correctivePlanRunsTable)
    .where(eq(correctivePlanRunsTable.id, id))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: `No corrective run found with id ${id}.` });
    return;
  }

  const updates: Partial<typeof correctivePlanRunsTable.$inferInsert> = {};
  if (note !== undefined) updates.note = note;
  if (frozenPlanGrandMax !== undefined) updates.frozenPlanGrandMax = Math.round(frozenPlanGrandMax);

  await db.update(correctivePlanRunsTable)
    .set(updates)
    .where(eq(correctivePlanRunsTable.id, id));

  res.json({ runId: id, updated: Object.keys(updates) });
});

// ─── GET /corrective/runs ────────────────────────────────────────────────────
router.get("/corrective/runs", async (req, res): Promise<void> => {
  const month = req.query.month ? String(req.query.month) : undefined;
  const segment = req.query.segment ? String(req.query.segment) : "PTMT";

  let query = db
    .select()
    .from(correctivePlanRunsTable)
    .orderBy(desc(correctivePlanRunsTable.createdAt))
    .$dynamic();

  if (month && segment) {
    query = query.where(and(eq(correctivePlanRunsTable.month, month), eq(correctivePlanRunsTable.segment, segment)));
  } else if (month) {
    query = query.where(eq(correctivePlanRunsTable.month, month));
  } else if (segment) {
    query = query.where(eq(correctivePlanRunsTable.segment, segment));
  }

  const runs = await query;
  res.json(runs.map(r => ({
    id: r.id,
    segment: r.segment,
    month: r.month,
    weekClosed: r.weekClosed,
    asOfDate: r.asOfDate,
    note: r.note,
    dailyCapacity: r.dailyCapacity,
    producedToDate: r.producedToDate,
    newOrdersQty: r.newOrdersQty,
    originalMonthTotal: r.originalMonthTotal,
    revisedMonthTotal: r.revisedMonthTotal,
    unfulfillableQty: r.unfulfillableQty,
    planRunId: r.planRunId ?? null,
    pinned: r.pinned ?? false,
    warnings: r.warningsJson,
    createdAt: r.createdAt,
  })));
});

// ─── GET /corrective/runs/:id ────────────────────────────────────────────────
router.get("/corrective/runs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [run] = await db.select()
    .from(correctivePlanRunsTable)
    .where(eq(correctivePlanRunsTable.id, id))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: `No corrective run found with id ${id}.` });
    return;
  }

  const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, run.id));

  res.json({
    runId: run.id,
    segment: run.segment,
    month: run.month,
    weekClosed: run.weekClosed,
    asOfDate: run.asOfDate,
    note: run.note,
    dailyCapacity: run.dailyCapacity,
    workingDaysPerWeek: run.workingDaysPerWeek,
    producedToDate: run.producedToDate,
    newOrdersQty: run.newOrdersQty,
    originalMonthTotal: run.originalMonthTotal,
    revisedMonthTotal: run.revisedMonthTotal,
    unfulfillableQty: run.unfulfillableQty,
    planRunId: run.planRunId ?? null,
    frozenPlanGrandMax: run.frozenPlanGrandMax ?? null,
    pinned: run.pinned ?? false,
    weekStats: run.weekStatsJson,
    warnings: run.warningsJson,
    items: items.map(i => ({
      itemCode: i.itemCode,
      colour: i.colour,
      category: i.category,
      avg3MoSale: i.avg3MoSale,
      bufferMultiplier: i.bufferMultiplier,
      stockOpen: i.stockOpen,
      producedToDate: i.producedToDate,
      stockNow: i.stockNow,
      pendingAtPlan: i.pendingAtPlan,
      pendingNow: i.pendingNow,
      pendingLastMonth: i.pendingLastMonth,
      originalPlan: i.originalPlan,
      originalWeek: i.originalWeek,
      bufferReqRev: i.bufferReqRev,
      planRev: i.planRev,
      remainingToProduce: i.remainingToProduce,
      deltaNewOrders: i.deltaNewOrders,
      deltaProduction: i.deltaProduction,
      deltaNet: i.deltaNet,
      coverNow: i.coverNow,
      newWeek: i.newWeek,
      w1Rev: i.w1Rev,
      w2Rev: i.w2Rev,
      w3Rev: i.w3Rev,
      w4Rev: i.w4Rev,
      status: i.status,
      isNewItem: i.isNewItem === 1,
    })),
  });
});

// ─── Shared Excel builder ─────────────────────────────────────────────────────

async function buildCorrectiveExcel(run: typeof correctivePlanRunsTable.$inferSelect, items: (typeof correctivePlanItemsTable.$inferSelect)[]): Promise<Buffer> {
  const segmentLabel = run.segment ?? "PTMT";
  const wb = new ExcelJS.Workbook();
  wb.creator = "PTMT Production Planning";

  // Pre-compute totals from item-level Math.round to avoid real-float rounding gap
  // (stored revised_month_total is a 32-bit real; sum-then-round can differ by up to 100 pcs)
  const grandMinComputed = items.reduce((s, i) => s + Math.round(Number(i.originalPlan ?? 0)), 0);
  const grandMaxComputed = items.reduce((s, i) => s + Math.round(Number(i.planRev ?? 0)), 0);

  // ── Sheet 1: Summary ──
  const sumSh = wb.addWorksheet("Corrective Summary");
  sumSh.columns = [
    { header: "Metric", key: "metric", width: 36 },
    { header: "Value", key: "value", width: 20 },
  ];
  const weekStats = (run.weekStatsJson as Array<{ weekLabel: string; released: number; capacity: number; produced: number; lag: number; loadFactor: number }>) ?? [];
  const summaryRows = [
    ["Run ID", `Run #${run.id}`],
    ["Run Date", new Date(run.createdAt).toLocaleString("en-IN")],
    ["Segment", segmentLabel],
    ["Month", run.month],
    ["Week Closed", `W${run.weekClosed}`],
    ["Daily Capacity (pcs)", run.dailyCapacity.toLocaleString()],
    ["Produced To Date (pcs)", Math.round(run.producedToDate).toLocaleString()],
    ["New Orders This Month (pcs)", Math.round(run.newOrdersQty).toLocaleString()],
    ["Original Month Total (pcs)", grandMinComputed.toLocaleString()],
    ["Revised Month Total (pcs)", grandMaxComputed.toLocaleString()],
    ["Unfulfillable This Month (pcs)", Math.round(run.unfulfillableQty).toLocaleString()],
    ...weekStats.map(ws => [
      `${ws.weekLabel}: Load Factor`,
      `${ws.loadFactor.toFixed(2)}× (${Math.round(ws.released).toLocaleString()} vs cap ${Math.round(ws.capacity).toLocaleString()})`,
    ]),
  ];
  summaryRows.forEach(([metric, value]) => sumSh.addRow({ metric, value }));
  sumSh.getRow(1).font = { bold: true };

  // ── Sheet 2: Revised Release ──
  const relSh = wb.addWorksheet("Revised Release");
  relSh.columns = [
    { header: "Category", key: "category", width: 24 },
    { header: "Item Code", key: "itemCode", width: 14 },
    { header: "Colour", key: "colour", width: 12 },
    { header: "Orig Plan", key: "originalPlan", width: 12 },
    { header: "Orig Wk", key: "originalWeek", width: 10 },
    { header: "Produced", key: "producedToDate", width: 12 },
    { header: "New Orders Δ", key: "deltaNewOrders", width: 14 },
    { header: "Revised Plan", key: "planRev", width: 12 },
    { header: "Rev Plan (kg)", key: "kgRev", width: 14 },
    { header: "Remaining", key: "remainingToProduce", width: 12 },
    { header: "Remaining (kg)", key: "remainingKg", width: 14 },
    { header: "Cover Now", key: "coverNow", width: 12 },
    { header: "New Wk", key: "newWeek", width: 10 },
    { header: "W1 Rev", key: "w1Rev", width: 10 },
    { header: "W2 Rev", key: "w2Rev", width: 10 },
    { header: "W3 Rev", key: "w3Rev", width: 10 },
    { header: "W4 Rev", key: "w4Rev", width: 10 },
    { header: "Status", key: "status", width: 16 },
    { header: "Δ Net", key: "deltaNet", width: 12 },
  ];
  relSh.getRow(1).font = { bold: true };
  relSh.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

  for (const item of items) {
    const row = relSh.addRow({
      category: item.category,
      itemCode: item.itemCode,
      colour: item.colour,
      originalPlan: Math.round(item.originalPlan),
      originalWeek: item.originalWeek ? `W${item.originalWeek}` : "—",
      producedToDate: Math.round(item.producedToDate),
      deltaNewOrders: Math.round(item.deltaNewOrders),
      planRev: Math.round(item.planRev),
      remainingToProduce: Math.round(item.remainingToProduce),
      coverNow: item.coverNow !== null ? item.coverNow.toFixed(2) : "OS",
      newWeek: item.newWeek ? `W${item.newWeek}` : "—",
      w1Rev: Math.round(item.w1Rev) || "",
      w2Rev: Math.round(item.w2Rev) || "",
      w3Rev: Math.round(item.w3Rev) || "",
      w4Rev: Math.round(item.w4Rev) || "",
      status: item.status,
      deltaNet: Math.round(item.deltaNet),
    });

    const statusColor = STATUS_COLORS[item.status] ?? "FFFFFFFF";
    const statusCell = row.getCell("status");
    statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: statusColor } };
    statusCell.font = { color: { argb: "FFFFFFFF" } };

    if (item.deltaNet > 0) {
      row.getCell("deltaNet").font = { color: { argb: "FFEF4444" } };
    } else if (item.deltaNet < 0) {
      row.getCell("deltaNet").font = { color: { argb: "FF22C55E" } };
    }
  }

  // ── Sheet 3: Warnings ──
  const warnSh = wb.addWorksheet("Warnings");
  warnSh.columns = [
    { header: "Code", key: "code", width: 30 },
    { header: "Severity", key: "severity", width: 12 },
    { header: "Message", key: "message", width: 80 },
    { header: "Value", key: "value", width: 16 },
    { header: "Threshold", key: "threshold", width: 16 },
  ];
  warnSh.getRow(1).font = { bold: true };
  const warnings = (run.warningsJson as Array<{ code: string; severity: string; message: string; value?: number; threshold?: number }>) ?? [];
  for (const w of warnings) {
    warnSh.addRow({ code: w.code, severity: w.severity, message: w.message, value: w.value, threshold: w.threshold });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── Standard-format corrective Excel (same schema as main Production Plan) ──
async function buildCorrectiveStandardExcel(
  run: CorrectiveRun,
  items: CorrectiveItem[],
  segment: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PTMT Production Planning";

  const requiredCats = segment === "Plumbing" ? PLUMBING_CATS_ORDER : undefined;
  const byCategory = groupByCategory(items, requiredCats);

  // Pre-compute plan totals from item-level Math.round so that the header
  // "Revised Month Total" and the TOTAL row in the category table are derived
  // from the same rounding path. run.revisedMonthTotal is stored as real (32-bit
  // float) and its sum-then-round differs from sum-of-per-item-round by up to
  // ~100 pcs for a 1,000-item plan.
  const grandMaxComputed = items.reduce((s, i) => s + Math.round(i.planRev), 0);
  const grandMinComputed = items.reduce((s, i) => s + Math.round(i.originalPlan), 0);

  // ── Summary sheet — mirrors main plan structure exactly ──
  const sumSh = wb.addWorksheet("Summary");
  sumSh.columns = [
    { header: "Category", key: "category", width: 32 },
    { header: "Min Production Required", key: "minTotal", width: 22 },
    { header: "Max Production Required", key: "maxTotal", width: 22 },
  ];
  sumSh.getRow(1).font = { bold: true };
  // Same pattern as addSummarySheet in excel-export.ts: splice inserts blank at row 1,
  // shifting the column-header row (Category/Min/Max) to row 2; write title into row 1.
  // Do NOT addRow(title) before this — that creates a duplicate ghost row at row 3.
  sumSh.spliceRows(1, 0, []);
  sumSh.getRow(1).values = [`${segment} Corrective Plan — ${run.month} (Revised)`];

  // Min column semantics note: in the Standard corrective export Min = the
  // original (baseline) plan quantity for each item; Max = the revised quantity.
  // This differs from the main Production Plan where Min uses the buffer formula.
  // Min > Max for an item means it was deferred/unfulfillable in the corrective.
  // NOTE row sits at row 3 (after title and headers), before category data — intentional:
  // it explains the column semantics before the reader reaches the data.
  const noteRow = sumSh.addRow([`NOTE — Min column: baseline plan quantity (not buffer-formula minimum). Baseline plan run: ${run.planRunId != null ? `#${run.planRunId}` : "live rebuild"}. Max column: corrective-revised quantity.`]);
  noteRow.font = { italic: true, color: { argb: "FF64748B" } };
  noteRow.getCell(1).alignment = { wrapText: true };

  let grandMin = 0, grandMax = 0;
  for (const [cat, catItems] of byCategory) {
    const minTotal = catItems.reduce((s, i) => s + Math.round(i.originalPlan), 0);
    const maxTotal = catItems.reduce((s, i) => s + Math.round(i.planRev), 0);
    grandMin += minTotal;
    grandMax += maxTotal;
    sumSh.addRow({ category: cat, minTotal, maxTotal });
  }
  const sumTotalRow = sumSh.addRow({ category: "TOTAL", minTotal: grandMin, maxTotal: grandMax });
  sumTotalRow.font = { bold: true };

  // Run provenance footer — placed after TOTAL so it does not shift the Category header
  // row (row 2).  The two Summary sheets are identical through row 2 (headers); the NOTE
  // at row 3 (corrective only) offsets the data block by one row relative to the main
  // plan — safe because both consumers locate rows by string value, not offset.  The
  // blank separator below mirrors the AGRI-note and KPI conventions elsewhere so that a
  // row-iterating consumer does not mistake the provenance line for a category with null
  // Min/Max.
  // The PDF already carries Run #; the Excel footer now matches without affecting parity.
  sumSh.addRow([]);
  const provRow = sumSh.addRow([`Run #${run.id}  ·  ${new Date(run.createdAt).toLocaleString("en-IN")}`]);
  provRow.font = { italic: true, color: { argb: "FF334155" } };

  // ── Per-category sheets — identical column schema to main plan ──
  for (const [category, catItems] of byCategory) {
    const sheet = wb.addWorksheet(category.slice(0, 31));
    sheet.columns = ITEM_COLUMNS;
    sheet.getRow(1).font = { bold: true };

    for (const item of catItems) {
      const row = sheet.addRow({
        itemCode: item.itemCode,
        colour: item.colour,
        avg3MoSale: item.avg3MoSale,
        pendingOrder: Math.round(item.pendingNow),
        pendingOrderLastMonth: Math.round(item.pendingLastMonth),
        bufferReq: Math.round(item.bufferReqRev),
        stock: Math.round(item.stockNow),
        minProduction: Math.round(item.originalPlan),
        maxProduction: Math.round(item.planRev),
        order: 0,
      });
      row.getCell("maxProduction").fill = item.planRev > 0 ? RED_FILL : GREEN_FILL;
      row.getCell("minProduction").fill = item.originalPlan > 0 ? RED_FILL : GREEN_FILL;
    }

    // AGRI note goes BELOW all item rows (blank separator first) so downstream
    // consumers iterating rows until blank do not count it as an item.
    if (category.startsWith("AGRI")) {
      sheet.addRow([]);
      const noteRow = sheet.addRow([
        "ℹ AGRI: STOCK and BUFFER columns are read by header name. " +
        "The source sheet's AGRI formula swaps these two columns, so AGRI figures " +
        "intentionally differ from the source sheet totals.",
      ]);
      noteRow.font = { italic: true, color: { argb: "FF7F7F7F" } };
      noteRow.getCell(1).alignment = { wrapText: true };
    }
  }

  // ── Legend — identical to main plan ──
  addLegendSheet(wb);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── Full-detail corrective Excel (standard + corrective columns appended) ───
export async function buildCorrectiveDetailExcel(
  run: CorrectiveRun,
  items: CorrectiveItem[],
  catCapRows: CatCapRow[],
  segment: string,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "PTMT Production Planning";

  const requiredCats = segment === "Plumbing" ? PLUMBING_CATS_ORDER : undefined;
  const byCategory = groupByCategory(items, requiredCats);

  // Pre-compute plan totals from item-level Math.round so that the "Revised
  // Month Total" header cell and the TOTAL row in the category table agree
  // exactly (same rounding path as the per-category loop below).
  const grandPlanComputed = items.reduce((s, i) => s + Math.round(i.planRev), 0);
  // grandOrigComputed uses item-level Math.round (same rounding path as the per-category
  // TOTAL rows) so the "Original Month Total" header always agrees with the table TOTAL.
  // run.originalMonthTotal is stored as a 32-bit real and diverges by up to ~100 pcs.
  const grandOrigComputed = items.reduce((s, i) => s + Math.round(Number(i.originalPlan ?? 0)), 0);

  // Prefer the engine's persisted per-category results (categoriesJson): these
  // are the exact Cap/Day + feasible values the replan computed (p90/mean from
  // Sheet3 for Plumbing). The category-capacity DB table is only a legacy
  // fallback for runs recorded before categoriesJson existed — it can disagree
  // with the engine (Plumbing suggested capacities are 0 there).
  const engineCats = Array.isArray(run.categoriesJson)
    ? (run.categoriesJson as Array<{
        category: string;
        capPerDay?: number;
        feasible?: number;
        shortfall?: number;
        feasibleAtRunRate?: number;
        runRateDivergenceFlag?: boolean;
        capacityMethod?: string;
        capacityDays?: number | null;
        flags?: string[];
      }>)
    : [];
  const engineCapMap       = new Map(engineCats.map(c => [c.category, Math.round(c.capPerDay ?? 0)]));
  const engineFeasMap      = new Map(engineCats.map(c => [c.category, Math.round(c.feasible ?? 0)]));
  const engineRunRateMap   = new Map(engineCats.map(c => [c.category, Math.round(c.feasibleAtRunRate ?? 0)]));
  const engineDivergMap    = new Map(engineCats.map(c => [c.category, c.runRateDivergenceFlag ?? false]));
  const engineFlagsMap     = new Map(engineCats.map(c => [c.category, c.flags ?? [] as string[]]));
  const engineMethodMap    = new Map(engineCats.map(c => [c.category, c.capacityMethod ?? null as string | null]));
  const engineDaysMap      = new Map(engineCats.map(c => [c.category, c.capacityDays ?? null as number | null]));
  const dbCapMap = new Map(catCapRows.map(r => [r.category, r.overrideCapacity ?? r.suggestedCapacity]));
  const hasEngineCats = engineCats.length > 0;
  const getCap = (cat: string): number =>
    hasEngineCats ? (engineCapMap.get(cat) ?? 0) : (dbCapMap.get(cat) ?? 0);
  const wdr       = run.workingDaysRemaining ?? (4 - run.weekClosed) * (run.workingDaysPerWeek ?? 6);
  const getFeasible = (cat: string): number =>
    hasEngineCats ? (engineFeasMap.get(cat) ?? 0) : Math.round(getCap(cat) * wdr);
  const getRunRateFeasible = (cat: string): number | null =>
    hasEngineCats ? (engineRunRateMap.get(cat) ?? null) : null;
  const isDivergent = (cat: string): boolean => engineDivergMap.get(cat) ?? false;
  // Returns a human-readable Cap/Day label including the capacity method and
  // observation count when available, e.g. "3,609 (p90, 47 days observed)".
  // Falls back to just the number when method/days are not recorded (legacy runs).
  const getCapLabel = (cat: string): string | number => {
    const cap = getCap(cat);
    const method = engineMethodMap.get(cat);
    const days   = engineDaysMap.get(cat);
    if (!hasEngineCats || method == null) return cap;
    const daysStr = (days != null && days > 0) ? `, ${days} days observed` : "";
    return `${cap.toLocaleString()} (${method}${daysStr})`;
  };
  const asOfLabel = run.asOfDate ?? `After W${run.weekClosed}`;

  // ── Summary sheet — per-category plan/produced/remaining/feasible/shortfall ──
  const sumSh = wb.addWorksheet("Summary");
  sumSh.addRow(["As-of",                  asOfLabel]);
  sumSh.addRow(["Working Days Remaining", wdr]);
  sumSh.addRow(["Original Month Total",   grandOrigComputed]);
  sumSh.addRow(["Revised Month Total",    grandPlanComputed]);
  // Baseline traceability — cross-check the corrective baseline (grandOrigComputed,
  // item-level Math.round sum) against the FROZEN plan run total (frozenPlanGrandMax,
  // Σ productionPlan from plan_run_results, captured at run-creation time).
  // These come from independent sources: any divergence beyond ±200 pcs means the
  // corrective is no longer tracking its frozen baseline.
  // Legacy runs lack frozenPlanGrandMax (NULL) — fall back to the stored real column
  // with a note so the reader understands what they're seeing.
  if (run.planRunId != null) {
    if (run.frozenPlanGrandMax != null) {
      const frozen = run.frozenPlanGrandMax;
      const diff = grandOrigComputed - frozen;
      const absDiff = Math.abs(diff);
      const mismatch = absDiff > 200
        ? `  ⚠ MISMATCH (Δ${diff > 0 ? "+" : ""}${diff.toLocaleString()} pcs)`
        : "";
      sumSh.addRow(["Baseline Plan Run",
        `#${run.planRunId}  (plan run: ${frozen.toLocaleString()} pcs · corrective baseline: ${grandOrigComputed.toLocaleString()} pcs${mismatch})`]);
    } else {
      // Legacy run: frozenPlanGrandMax not recorded; citing stored real — can differ
      // by 0–100 pcs from grandOrigComputed due to real→float rounding only.
      sumSh.addRow(["Baseline Plan Run",
        `#${run.planRunId}  (corrective baseline: ${grandOrigComputed.toLocaleString()} pcs — frozen plan total not recorded for this run)`]);
    }
  } else {
    sumSh.addRow(["Baseline Plan Run", "Live rebuild (no frozen run)"]);
  }
  // Run provenance — id and created-at distinguish a re-exported run from a
  // freshly-generated one (the PDF already carries Run #; the Excel now matches).
  sumSh.addRow(["Run ID", `Run #${run.id}`]);
  sumSh.addRow(["Run Date", new Date(run.createdAt).toLocaleString("en-IN")]);
  sumSh.addRow([]);
  sumSh.getRow(1).font = { bold: true };
  sumSh.getRow(2).font = { bold: true };
  sumSh.getColumn(1).width = 28;
  for (let c = 2; c <= 7; c++) sumSh.getColumn(c).width = 14;
  sumSh.getColumn(5).width = 34; // Cap/Day — label includes method + days, needs extra room

  if (!hasEngineCats) {
    // Legacy run: capacity data was not persisted. Add a prominent warning row
    // so Cap/Day=0 is clearly labelled rather than silently misleading.
    const legacyWarnRow = sumSh.addRow([
      "⚠ LEGACY RUN — capacity data was not recorded for this run (saved before per-run capacity tracking). " +
      "Cap/Day and Feasible figures below are from the category-capacity DB table and may be incorrect " +
      "(Plumbing values will be 0). Re-run the corrective re-plan to get accurate capacity numbers.",
    ]);
    legacyWarnRow.font = { bold: true, color: { argb: "FF92400E" } };
    legacyWarnRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
    legacyWarnRow.getCell(1).alignment = { wrapText: true };
    sumSh.getRow(sumSh.rowCount).height = 42;
    sumSh.addRow([]);
  }

  for (let c = 8; c <= 10; c++) sumSh.getColumn(c).width = 20;

  const catHdrRow = sumSh.addRow(["Category", "Plan (Revised)", "Produced", "Remaining", "Cap/Day", "Feasible (capacity)", "Shortfall", "Feasible (run-rate)", "⚠ Divergence?"]);
  catHdrRow.font = { bold: true };
  catHdrRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

  let grandPlan = 0, grandProd = 0, grandRem = 0, grandFeas = 0, grandShort = 0;
  for (const [cat, catItems] of byCategory) {
    const plan      = catItems.reduce((s, i) => s + Math.round(i.planRev), 0);
    const produced  = catItems.reduce((s, i) => s + Math.round(i.producedToDate), 0);
    const remaining = catItems.reduce((s, i) => s + Math.round(i.remainingToProduce), 0);
    const cap       = getCap(cat);
    const feasible  = getFeasible(cat);
    const runRate   = getRunRateFeasible(cat);
    const divergent = isDivergent(cat);
    const shortfall = Math.max(remaining - feasible, 0);
    grandPlan  += plan;  grandProd   += produced;  grandRem  += remaining;
    grandFeas  += feasible; grandShort += shortfall;
    const dataRow = sumSh.addRow([
      cat, plan, produced, remaining, getCapLabel(cat), feasible, shortfall,
      runRate !== null && runRate > 0 ? runRate : "",
      divergent ? "RUN_RATE_DIVERGENCE" : "",
    ]);
    if (divergent) {
      dataRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
      dataRow.getCell(9).font = { bold: true, color: { argb: "FF92400E" } };
    }
  }
  const detTotalRow = sumSh.addRow(["TOTAL", grandPlan, grandProd, grandRem, "", grandFeas, grandShort]);
  detTotalRow.font = { bold: true };

  // ZERO_CAP_WITH_PRODUCTION — critical engine warning: category produced pcs but Cap/Day = 0.
  // Surfaced here on the Summary (not on item rows) because it is category-level and severity: critical.
  const zeroCaps = engineCats.filter(c => (c.flags ?? []).includes("ZERO_CAP_WITH_PRODUCTION"));
  if (zeroCaps.length > 0) {
    sumSh.addRow([]);
    const zcHdr = sumSh.addRow(["⚠ CRITICAL — ZERO_CAP_WITH_PRODUCTION"]);
    zcHdr.font = { bold: true, color: { argb: "FF991B1B" } };
    for (const c of zeroCaps) {
      const r = sumSh.addRow([
        `${c.category}: recorded production but Cap/Day resolved to 0 (method=${c.capacityMethod ?? "?"}) — capacity derivation bug`,
      ]);
      r.font = { color: { argb: "FF991B1B" } };
    }
  }

  // Reconciliation note — "Shortfall" above and "sum of UNFULFILLABLE items' Remaining To Produce"
  // (on the item sheets) answer different questions and legitimately disagree:
  //
  //   Shortfall = max(total category remaining − total capacity feasible, 0)
  //             measures whether enough aggregate capacity exists across all remaining working days.
  //
  //   UNFULFILLABLE items' remaining = sum of remainingToProduce for items the algorithm could not
  //             fit into any single week's bucket.
  //
  //   The two differ because the scheduler places WHOLE ITEMS into WEEKLY BUCKETS (greedy, urgency-
  //   ordered, no splitting). This is stricter than the aggregate capacity check:
  //
  //     Positive gap (sum > shortfall) — A large item can't fit any week's bucket even though
  //       total feasible covers it if you could split it freely across days (shortfall may even be 0).
  //       The item is UNFULFILLABLE by scheduling rules despite no overall capacity gap.
  //       Seen in Aug-26: CPVC Pipe +9,647 pcs (3 items), SWR Pipe +9,638 pcs (1 item).
  //
  //     Negative gap (sum < shortfall) — The category is capacity-constrained, but schedulable
  //       items also consume feasible capacity, so their remaining absorbs part of the shortfall
  //       that would otherwise show up in the UNFULFILLABLE sum.
  //       Seen in Aug-26: UPVC Fitting −14 pcs, AGRI Fitting −8 pcs.
  //
  //   Use Summary Shortfall for capacity gap analysis and resource allocation.
  //   Use per-item Remaining To Produce (item sheets) for line-level production scheduling.
  sumSh.addRow([]);
  const reconcileNote = sumSh.addRow([
    "ℹ Shortfall (above) = max(category remaining − feasible, 0): aggregate capacity gap. " +
    "UNFULFILLABLE items' 'Remaining To Produce' (item sheets) can differ — the scheduler places " +
    "whole items into weekly buckets (no splitting), so a large item may be UNFULFILLABLE even " +
    "when total feasible > its remaining (positive gap), or scheduled items can absorb part of " +
    "the shortfall (negative gap). Use Shortfall for capacity planning; use item Remaining for " +
    "factory scheduling.",
  ]);
  reconcileNote.font = { italic: true, size: 9, color: { argb: "FF475569" } };
  reconcileNote.getCell(1).alignment = { wrapText: true };
  sumSh.getRow(sumSh.rowCount).height = 60;

  // ── Per-category sheets — ITEM_COLUMNS + CORRECTIVE_EXTRA_COLUMNS ──
  // Cap/Day, Feasible and Shortfall are CATEGORY-LEVEL figures — stamping the same
  // value on every item row causes column sums to be ~N× too large for any downstream
  // consumer aggregating those columns. Instead we add one styled "capacity KPI" row
  // per category sheet and leave those columns blank on individual item rows.
  const allCols: Partial<ExcelJS.Column>[] = [...ITEM_COLUMNS, ...CORRECTIVE_EXTRA_COLUMNS];

  for (const [category, catItems] of byCategory) {
    const sheet = wb.addWorksheet(category.slice(0, 31));
    sheet.columns = allCols;
    sheet.getRow(1).font = { bold: true };

    const capPerDay = getCap(category);
    const feasible  = getFeasible(category);
    const catRem    = catItems.reduce((s, i) => s + Math.round(i.remainingToProduce), 0);
    const shortfall = Math.max(catRem - feasible, 0);
    // NOT_STARTED is a CATEGORY-level engine flag (produced=0 across the whole category).
    // Per-item "produced=0" is NOT the same signal — in Aug-26 it fires on 420/3636 PTMT
    // items (12%) and 327/1120 Plumbing items (29%), including 216 in Cocks Standard which
    // produced 169,742 pcs across 9/9 days. Read the flag from the engine's categoriesJson.
    const catEngineFlags = engineFlagsMap.get(category) ?? [];
    const catNotStarted  = catEngineFlags.includes("NOT_STARTED");
    const catNoDemCap    = catEngineFlags.includes("NO_DEMONSTRATED_CAPACITY");

    for (const item of catItems) {
      const spill = (item.newWeek !== null && item.originalWeek !== null && item.newWeek > item.originalWeek)
        ? `W${item.originalWeek}` : "—";

      // Per-item status flags:
      //   - base status (on-plan / carried-over / demand-spike / unfulfillable etc.)
      //   - NO_DEMONSTRATED_CAPACITY: capPerDay is category-level, so per-item equivalence holds
      //   - NOT_STARTED is category-level only; use ITEM_NOT_STARTED as the per-SKU signal name
      //     if a per-item signal is ever needed, to distinguish from the category flag.
      const flags: string[] = [];
      const baseFlag = STATUS_FLAG[item.status];
      if (baseFlag) flags.push(baseFlag);
      if (capPerDay === 0 && Math.round(Number(item.planRev)) > 0)
        flags.push("NO_DEMONSTRATED_CAPACITY");

      const row = sheet.addRow({
        itemCode: item.itemCode,
        colour: item.colour,
        avg3MoSale: item.avg3MoSale,
        pendingOrder: Math.round(item.pendingNow),
        pendingOrderLastMonth: Math.round(item.pendingLastMonth),
        bufferReq: Math.round(item.bufferReqRev),
        stock: Math.round(item.stockNow),
        minProduction: Math.round(item.originalPlan),
        maxProduction: Math.round(item.planRev),
        order: 0,
        producedToDate:    Math.round(item.producedToDate),
        remainingToProduce: Math.round(item.remainingToProduce),
        // capPerDay / feasible / shortfall intentionally omitted — category-level values
        // are shown in the KPI row below items; putting them on every item row causes
        // column aggregation to be ~N× too large.
        revisedWeek:  item.newWeek !== null ? `W${item.newWeek}` : "—",
        spillFromWeek: spill,
        statusFlags: flags.length > 0 ? flags.join(" | ") : "—",
      });
      row.getCell("maxProduction").fill = item.planRev > 0 ? RED_FILL : GREEN_FILL;
      row.getCell("minProduction").fill = item.originalPlan > 0 ? RED_FILL : GREEN_FILL;
      const statusColor = STATUS_COLORS[item.status] ?? "FF6B7280";
      const sfCell = row.getCell("statusFlags");
      sfCell.fill  = { type: "pattern", pattern: "solid", fgColor: { argb: statusColor } };
      sfCell.font  = { color: { argb: "FFFFFFFF" } };
    }

    // KPI row goes BELOW all item rows (blank separator first) so consumers iterating
    // from row 2 until blank count exactly catItems.length items and stop before the KPI.
    // Cap/Day, Feasible, Shortfall are category-level; the KPI row is the only correct
    // place to show them. NOT_STARTED and NO_DEMONSTRATED_CAPACITY are also category-level.
    sheet.addRow([]);
    const kpiFlagParts: string[] = [];
    if (catNotStarted)  kpiFlagParts.push("NOT_STARTED");
    if (catNoDemCap)    kpiFlagParts.push("NO_DEMONSTRATED_CAPACITY");
    const kpiRow = sheet.addRow({
      itemCode:   `◆ ${category} — ${catItems.length} items`,
      capPerDay:  getCapLabel(category),
      feasible,
      shortfall,
      statusFlags: kpiFlagParts.length > 0 ? kpiFlagParts.join(" | ") : "",
    });
    kpiRow.font = { bold: true, color: { argb: "FF1E40AF" } };
    kpiRow.eachCell({ includeEmpty: false }, (cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
    });
    // Wrap the Cap/Day cell so the method+days label is fully readable without
    // the user needing to widen the column manually.
    kpiRow.getCell("capPerDay").alignment = { wrapText: true, vertical: "top" };
    kpiRow.height = 30;

    // AGRI note after KPI row (already below items), separated by a blank row.
    if (category.startsWith("AGRI")) {
      sheet.addRow([]);
      const noteRow = sheet.addRow([
        "ℹ AGRI: STOCK and BUFFER columns are read by header name. " +
        "The source sheet's AGRI formula swaps these two columns, so AGRI figures " +
        "intentionally differ from the source sheet totals.",
      ]);
      noteRow.font = { italic: true, color: { argb: "FF7F7F7F" } };
      noteRow.getCell(1).alignment = { wrapText: true };
    }
  }

  // ── Legend ──
  addLegendSheet(wb);

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

// ─── GET /corrective/validate/export-totals ──────────────────────────────────
// Builds both the Detail and Standard corrective Excel files in memory, parses
// their actual header/TOTAL values, and verifies they agree with each other and
// with the item-level Math.round sum from the database.
//
// Catches the regression where a builder reverts to using the stored 32-bit real
// (run.revisedMonthTotal) instead of sum(Math.round(item.planRev)).
//
// Returns 404 when no corrective run exists for the requested month/segment
// (callers should treat 404 as "not yet run — skip check").
router.get("/corrective/validate/export-totals", async (req, res): Promise<void> => {
  const month = req.query.month ? String(req.query.month) : undefined;
  const segment = req.query.segment ? String(req.query.segment) : "PTMT";

  if (!month) { res.status(400).json({ error: "month is required" }); return; }

  const [run] = await db.select()
    .from(correctivePlanRunsTable)
    .where(and(eq(correctivePlanRunsTable.month, month), eq(correctivePlanRunsTable.segment, segment)))
    .orderBy(desc(correctivePlanRunsTable.createdAt))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: `No corrective run found for ${month} / ${segment}. Run the corrective re-plan first.` });
    return;
  }

  const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, run.id));

  const itemOrigSum = items.reduce((s, i) => s + Math.round(Number(i.originalPlan ?? 0)), 0);
  const itemPlanSum = items.reduce((s, i) => s + Math.round(Number(i.planRev      ?? 0)), 0);

  // Stored 32-bit real totals (rounded for comparison)
  const storedOrig    = Math.round(Number(run.originalMonthTotal ?? 0));
  const storedRevised = Math.round(Number(run.revisedMonthTotal  ?? 0));

  type CheckResult = { name: string; expected: number; actual: number; pass: boolean; tolerance?: string };
  const checks: CheckResult[] = [];

  // ── 1. Build Detail Excel (same builder as the actual user-facing Detail export) ──
  //    buildCorrectiveDetailExcel needs capacity rows for the cap/feasible columns.
    const capRows = await db.select().from(categoryCapacityTable).where(eq(categoryCapacityTable.segment, segment));
  const detailBuf = await buildCorrectiveDetailExcel(run, items, capRows, segment);
  const detailWb  = new ExcelJS.Workbook();
  await detailWb.xlsx.load(detailBuf as unknown as ArrayBuffer);
  // buildCorrectiveDetailExcel writes a "Summary" sheet; values are stored as numbers.
  const sumSheet = detailWb.getWorksheet("Summary");
  // Sentinel -1: if the sheet parse never overwrites this, the subsequent
  // check compares -1 against itemOrigSum/itemPlanSum and fails loudly —
  // catching regressions where the builder emits no parseable header rows.
  // Initialising to the item sum would make the check pass vacuously whenever
  // the workbook parse finds nothing (the original 39/103 bug was caught this way).
  let detailOrigHeader = -1;
  let detailPlanHeader = -1;
  if (sumSheet) {
    sumSheet.eachRow({ includeEmpty: false }, (row) => {
      const metric = String(row.getCell(1).value ?? "").trim();
      const rawVal = row.getCell(2).value;
      const parsed = typeof rawVal === "number" ? rawVal : NaN;
      if (!isNaN(parsed)) {
        if (metric === "Original Month Total") detailOrigHeader = parsed;
        if (metric === "Revised Month Total")  detailPlanHeader = parsed;
      }
    });
  }

  // ── 2. Build Standard Excel and extract the TOTAL row Min/Max ──
  const stdBuf = await buildCorrectiveStandardExcel(run, items, segment);
  const stdWb  = new ExcelJS.Workbook();
  await stdWb.xlsx.load(stdBuf as unknown as ArrayBuffer);
  const stdSumSheet = stdWb.getWorksheet("Summary");
  // Sentinels: -1 causes the ≤100 pcs checks below to fail if the TOTAL row
  // is never found — distinguishing "workbook parse succeeded, TOTAL present"
  // from "builder emitted no TOTAL row" (which would silently self-compare).
  let stdGrandMin   = -1;
  let stdGrandMax   = -1;
  if (stdSumSheet) {
    stdSumSheet.eachRow({ includeEmpty: false }, (row) => {
      const cat = String(row.getCell(1).value ?? "").trim();
      if (cat === "TOTAL") {
        const v2 = row.getCell(2).value;
        const v3 = row.getCell(3).value;
        if (typeof v2 === "number") stdGrandMin = v2;
        if (typeof v3 === "number") stdGrandMax = v3;
      }
    });
  }

  // ── 3. Checks ──
  checks.push({
    name: `ExportTotals · Detail "Original Month Total" (${detailOrigHeader}) == item-round sum (${itemOrigSum})`,
    expected: itemOrigSum, actual: detailOrigHeader,
    pass: detailOrigHeader === itemOrigSum,
    tolerance: "exact — builder must use sum(Math.round(item.originalPlan))",
  });
  checks.push({
    name: `ExportTotals · Detail "Revised Month Total" (${detailPlanHeader}) == item-round sum (${itemPlanSum})`,
    expected: itemPlanSum, actual: detailPlanHeader,
    pass: detailPlanHeader === itemPlanSum,
    tolerance: "exact — builder must use sum(Math.round(item.planRev))",
  });
  checks.push({
    name: `ExportTotals · Standard TOTAL Min (${stdGrandMin}) == item-round sum (${itemOrigSum})`,
    expected: itemOrigSum, actual: stdGrandMin,
    pass: stdGrandMin === itemOrigSum,
    tolerance: "exact — Standard builder must use sum(Math.round(item.originalPlan))",
  });
  checks.push({
    name: `ExportTotals · Standard TOTAL Max (${stdGrandMax}) == item-round sum (${itemPlanSum})`,
    expected: itemPlanSum, actual: stdGrandMax,
    pass: stdGrandMax === itemPlanSum,
    tolerance: "exact — Standard builder must use sum(Math.round(item.planRev))",
  });
  checks.push({
    name: `ExportTotals · Detail orig (${detailOrigHeader}) == Standard TOTAL Min (${stdGrandMin})`,
    expected: detailOrigHeader, actual: stdGrandMin,
    pass: detailOrigHeader === stdGrandMin && detailOrigHeader >= 0,
    tolerance: "exact — both use the same per-item rounding path",
  });
  checks.push({
    name: `ExportTotals · Detail revised (${detailPlanHeader}) == Standard TOTAL Max (${stdGrandMax})`,
    expected: detailPlanHeader, actual: stdGrandMax,
    pass: detailPlanHeader === stdGrandMax && detailPlanHeader >= 0,
    tolerance: "exact — both use the same per-item rounding path",
  });

  const origDivergence = Math.abs(detailOrigHeader - storedOrig);
  const planDivergence = Math.abs(detailPlanHeader - storedRevised);

  const failCount = checks.filter((c) => !c.pass).length;
  res.json({
    month, segment,
    runId: run.id,
    itemCount: items.length,
    detailOrigHeader, detailPlanHeader,
    stdGrandMin, stdGrandMax,
    storedOriginalMonthTotal: storedOrig,
    storedRevisedMonthTotal:  storedRevised,
    origDivergence, planDivergence,
    allPass: failCount === 0,
    passCount: checks.length - failCount, failCount, checks,
  });
});

// ─── GET /corrective/validate/schema-parity ──────────────────────────────────
router.get("/corrective/validate/schema-parity", async (req, res): Promise<void> => {
  const month = req.query.month ? String(req.query.month) : undefined;
  const segment = req.query.segment ? String(req.query.segment) : "PTMT";

  if (!month) { res.status(400).json({ error: "month is required" }); return; }

  const [run] = await db.select()
    .from(correctivePlanRunsTable)
    .where(and(eq(correctivePlanRunsTable.month, month), eq(correctivePlanRunsTable.segment, segment)))
    .orderBy(desc(correctivePlanRunsTable.createdAt))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: `No corrective run found for ${month} / ${segment}. Run the corrective re-plan first.` });
    return;
  }

  const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, run.id));

  type CheckResult = { name: string; expected: number; actual: number; pass: boolean; tolerance?: string };
  const checks: CheckResult[] = [];

  const detailOrigHeader = items.reduce((s, i) => s + Math.round(Number(i.originalPlan ?? 0)), 0);

  // 1. Build corrective-standard Excel (uses shared ITEM_COLUMNS)
  const corrStdBuffer = await buildCorrectiveStandardExcel(run, items, segment);

  // 2. Build skeleton main-plan Excel from the same corrective items (same data, same function)
  const planItems: CalcPlanItem[] = items.map(i => ({
    itemCode: i.itemCode, colour: i.colour, category: i.category,
    avg3MoSale: i.avg3MoSale,
    pendingOrder: Math.round(i.pendingNow),
    pendingOrderLastMonth: Math.round(i.pendingLastMonth),
    bufferReq: Math.round(i.bufferReqRev),
    stock: Math.round(i.stockNow),
    minProduction: Math.round(i.originalPlan),
    maxProduction: Math.round(i.planRev),
    order: 0,
    stockNeedsReview: false,
    achievementPct: null,
    cover: "OS" as const,
    week: null,
    w1: 0, w2: 0, w3: 0, w4: 0,
  }));
  const planSummary = summarizePlan(planItems);
  const reqCats     = segment === "Plumbing" ? PLUMBING_CATS_ORDER : undefined;
  const planBuffer  = await exportPlanExcel(run.month, planItems, planSummary, reqCats);

  // 3. Parse both workbooks with ExcelJS
  const corrWb = new ExcelJS.Workbook();
  await corrWb.xlsx.load(corrStdBuffer as unknown as ArrayBuffer);
  const planWb = new ExcelJS.Workbook();
  await planWb.xlsx.load(planBuffer as unknown as ArrayBuffer);

  const corrSheets = corrWb.worksheets.map(s => s.name);
  const planSheets = planWb.worksheets.map(s => s.name);

  checks.push({
    name: "SchemaParity · Sheet count matches",
    expected: planSheets.length, actual: corrSheets.length,
    pass: corrSheets.length === planSheets.length,
  });

  const sheetNamesMatch = corrSheets.length === planSheets.length &&
    corrSheets.every((n, i) => n === planSheets[i]);
  checks.push({
    name: "SchemaParity · Sheet names and order match",
    expected: 1, actual: sheetNamesMatch ? 1 : 0,
    pass: sheetNamesMatch,
  });

  const catSheets = corrSheets.filter(n => n !== "Summary" && n !== "Legend");
  for (const sheetName of catSheets) {
    const corrSheet = corrWb.getWorksheet(sheetName);
    const planSheet = planWb.getWorksheet(sheetName);
    if (!corrSheet || !planSheet) {
      checks.push({ name: `SchemaParity · "${sheetName}" exists in both`, expected: 1, actual: 0, pass: false });
      continue;
    }
    const corrHeaders = (corrSheet.getRow(1).values as (string | undefined)[]).filter(Boolean);
    const planHeaders = (planSheet.getRow(1).values as (string | undefined)[]).filter(Boolean);
    const headersMatch = JSON.stringify(corrHeaders) === JSON.stringify(planHeaders);
    checks.push({
      name: `SchemaParity · "${sheetName}" header row matches`,
      expected: 1, actual: headersMatch ? 1 : 0,
      pass: headersMatch,
    });
  }

  // ── Summary sheet parity: row-2 = "Category" header in both workbooks ──
  // The Summary sheet is excluded from the per-sheet loop above because it has
  // corrective-specific preamble rows (NOTE, provenance footer).  We still assert
  // that the Category / Min / Max column headers landed at row 2 in both workbooks
  // (title at row 1, headers at row 2 — the spliceRows pattern in addSummarySheet
  // and buildCorrectiveStandardExcel).  A deviation means the duplicate-addRow
  // ghost has returned or a new preamble row was inserted before the headers.
  const corrSumSheet = corrWb.getWorksheet("Summary");
  const planSumSheet = planWb.getWorksheet("Summary");
  if (corrSumSheet && planSumSheet) {
    const corrRow2A = String(corrSumSheet.getRow(2).getCell(1).value ?? "").trim();
    const planRow2A = String(planSumSheet.getRow(2).getCell(1).value ?? "").trim();
    checks.push({
      name: `SchemaParity · Summary row 2 = "Category" header in corrective workbook (actual: "${corrRow2A}")`,
      expected: 1, actual: corrRow2A === "Category" ? 1 : 0,
      pass: corrRow2A === "Category",
      tolerance: "row 1 = title, row 2 = Category/Min/Max headers; a duplicate addRow shifts this to row 3",
    });
    checks.push({
      name: `SchemaParity · Summary row 2 = "Category" header in plan workbook (actual: "${planRow2A}")`,
      expected: 1, actual: planRow2A === "Category" ? 1 : 0,
      pass: planRow2A === "Category",
      tolerance: "row 1 = title, row 2 = Category/Min/Max headers; a duplicate addRow shifts this to row 3",
    });
    // Header columns must also match exactly between the two workbooks.
    const corrSumRow2 = (corrSumSheet.getRow(2).values as (string | undefined)[]).filter(Boolean);
    const planSumRow2 = (planSumSheet.getRow(2).values as (string | undefined)[]).filter(Boolean);
    const sumHeadersMatch = JSON.stringify(corrSumRow2) === JSON.stringify(planSumRow2);
    checks.push({
      name: "SchemaParity · Summary header row columns match (Category / Min / Max)",
      expected: 1, actual: sumHeadersMatch ? 1 : 0,
      pass: sumHeadersMatch,
    });
  }

  const catMap = new Map<string, { planRev: number; produced: number; remaining: number }>();
  for (const item of items) {
    const e = catMap.get(item.category) ?? { planRev: 0, produced: 0, remaining: 0 };
    e.planRev   += Math.round(item.planRev);
    e.produced  += Math.round(item.producedToDate);
    e.remaining += Math.round(item.remainingToProduce);
    catMap.set(item.category, e);
  }
  for (const [cat, vals] of catMap) {
    const producedCapped = Math.min(vals.produced, vals.planRev);
    const got = producedCapped + vals.remaining;
    checks.push({
      name: `SchemaParity · ${cat} · planRev = producedCapped + remaining`,
      expected: vals.planRev, actual: got,
      pass: vals.planRev === got,
    });
  }

  const stdTotalRaw = items.reduce((s, item) => s + Number(item.planRev), 0);
  const runTotalRaw = Number(run.revisedMonthTotal);
  checks.push({
    name: "SchemaParity · Standard planRev total ≈ run revisedMonthTotal (±1 rounding)",
    expected: Math.round(runTotalRaw), actual: Math.round(stdTotalRaw),
    pass: Math.abs(stdTotalRaw - runTotalRaw) <= 1,
    tolerance: "±1 rounding",
  });

  const storedOrig    = Math.round(Number(run.originalMonthTotal ?? 0));
  const storedRevised = Math.round(Number(run.revisedMonthTotal  ?? 0));
  const detailPlanHeader = items.reduce((s, i) => s + Math.round(Number(i.planRev ?? 0)), 0);
  const stdGrandMin   = items.reduce((s, i) => s + Math.round(Number(i.originalPlan ?? 0)), 0);
  const stdGrandMax   = detailPlanHeader;
  const origDivergence = Math.abs(detailOrigHeader - storedOrig);
  const planDivergence = Math.abs(detailPlanHeader - storedRevised);

  const failCount = checks.filter((c) => !c.pass).length;
  res.json({
    month, segment,
    runId: run.id,
    itemCount: items.length,
    detailOrigHeader, detailPlanHeader,
    stdGrandMin, stdGrandMax,
    storedOriginalMonthTotal: storedOrig,
    storedRevisedMonthTotal:  storedRevised,
    origDivergence, planDivergence,
    allPass: failCount === 0,
    passCount: checks.length - failCount, failCount, checks,
  });
});

// ─── GET /corrective/runs/:id/export/excel ───────────────────────────────────
router.get("/corrective/runs/:id/export/excel", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }
  const format  = req.query.format  ? String(req.query.format)  : "detail";

  const [run] = await db.select()
    .from(correctivePlanRunsTable)
    .where(eq(correctivePlanRunsTable.id, id))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: `No corrective run found with id ${id}.` });
    return;
  }

  const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, run.id));
  const segLabel = run.segment ?? "PTMT";

  let buffer: Buffer;
  let suffix: string;
  if (format === "standard") {
    buffer = await buildCorrectiveStandardExcel(run, items, segLabel);
    suffix = "Standard";
  } else {
    const capRows = await db.select().from(categoryCapacityTable).where(eq(categoryCapacityTable.segment, segLabel));
    buffer = await buildCorrectiveDetailExcel(run, items, capRows, segLabel);
    suffix = "Detail";
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${segLabel}_Corrective_Plan_${run.month}_W${run.weekClosed}_${suffix}_${exportTimestamp()}.xlsx"`);
  res.send(buffer);
});

// ─── GET /corrective/runs/:id/export/pdf ─────────────────────────────────────
router.get("/corrective/runs/:id/export/pdf", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [run] = await db.select()
    .from(correctivePlanRunsTable)
    .where(eq(correctivePlanRunsTable.id, id))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: `No corrective run found with id ${id}.` });
    return;
  }

  const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, run.id));

  try {
    const html = buildCorrectivePdfHtml(run, items as unknown as CorrectiveItemResult[]);
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdfUint8 = await page.pdf({ format: "A4", landscape: true, printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" } });
      const segLabel = run.segment ?? "PTMT";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${segLabel}_Corrective_Plan_${run.month}_W${run.weekClosed}_${exportTimestamp()}.pdf"`);
      res.send(Buffer.from(pdfUint8));
    } finally {
      await browser.close();
    }
  } catch (err) {
    req.log.error({ err }, "corrective/export/pdf failed");
    res.status(500).json({ error: "PDF generation failed", detail: String(err) });
  }
});

// ─── GET /corrective/export/excel?month=&segment=&format= ────────────────────
router.get("/corrective/export/excel", async (req, res): Promise<void> => {
  const month = req.query.month ? String(req.query.month) : undefined;
  const segment = req.query.segment ? String(req.query.segment) : "PTMT";
  const format  = req.query.format  ? String(req.query.format)  : "detail";

  if (!month) { res.status(400).json({ error: "month is required" }); return; }

  const [run] = await db.select()
    .from(correctivePlanRunsTable)
    .where(and(eq(correctivePlanRunsTable.month, month), eq(correctivePlanRunsTable.segment, segment)))
    .orderBy(desc(correctivePlanRunsTable.createdAt))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: `No corrective run found for ${month} / ${segment}. Run the corrective re-plan first.` });
    return;
  }

  const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, run.id));

  const itemOrigSum = items.reduce((s, i) => s + Math.round(Number(i.originalPlan ?? 0)), 0);

  let buffer: Buffer;
  let suffix: string;
  if (format === "standard") {
    buffer = await buildCorrectiveStandardExcel(run, items, segment);
    suffix = "Standard";
  } else {
    const capRows = await db.select().from(categoryCapacityTable).where(eq(categoryCapacityTable.segment, segment));
    buffer = await buildCorrectiveDetailExcel(run, items, capRows, segment);
    suffix = "Detail";
  }

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${segment}_Corrective_Plan_${month}_W${run.weekClosed}_${suffix}.xlsx"`);
  res.send(buffer);
});

// ─── GET /corrective/export/pdf?month=&segment= ───────────────────────────────
router.get("/corrective/export/pdf", async (req, res): Promise<void> => {
  const month = req.query.month ? String(req.query.month) : undefined;
  const segment = req.query.segment ? String(req.query.segment) : "PTMT";

  if (!month) { res.status(400).json({ error: "month is required" }); return; }

  const [run] = await db.select()
    .from(correctivePlanRunsTable)
    .where(and(eq(correctivePlanRunsTable.month, month), eq(correctivePlanRunsTable.segment, segment)))
    .orderBy(desc(correctivePlanRunsTable.createdAt))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: `No corrective run found for ${month} / ${segment}. Run the corrective re-plan first.` });
    return;
  }

  const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, run.id));

  const itemOrigSum = items.reduce((s, i) => s + Math.round(Number(i.originalPlan ?? 0)), 0);

  try {
    const html = buildCorrectivePdfHtml(run, items as unknown as CorrectiveItemResult[]);
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdfUint8 = await page.pdf({ format: "A4", landscape: true, printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" } });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${segment}_Corrective_Plan_${month}_W${run.weekClosed}.pdf"`);
      res.send(Buffer.from(pdfUint8));
    } finally {
      await browser.close();
    }
  } catch (err) {
    req.log.error({ err }, "corrective/export/pdf failed");
    res.status(500).json({ error: "PDF generation failed", detail: String(err) });
  }
});

// ─── PDF HTML builder ─────────────────────────────────────────────────────────

const h = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtN = (n: number) => Math.round(n).toLocaleString("en-IN");

const STATUS_LABEL: Record<string, string> = {
  "on-plan": "On Plan", "carried-over": "Carried Over", "demand-spike": "Demand Spike",
  "deferred": "Deferred", "unfulfillable": "Unfulfillable", "replenished": "Replenished", "new-item": "New Item",
};
const STATUS_BG: Record<string, string> = {
  "on-plan": "#dcfce7", "carried-over": "#fef3c7", "demand-spike": "#ffedd5",
  "deferred": "#fee2e2", "unfulfillable": "#fecaca", "replenished": "#f1f5f9", "new-item": "#e0e7ff",
};
const STATUS_COLOR: Record<string, string> = {
  "on-plan": "#166534", "carried-over": "#92400e", "demand-spike": "#9a3412",
  "deferred": "#b91c1c", "unfulfillable": "#7f1d1d", "replenished": "#374151", "new-item": "#3730a3",
};

function buildCorrectivePdfHtml(
  run: typeof correctivePlanRunsTable.$inferSelect,
  items: CorrectiveItemResult[],
): string {
  const weekStats = (run.weekStatsJson as Array<{ weekLabel: string; released: number; capacity: number; produced: number; lag: number; loadFactor: number }>) ?? [];
  const warnings = (run.warningsJson as Array<{ code: string; severity: string; message: string }>) ?? [];
  const segLabel = run.segment ?? "PTMT";
  // Item-level sum of original plans — matches the "Original Month Total" header in
  // the Detail Excel export; used in the Baseline citation below.
  const grandOrigComputed = items.reduce((s, i) => s + Math.round(Number(i.originalPlan ?? 0)), 0);

  // Group items by category, only those needing action
  const byCat = new Map<string, CorrectiveItemResult[]>();
  for (const item of items) {
    if (item.remainingToProduce <= 0 && item.status === "replenished") continue;
    const arr = byCat.get(item.category) ?? [];
    arr.push(item);
    byCat.set(item.category, arr);
  }

  const WEEK_COLORS = ["#f97316", "#eab308", "#22c55e", "#3b82f6"];

  const catSections = [...byCat.entries()].map(([cat, catItems]) => {
    const rows = catItems
      .sort((a, b) => (a.coverNow ?? 999) - (b.coverNow ?? 999))
      .map(item => `
        <tr>
          <td>${h(item.itemCode)}</td>
          <td>${h(item.colour)}</td>
          <td style="text-align:right">${fmtN(item.originalPlan)}</td>
          <td style="text-align:right">${fmtN(item.producedToDate)}</td>
          <td style="text-align:right;color:${item.deltaNewOrders > 0 ? "#c2410c" : "#374151"}">${item.deltaNewOrders !== 0 ? (item.deltaNewOrders > 0 ? "+" : "") + fmtN(item.deltaNewOrders) : "—"}</td>
          <td style="text-align:right;font-weight:bold">${fmtN(item.planRev)}</td>
          <td style="text-align:right;font-weight:bold">${fmtN(item.remainingToProduce)}</td>
          <td style="text-align:right">${item.coverNow !== null ? item.coverNow.toFixed(2) : "OS"}</td>
          <td style="text-align:center">${item.newWeek ? `<span style="background:${WEEK_COLORS[(item.newWeek ?? 1) - 1]};color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold">W${item.newWeek}</span>` : "—"}</td>
          <td><span style="background:${STATUS_BG[item.status] ?? "#f3f4f6"};color:${STATUS_COLOR[item.status] ?? "#374151"};padding:1px 5px;border-radius:3px;font-size:9px">${STATUS_LABEL[item.status] ?? item.status}</span></td>
        </tr>`
      ).join("");
    return `
      <div style="margin-bottom:18px;page-break-inside:avoid">
        <h3 style="font-size:11px;margin:0 0 5px;color:#0f172a;border-bottom:1.5px solid #e2e8f0;padding-bottom:3px">${h(cat)}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:8.5px">
          <thead>
            <tr style="background:#f1f5f9">
              <th style="text-align:left;padding:3px 5px">Code</th>
              <th style="text-align:left;padding:3px 5px">Colour</th>
              <th style="text-align:right;padding:3px 5px">Orig Plan</th>
              <th style="text-align:right;padding:3px 5px">Produced</th>
              <th style="text-align:right;padding:3px 5px">Orders Δ</th>
              <th style="text-align:right;padding:3px 5px">Revised</th>
              <th style="text-align:right;padding:3px 5px">Remaining</th>
              <th style="text-align:right;padding:3px 5px">Cover</th>
              <th style="text-align:center;padding:3px 5px">New Wk</th>
              <th style="text-align:left;padding:3px 5px">Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");

  const weekRow = weekStats.map((ws, i) => `
    <td style="text-align:right;padding:4px 8px;color:${WEEK_COLORS[i] ?? "#374151"};font-weight:bold">${h(ws.weekLabel)}</td>
    <td style="text-align:right;padding:4px 8px">${fmtN(ws.released)}</td>
    <td style="text-align:right;padding:4px 8px">${fmtN(ws.capacity)}</td>
    <td style="text-align:right;padding:4px 8px;font-weight:bold;color:${ws.loadFactor > 1.05 ? "#b91c1c" : "#166534"}">${ws.loadFactor.toFixed(1)}×</td>
    <td style="text-align:right;padding:4px 8px;color:#16a34a">${ws.produced > 0 ? fmtN(ws.produced) : "—"}</td>
    <td style="text-align:right;padding:4px 8px;color:${ws.lag > 0 ? "#b91c1c" : "#9ca3af"}">${ws.lag > 0 ? fmtN(ws.lag) : "—"}</td>`
  ).join("</tr><tr>");

  const warnRows = warnings.map(w => {
    const sevColor = w.severity === "critical" ? "#fecaca" : w.severity === "high" ? "#ffedd5" : w.severity === "medium" ? "#fef3c7" : "#dbeafe";
    return `<tr><td style="padding:3px 5px;background:${sevColor};font-weight:bold">${h(w.severity)}</td><td style="padding:3px 5px">${h(w.code)}</td><td style="padding:3px 5px">${h(w.message)}</td></tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 9px; color: #1e293b; margin: 0; padding: 8px 12px; }
  h1 { font-size: 15px; font-weight: bold; margin: 0 0 4px; }
  h2 { font-size: 11px; font-weight: bold; margin: 14px 0 5px; color: #0f172a; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 3px; }
  table { border-collapse: collapse; width: 100%; }
  th { background: #f1f5f9; padding: 3px 5px; border: 1px solid #cbd5e1; text-align: left; font-size: 8px; font-weight: bold; }
  td { border: 1px solid #e2e8f0; padding: 2px 5px; }
  .kpi-row { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 10px; min-width: 130px; }
  .kpi .label { font-size: 8px; color: #6b7280; margin-bottom: 2px; }
  .kpi .val { font-size: 15px; font-weight: bold; }
</style>
</head>
<body>
  <h1>${h(segLabel)} Corrective Re-Plan — ${h(run.month)} — Week ${run.weekClosed} closed</h1>
  <p style="font-size:8px;color:#6b7280;margin:0 0 10px">Generated: ${new Date().toLocaleString("en-IN")} &nbsp;|&nbsp; Run #${run.id} &nbsp;|&nbsp; Baseline: ${run.planRunId != null ? (() => {
    if (run.frozenPlanGrandMax != null) {
      const diff = grandOrigComputed - run.frozenPlanGrandMax;
      const mismatch = Math.abs(diff) > 200 ? ` ⚠ MISMATCH (Δ${diff > 0 ? "+" : ""}${diff.toLocaleString()})` : "";
      return `Plan Run #${run.planRunId} (${fmtN(run.frozenPlanGrandMax)} pcs · corrective: ${fmtN(grandOrigComputed)} pcs${mismatch})`;
    }
    return `Plan Run #${run.planRunId} (${fmtN(run.originalMonthTotal)} pcs)`;
  })() : "Live rebuild"}</p>

  <div class="kpi-row">
    <div class="kpi"><div class="label">Original Plan</div><div class="val">${fmtN(run.originalMonthTotal)} pcs</div></div>
    <div class="kpi"><div class="label">Revised Plan</div><div class="val">${fmtN(run.revisedMonthTotal)} pcs</div></div>
    <div class="kpi"><div class="label">Produced To Date</div><div class="val">${fmtN(run.producedToDate)} pcs</div></div>
    <div class="kpi"><div class="label">New Orders</div><div class="val" style="color:#c2410c">+${fmtN(run.newOrdersQty)} pcs</div></div>
    <div class="kpi"><div class="label">Unfulfillable</div><div class="val" style="color:${run.unfulfillableQty > 0 ? "#b91c1c" : "#166534"}">${fmtN(run.unfulfillableQty)} pcs</div></div>
  </div>

  ${(() => {
    // Category capacity summary from the run's PERSISTED engine results —
    // the same values the engine computed (never re-derived from the DB
    // capacity table, which showed 0 for Plumbing and caused the Cap/Day=0
    // export regression).
    const cats = (run.categoriesJson as Array<{
      category: string; plan: number; produced: number; remaining: number;
      capPerDay: number; feasible: number; shortfall: number;
      capacityMethod?: string; capacityDays?: number | null;
      feasibleAtRunRate?: number; runRateDivergenceFlag?: boolean;
    }> | null) ?? null;
    if (!cats || cats.length === 0) {
      // Legacy run: categoriesJson was not persisted (saved before per-run capacity tracking).
      // Show an explicit note so the reader knows capacity data is unavailable — not that it is zero.
      return `
  <h2>Category Capacity &amp; Feasibility</h2>
  <p style="font-size:8.5px;color:#92400e;background:#fef3c7;border:1px solid #fcd34d;border-radius:4px;padding:6px 10px;margin-bottom:12px">
    <strong>⚠ Legacy run</strong> — this corrective run was saved before per-run capacity data was recorded.
    Capacity &amp; feasibility figures are not available for export.
    Re-run the corrective re-plan to generate a current export with full capacity numbers.
  </p>`;
    }
    const wdr = run.workingDaysRemaining;
    const divergentCats = cats.filter(c => c.runRateDivergenceFlag);
    const rows = cats.map(c => {
      const divergent = c.runRateDivergenceFlag ?? false;
      const hasRunRate = c.feasibleAtRunRate !== undefined && c.feasibleAtRunRate > 0;
      return `
      <tr style="${divergent ? "background:#fef3c7" : ""}">
        <td>${h(c.category)}</td>
        <td style="text-align:right">${fmtN(c.plan)}</td>
        <td style="text-align:right">${fmtN(c.produced)}</td>
        <td style="text-align:right">${fmtN(c.remaining)}</td>
        <td style="text-align:right;font-weight:bold">${fmtN(c.capPerDay)}</td>
        <td style="text-align:center;color:#6b7280">${h(c.capacityMethod ?? "—")}${c.capacityDays ? ` (${c.capacityDays}d)` : ""}</td>
        <td style="text-align:right;color:#1d4ed8">${fmtN(c.feasible)}</td>
        <td style="text-align:right;color:${hasRunRate ? (divergent ? "#c2410c" : "#4338ca") : "#9ca3af"}">${hasRunRate ? fmtN(c.feasibleAtRunRate!) : "—"}</td>
        <td style="text-align:right;color:${c.shortfall > 0 ? "#b91c1c" : "#166534"};font-weight:bold">${fmtN(c.shortfall)}</td>
        <td style="text-align:center">${divergent ? '<span style="background:#fbbf24;color:#78350f;padding:1px 5px;border-radius:3px;font-size:8px;font-weight:bold">⚠ RUN-RATE DIVERGENCE</span>' : '<span style="color:#9ca3af;font-size:8px">✓</span>'}</td>
      </tr>`;
    }).join("");
    const divergenceNote = divergentCats.length > 0
      ? `<p style="font-size:8px;color:#92400e;background:#fef3c7;border:1px solid #fcd34d;border-radius:4px;padding:5px 8px;margin-bottom:6px"><strong>⚠ ${divergentCats.length} categor${divergentCats.length === 1 ? "y" : "ies"} flagged for run-rate divergence</strong>: ${divergentCats.map(c => h(c.category)).join(", ")}. Capacity projection is &gt;50% above demonstrated run-rate — treat feasible (capacity) as optimistic ceiling.</p>`
      : "";
    return `
  <h2>Category Capacity &amp; Feasibility${wdr !== null && wdr !== undefined ? ` — ${wdr} working days remaining` : ""}</h2>
  ${divergenceNote}
  <table style="margin-bottom:12px">
    <thead><tr>
      <th>Category</th><th style="text-align:right">Plan (Rev)</th><th style="text-align:right">Produced</th>
      <th style="text-align:right">Remaining</th><th style="text-align:right">Cap/Day</th><th style="text-align:center">Method</th>
      <th style="text-align:right;color:#1d4ed8">Feasible (capacity)</th>
      <th style="text-align:right;color:#4338ca">Feasible (run-rate)</th>
      <th style="text-align:right">Shortfall</th><th style="text-align:center">Divergence</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
  })()}

  ${weekStats.length > 0 ? `
  <h2>Week-by-Week Summary</h2>
  <table style="margin-bottom:12px">
    <thead><tr>
      <th>Week</th><th style="text-align:right">Original Release</th><th style="text-align:right">Capacity</th>
      <th style="text-align:right">Load Factor</th><th style="text-align:right">Produced</th><th style="text-align:right">Lag</th>
    </tr></thead>
    <tbody><tr>${weekRow}</tr></tbody>
  </table>` : ""}

  ${warnings.length > 0 ? `
  <h2>Warnings (${warnings.length})</h2>
  <table style="margin-bottom:12px">
    <thead><tr><th>Severity</th><th>Code</th><th>Message</th></tr></thead>
    <tbody>${warnRows}</tbody>
  </table>` : ""}

  <h2>Revised Release by Category</h2>
  ${catSections || '<p style="color:#9ca3af;font-size:9px">No actionable items — all items are replenished or unfulfillable.</p>'}
</body>
</html>`;
}

export default router;
