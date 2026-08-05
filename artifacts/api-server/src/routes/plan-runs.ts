import { Router, type IRouter } from "express";
import { db, bufferCategoriesTable, planRunsTable, planRunInputsTable, planRunResultsTable, pendingSnapshotsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { buildPlanItems, loadLatestUploadRowsByKind, handlePlanError } from "./plan";
import { summarizePlan } from "../lib/calc";

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
    note: run.note ?? null,
    itemCount: items.length,
    grandMinTotal: Math.round(grandMinTotal),
    grandMaxTotal: Math.round(grandMaxTotal),
    createdAt: run.createdAt,
  };
}

/** POST /api/plan/runs — create a draft run, snapshot all inputs & computed results */
router.post("/plan/runs", async (req, res): Promise<void> => {
  const { month, note, segment: segmentRaw } = req.body ?? {};
  const segment: string = typeof segmentRaw === "string" && segmentRaw ? segmentRaw : "PTMT";
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

  // Create the plan run record
  const [run] = await db
    .insert(planRunsTable)
    .values({ month, segment, status: "draft", factorsJson, note: note ?? null })
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
  const segment = String(req.query.segment ?? "PTMT");

  const runs = await db
    .select()
    .from(planRunsTable)
    .where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, segment)))
    .orderBy(desc(planRunsTable.createdAt));

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

/** DELETE /api/plan/runs/:id — permanently delete a run and all its data */
router.delete("/plan/runs/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) { res.status(400).json({ error: "Invalid id" }); return; }
  const [run] = await db.select().from(planRunsTable).where(eq(planRunsTable.id, id));
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }
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
  await db.update(planRunsTable).set({ status: "finalized" }).where(eq(planRunsTable.id, id));
  const results = await db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, id));
  const updated = { ...run, status: "finalized" };
  res.json(makeSummary(updated, results));
});

export default router;
