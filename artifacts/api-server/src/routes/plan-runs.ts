import { Router, type IRouter } from "express";
import { db, bufferCategoriesTable, planRunsTable, planRunInputsTable, planRunResultsTable, pendingSnapshotsTable, correctivePlanRunsTable, plantMonthSnapshotsTable } from "@workspace/db";
import { and, eq, desc, ne, sql } from "drizzle-orm";
import { buildPlanItems, loadLatestUploadRowsByKind, handlePlanError } from "./plan";
import { summarizePlan } from "../lib/calc";
import {
  assertEffectiveDate,
  defaultEffectiveDate,
  monthStart,
  savePlanVersionSnapshot,
  setPlanVersionSnapshotEffectiveDate,
  validateNewVersionDate,
} from "../lib/plant-plan-timeline";

const router: IRouter = Router();

function makeSummary(run: typeof planRunsTable.$inferSelect, items: typeof planRunResultsTable.$inferSelect[]) {
  const grandMinTotal = items.reduce((s, r) => s + Math.max(r.minProduction, 0), 0);
  const grandMaxTotal = items.reduce((s, r) => s + Math.max(r.productionPlan, 0), 0);
  return {
    id: run.id,
    month: run.month,
    segment: run.segment,
    asOfAt: run.asOfAt,
    status: run.status,
    effectiveFrom: run.effectiveFrom ?? null,
    note: run.note ?? null,
    itemCount: items.length,
    grandMinTotal: Math.round(grandMinTotal),
    grandMaxTotal: Math.round(grandMaxTotal),
    createdAt: run.createdAt,
  };
}

/** POST /api/plan/runs — create a draft run, snapshot all inputs & computed results */
router.post("/plan/runs", async (req, res): Promise<void> => {
  const { month, note, segment: segmentRaw, effectiveFrom: effectiveFromRaw } = req.body ?? {};

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

  // Read current buffer factors for the snapshot (scoped to segment)
  const bufferRows = await db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, segment));
  const factorsJson: Record<string, number> = {};
  for (const b of bufferRows) factorsJson[b.name] = b.multiplier;

  // Compute plan from uploaded files + Google Sheets in parallel with loading
  // the raw pending rows for the audit snapshot. Both segments source current
  // pending from the GLOBAL DATA.xlsx upload ("pending_orders") — the snapshot
  // must mirror what the plan build actually consumed.
  let planItems: Awaited<ReturnType<typeof buildPlanItems>>;
  let pendingOrderRows: Awaited<ReturnType<typeof loadLatestUploadRowsByKind>>;
  try {
    [planItems, pendingOrderRows] = await Promise.all([
      buildPlanItems(month, segment),
      loadLatestUploadRowsByKind("pending_orders"),
    ]);
  } catch (err) {
    handlePlanError(res, err); // 422 naming the missing/broken upload
    return;
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

  // Create the plan run record. The first run is normalized to the first day
  // when it is finalized; retaining the requested/default date on a draft lets
  // a planner correct it before issuance.
  const [run] = await db
    .insert(planRunsTable)
    .values({ month, segment, effectiveFrom, status: "draft", weeklyReleaseVersion: 1, factorsJson, note: note ?? null })
    .returning();

  const runId = run.id;

  // Insert inputs (one row per item)
  const inputValues = planItems.map((item) => ({
    runId,
    itemCode: item.itemCode,
    colour: item.colour,
    avg3MoSale: item.avg3MoSale,
    stock: item.stock,
    pendingCurrent: item.pendingOrder,
    pendingLastMonth: item.pendingOrderLastMonth,
  }));

  // Insert results (one row per item)
  const resultValues = planItems.map((item) => ({
    runId,
    itemCode: item.itemCode,
    colour: item.colour,
    category: item.category,
    bufferReq: item.bufferReq,
    minProduction: item.minProduction,
    productionPlan: item.maxProduction,
    releaseWeek: item.week,
    w1: item.w1,
    w2: item.w2,
    w3: item.w3,
    w4: item.w4,
  }));

  // Pending audit snapshot: store the raw filtered rows from the DATA.xlsx upload
  // so the exact source data is preserved against this run forever.
  const snapshotValues = pendingOrderRows
    .map((row) => {
      const catNo = String(
        row["Old Item Code"] ?? row["Item Code"] ?? row["Item No."] ?? "",
      ).trim();
      const colour = String(row["Colour"] ?? row["Color"] ?? "").trim();
      const qty =
        typeof row["Balance_Qty"] === "number"
          ? row["Balance_Qty"]
          : typeof row["Qty"] === "number"
            ? row["Qty"]
            : Number(
                String(row["Balance_Qty"] ?? row["Balance Qty"] ?? row["Bal.Qty"] ?? row["Qty"] ?? "0").replace(/,/g, ""),
              ) || 0;
      return { runId, catNo, colour, qty };
    })
    .filter((r) => r.catNo);

  // Batch inserts (500 rows at a time to stay within PG limits)
  const BATCH = 500;
  for (let i = 0; i < inputValues.length; i += BATCH) {
    await db.insert(planRunInputsTable).values(inputValues.slice(i, i + BATCH));
  }
  for (let i = 0; i < resultValues.length; i += BATCH) {
    await db.insert(planRunResultsTable).values(resultValues.slice(i, i + BATCH));
  }
  if (snapshotValues.length > 0) {
    for (let i = 0; i < snapshotValues.length; i += BATCH) {
      await db.insert(pendingSnapshotsTable).values(snapshotValues.slice(i, i + BATCH));
    }
  }

  await savePlanVersionSnapshot({
    month,
    segment,
    kind: "run",
    sourceId: runId,
    effectiveFrom,
    sourceLabel: note ?? `Plan run #${runId}`,
    targets: planItems.map((item) => ({
      itemCode: item.itemCode,
      colour: item.colour,
      category: item.category,
      maxPcs: item.maxProduction,
      minPcs: item.minProduction,
      w1: item.w1 ?? 0,
      w2: item.w2 ?? 0,
      w3: item.w3 ?? 0,
      w4: item.w4 ?? 0,
    })),
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
        .select({ minProduction: planRunResultsTable.minProduction, productionPlan: planRunResultsTable.productionPlan })
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

  const [results, inputs] = await Promise.all([
    db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, id)),
    db.select().from(planRunInputsTable).where(eq(planRunInputsTable.runId, id)),
  ]);

  const inputByKey = new Map(inputs.map((inp) => [`${inp.itemCode}::${inp.colour}`, inp]));

  const items = results.map((r) => {
    const inp = inputByKey.get(`${r.itemCode}::${r.colour}`);
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
      productionPlan: r.productionPlan,
    };
  });

  res.json({ run: makeSummary(run, results), items });
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
  await db.update(planRunsTable).set({ status: "finalized", effectiveFrom }).where(eq(planRunsTable.id, id));
  await setPlanVersionSnapshotEffectiveDate({ kind: "run", sourceId: id, effectiveFrom });
  const results = await db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, id));
  const updated = { ...run, status: "finalized", effectiveFrom };
  res.json(makeSummary(updated, results));
});

export default router;
