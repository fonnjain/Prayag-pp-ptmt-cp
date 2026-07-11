import { Router, type IRouter } from "express";
import { db, itemMasterTable, bufferCategoriesTable, uploadedFilesTable, weeklyReleaseBandsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { computeItemPlan, annotateWeeklyRelease, summarizePlan, type ItemSourceRow, type WeeklyBandConfig } from "../lib/calc";
import {
  fetchAvg3MoSaleTotals,
  fetchLiveOrderTotals,
  itemKey,
  normalizeCode,
  type DualTotals,
} from "../lib/sheets";
import { exportPlanExcel } from "../lib/excel-export";
import { exportPlanPdf } from "../lib/pdf-export";
import { exportWeeklyReleaseExcel } from "../lib/weekly-excel-export";

const router: IRouter = Router();

function sumByKey(
  rows: Record<string, unknown>[],
  codeKeys: string[],
  colourKeys: string[],
  qtyKeys: string[],
): DualTotals {
  const totals: DualTotals = { exact: new Map(), byCode: new Map() };
  for (const row of rows) {
    const code = codeKeys.map((k) => row[k]).find((v) => v !== undefined && v !== null && v !== "");
    const colour = colourKeys.map((k) => row[k]).find((v) => v !== undefined && v !== null && v !== "");
    const rawQty = qtyKeys.map((k) => row[k]).find((v) => v !== undefined && v !== null);
    if (!code) continue;
    const qty = typeof rawQty === "number" ? rawQty : Number(String(rawQty ?? "0").replace(/,/g, "")) || 0;
    const key = itemKey(code, colour);
    const codeKey = normalizeCode(code);
    totals.exact.set(key, (totals.exact.get(key) ?? 0) + qty);
    totals.byCode.set(codeKey, (totals.byCode.get(codeKey) ?? 0) + qty);
  }
  return totals;
}

/**
 * Resolve an item's total from a dual-totals map. When an item's code has more
 * than one item_master row (real colour variants), colour is a meaningful
 * discriminator, so we require an exact code+colour match. When a code has
 * exactly one row, item_master's colour field is often a non-discriminating
 * placeholder ("0", blank, or a stale legacy code) that doesn't line up with
 * the sheet's descriptive colour text, so we sum every row for that code
 * regardless of colour instead of silently returning 0.
 */
function resolveTotal(totals: DualTotals, itemCode: string, colour: string, isSingleVariant: boolean): number {
  if (isSingleVariant) {
    return totals.byCode.get(normalizeCode(itemCode)) ?? 0;
  }
  return totals.exact.get(itemKey(itemCode, colour)) ?? 0;
}

function hasEntry(totals: DualTotals, itemCode: string, colour: string, isSingleVariant: boolean): boolean {
  if (isSingleVariant) {
    return totals.byCode.has(normalizeCode(itemCode));
  }
  return totals.exact.has(itemKey(itemCode, colour));
}

export async function buildPlanItems(month: string) {
  const [itemRows, bufferRows, bandRows, pendingOrderRows, pendingLastMoRows, currentStockRows, avg3MoTotals, liveOrderTotals] =
    await Promise.all([
      db.select().from(itemMasterTable),
      db.select().from(bufferCategoriesTable),
      db.select().from(weeklyReleaseBandsTable),
      // Current pending: uploaded DATA.xlsx → PendingOrder sheet (Segment ∈ {PTMT, PT},
      // Old Item Code + Color, Balance_Qty). Per spec §4: do NOT use the live
      // "Pending order" Google Sheet — it drifts daily and breaks reproducibility.
      loadLatestUploadRowsByKind("pending_orders"),
      // Last-month pending: uploaded LAST_MONTH_PENDING_ORDERS file → PTMT tab.
      loadLatestUploadRowsByKind("last_month_pending"),
      // Current stock: uploaded F.G. STOCK factory Excel → F.G Sheet (col A/B/C).
      loadLatestUploadRowsByKind("current_stock"),
      fetchAvg3MoSaleTotals(month),
      fetchLiveOrderTotals(month),
    ]);

  const bufferByCategory = new Map<string, number>(bufferRows.map((b) => [b.name, b.multiplier]));
  const bandsByCategory = new Map<string, WeeklyBandConfig>(
    bandRows.map((b) => [b.categoryName, { w1Upper: b.w1Upper, w2Upper: b.w2Upper, w3Upper: b.w3Upper, w4Upper: b.w4Upper }]),
  );

  // Pending current: DATA.xlsx PendingOrder tab columns after alias transform:
  //   "Old Item Code" / "Item No." → code; "Colour" / "Color" → colour;
  //   "Balance_Qty" / "Balance Qty" / "Bal.Qty" → qty.
  const pendingOrderTotals = sumByKey(
    pendingOrderRows,
    ["Old Item Code", "Item Code", "Item No."],
    ["Colour", "Color"],
    ["Balance_Qty", "Balance Qty", "Bal.Qty", "Qty"],
  );

  // Last-month pending: PTMT tab columns: "Item Code" / "Cat No" → code; "Colour" / "Color" → colour; "Qty" → qty.
  const pendingLastMoTotals = sumByKey(
    pendingLastMoRows,
    ["Item Code", "Cat No", "Cat-No", "Old Item Code"],
    ["Colour", "Color"],
    ["Qty", "Balance_Qty", "Balance Qty"],
  );

  // Stock: F.G Sheet columns: "Item Code" → code; "Colour" / "Color" → colour; "Qty" (normalized from C/Stock) → qty.
  const stockTotals = sumByKey(currentStockRows, ["Item Code"], ["Colour", "Color"], ["Qty"]);

  // Scoped per category: the same item code can legitimately exist in two
  // different categories (e.g. a code split by colour under one category,
  // and re-listed as a single combined item with a placeholder colour under
  // another). Counting codes globally would wrongly force exact colour
  // matching on the single-variant side and break its byCode aggregation.
  const codeCounts = new Map<string, number>();
  for (const item of itemRows) {
    const codeKey = `${item.category}::${normalizeCode(item.itemCode)}`;
    codeCounts.set(codeKey, (codeCounts.get(codeKey) ?? 0) + 1);
  }

  const items = itemRows.map((item) => {
    const isSingleVariant = (codeCounts.get(`${item.category}::${normalizeCode(item.itemCode)}`) ?? 0) <= 1;
    const source: ItemSourceRow = {
      itemCode: item.itemCode,
      colour: item.colour,
      avg3MoSaleTotal3Mo: resolveTotal(avg3MoTotals, item.itemCode, item.colour, isSingleVariant),
      stock: resolveTotal(stockTotals, item.itemCode, item.colour, isSingleVariant),
      stockNeedsReview:
        currentStockRows.length > 0 && !hasEntry(stockTotals, item.itemCode, item.colour, isSingleVariant),
      pendingOrderLastMonth: resolveTotal(pendingLastMoTotals, item.itemCode, item.colour, isSingleVariant),
      pendingOrder: resolveTotal(pendingOrderTotals, item.itemCode, item.colour, isSingleVariant),
      order: resolveTotal(liveOrderTotals, item.itemCode, item.colour, isSingleVariant),
    };
    const multiplier = bufferByCategory.get(item.category) ?? 1;
    return computeItemPlan(source, item.category, multiplier);
  });

  annotateWeeklyRelease(items, bandsByCategory);
  return items;
}

export async function loadLatestUploadRowsByKind(kind: string): Promise<Record<string, unknown>[]> {
  const [file] = await db
    .select({ rows: uploadedFilesTable.rows })
    .from(uploadedFilesTable)
    .where(eq(uploadedFilesTable.kind, kind))
    .orderBy(desc(uploadedFilesTable.uploadedAt))
    .limit(1);
  return file?.rows ?? [];
}

router.get("/plan", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const category = req.query.category ? String(req.query.category) : undefined;
  const items = await buildPlanItems(month);
  const filtered = category ? items.filter((i) => i.category === category) : items;
  res.json(filtered);
});

router.get("/plan/summary", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const items = await buildPlanItems(month);
  const summary = summarizePlan(items);
  res.json({ month, ...summary });
});

router.get("/plan/export/excel", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const items = await buildPlanItems(month);
  const summary = summarizePlan(items);
  const buffer = await exportPlanExcel(month, items, summary);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="PTMT_Production_Plan_${month}.xlsx"`);
  res.send(buffer);
});

router.get("/plan/export/pdf", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const items = await buildPlanItems(month);
  const summary = summarizePlan(items);
  const buffer = await exportPlanPdf(month, items, summary);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="PTMT_Production_Plan_${month}.pdf"`);
  res.send(buffer);
});

router.get("/plan/export/weekly-excel", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const items = await buildPlanItems(month);
  const buffer = await exportWeeklyReleaseExcel(month, items);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="PTMT_Weekly_Release_Plan_${month}.xlsx"`);
  res.send(buffer);
});

router.get("/plan/weekly-bands", async (_req, res): Promise<void> => {
  const bands = await db.select().from(weeklyReleaseBandsTable);
  res.json(bands);
});

router.put("/plan/weekly-bands/:category", async (req, res): Promise<void> => {
  const category = decodeURIComponent(req.params.category);
  const { w1Upper, w2Upper, w3Upper, w4Upper } = req.body as {
    w1Upper: number;
    w2Upper: number;
    w3Upper: number;
    w4Upper: number;
  };
  if (
    typeof w1Upper !== "number" ||
    typeof w2Upper !== "number" ||
    typeof w3Upper !== "number" ||
    typeof w4Upper !== "number"
  ) {
    res.status(400).json({ error: "w1Upper, w2Upper, w3Upper, w4Upper are required numbers" });
    return;
  }
  if (!(w1Upper < w2Upper && w2Upper < w3Upper && w3Upper < w4Upper)) {
    res.status(400).json({ error: "Band thresholds must be strictly increasing: w1Upper < w2Upper < w3Upper < w4Upper" });
    return;
  }
  const [updated] = await db
    .update(weeklyReleaseBandsTable)
    .set({ w1Upper, w2Upper, w3Upper, w4Upper, updatedAt: new Date() })
    .where(eq(weeklyReleaseBandsTable.categoryName, category))
    .returning();
  if (!updated) {
    res.status(404).json({ error: `No band config found for category: ${category}` });
    return;
  }
  res.json(updated);
});

/**
 * Golden-value validation checks. Returns pass/fail per check with expected vs actual.
 * Fail loudly: each check is independent so all failures are reported, not just the first.
 *
 * Checks:
 *   1. Stock 121-O / WHITE = 1,644
 *   2. Last-month pending total = 137,939
 *   3. Current pending 144-O / WHITE = 132
 *   4. Avg 3-Mo Sale 144-O / WHITE = 5,222
 *   5. Grand Max total ≈ 576,037 (±5 %)
 *   6. Grand Min total ≈ 301,918 (±5 %)
 */
router.get("/plan/validate", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }

  // Fetch everything in one parallel batch — DB reads + both Sheets calls
  // so we only pay the throttle penalty once (they overlap in Promise.all).
  const [
    stockRows,
    pendingRows,
    lastMoRows,
    itemRows,
    bufferRows,
    avg3MoTotals,
    liveOrderTotals,
  ] = await Promise.all([
    loadLatestUploadRowsByKind("current_stock"),
    loadLatestUploadRowsByKind("pending_orders"),
    loadLatestUploadRowsByKind("last_month_pending"),
    db.select().from(itemMasterTable),
    db.select().from(bufferCategoriesTable),
    fetchAvg3MoSaleTotals(month),
    fetchLiveOrderTotals(month),
  ]);

  type CheckResult = {
    name: string;
    expected: number;
    actual: number;
    pass: boolean;
    tolerance?: string;
  };

  const checks: CheckResult[] = [];

  // ── 1. Stock 121-O / WHITE = 1,644 ────────────────────────────────────
  const stockTotals = sumByKey(stockRows, ["Item Code"], ["Colour", "Color"], ["Qty"]);
  const stock121 = resolveTotal(stockTotals, "121-O", "WHITE", false);
  checks.push({ name: "Stock 121-O / WHITE", expected: 1644, actual: stock121, pass: stock121 === 1644 });

  // ── 2. Last-month pending total = 137,939 ─────────────────────────────
  const lmTotals = sumByKey(
    lastMoRows,
    ["Item Code", "Cat No", "Cat-No", "Old Item Code"],
    ["Colour", "Color"],
    ["Qty", "Balance_Qty", "Balance Qty"],
  );
  const lmTotal = Math.round([...lmTotals.byCode.values()].reduce((a, b) => a + b, 0));
  checks.push({ name: "Last-month pending total", expected: 137939, actual: lmTotal, pass: lmTotal === 137939 });

  // ── 3. Current pending 144-O / WHITE = 132 ────────────────────────────
  const pendTotals = sumByKey(
    pendingRows,
    ["Old Item Code", "Item Code", "Item No."],
    ["Colour", "Color"],
    ["Balance_Qty", "Balance Qty", "Bal.Qty", "Qty"],
  );
  const pend144 = resolveTotal(pendTotals, "144-O", "WHITE", false);
  checks.push({ name: "Current pending 144-O / WHITE", expected: 132, actual: pend144, pass: pend144 === 132 });

  // ── 4. Avg 3-Mo Sale 144-O / WHITE = 5,222 ───────────────────────────
  const avg3MoRaw = resolveTotal(avg3MoTotals, "144-O", "WHITE", false);
  const avg3Mo = Math.round(avg3MoRaw / 3);
  checks.push({ name: "Avg 3-Mo Sale 144-O / WHITE", expected: 5222, actual: avg3Mo, pass: avg3Mo === 5222 });

  // ── 5 & 6. Grand totals ≈ Max 576,037 / Min 301,918 (±5 %) ──────────
  // Build plan items directly from already-fetched data — no second Sheets round trip.
  const pendingOrderTotals = sumByKey(
    pendingRows,
    ["Old Item Code", "Item Code", "Item No."],
    ["Colour", "Color"],
    ["Balance_Qty", "Balance Qty", "Bal.Qty", "Qty"],
  );
  const pendingLastMoTotals = sumByKey(
    lastMoRows,
    ["Item Code", "Cat No", "Cat-No", "Old Item Code"],
    ["Colour", "Color"],
    ["Qty", "Balance_Qty", "Balance Qty"],
  );
  const bufferByCategory = new Map<string, number>(bufferRows.map((b) => [b.name, b.multiplier]));
  const codeCounts = new Map<string, number>();
  for (const item of itemRows) {
    const codeKey = `${item.category}::${normalizeCode(item.itemCode)}`;
    codeCounts.set(codeKey, (codeCounts.get(codeKey) ?? 0) + 1);
  }
  const currentStockRows = await loadLatestUploadRowsByKind("current_stock");
  const stockTotalsForPlan = sumByKey(currentStockRows, ["Item Code"], ["Colour", "Color"], ["Qty"]);
  const planItems = itemRows.map((item) => {
    const isSingleVariant = (codeCounts.get(`${item.category}::${normalizeCode(item.itemCode)}`) ?? 0) <= 1;
    return computeItemPlan(
      {
        itemCode: item.itemCode,
        colour: item.colour,
        avg3MoSaleTotal3Mo: resolveTotal(avg3MoTotals, item.itemCode, item.colour, isSingleVariant),
        stock: resolveTotal(stockTotalsForPlan, item.itemCode, item.colour, isSingleVariant),
        stockNeedsReview:
          currentStockRows.length > 0 && !hasEntry(stockTotalsForPlan, item.itemCode, item.colour, isSingleVariant),
        pendingOrderLastMonth: resolveTotal(pendingLastMoTotals, item.itemCode, item.colour, isSingleVariant),
        pendingOrder: resolveTotal(pendingOrderTotals, item.itemCode, item.colour, isSingleVariant),
        order: resolveTotal(liveOrderTotals, item.itemCode, item.colour, isSingleVariant),
      },
      item.category,
      bufferByCategory.get(item.category) ?? 1,
    );
  });
  const summary = summarizePlan(planItems);
  const maxPct = Math.abs(summary.grandMaxTotal - 576037) / 576037;
  const minPct = Math.abs(summary.grandMinTotal - 301918) / 301918;
  checks.push({
    name: "Grand Max total ≈ 576,037",
    expected: 576037,
    actual: summary.grandMaxTotal,
    pass: maxPct <= 0.05,
    tolerance: "±5%",
  });
  checks.push({
    name: "Grand Min total ≈ 301,918",
    expected: 301918,
    actual: summary.grandMinTotal,
    pass: minPct <= 0.05,
    tolerance: "±5%",
  });

  const allPass = checks.every((c) => c.pass);
  const failCount = checks.filter((c) => !c.pass).length;

  res.json({ month, allPass, passCount: checks.length - failCount, failCount, checks });
});

export default router;
