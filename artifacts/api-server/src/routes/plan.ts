import { Router, type IRouter } from "express";
import { db, itemMasterTable, bufferCategoriesTable, uploadedFilesTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { computeItemPlan, summarizePlan, type ItemSourceRow } from "../lib/calc";
import {
  fetchAvg3MoSaleTotals,
  fetchLiveOrderTotals,
  itemKey,
  normalizeCode,
  type DualTotals,
} from "../lib/sheets";
import { exportPlanExcel } from "../lib/excel-export";
import { exportPlanPdf } from "../lib/pdf-export";

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
  const [itemRows, bufferRows, pendingOrderRows, pendingLastMoRows, currentStockRows, avg3MoTotals, liveOrderTotals] =
    await Promise.all([
      db.select().from(itemMasterTable),
      db.select().from(bufferCategoriesTable),
      loadLatestUploadRowsByKind("pending_orders"),
      loadLatestUploadRowsByKind("last_month_pending"),
      loadLatestUploadRowsByKind("current_stock"),
      fetchAvg3MoSaleTotals(month),
      fetchLiveOrderTotals(month),
    ]);

  const bufferByCategory = new Map<string, number>(bufferRows.map((b) => [b.name, b.multiplier]));
  const pendingOrderTotals = sumByKey(
    pendingOrderRows,
    ["Old Item Code", "Item No."],
    ["Color", "Colour"],
    ["Balance_Qty"],
  );
  const pendingLastMoTotals = sumByKey(pendingLastMoRows, ["Item Code"], ["Colour", "Color"], ["Qty"]);
  const stockTotals = sumByKey(currentStockRows, ["Item Code"], ["Colour", "Color"], ["Qty"]);

  const codeCounts = new Map<string, number>();
  for (const item of itemRows) {
    const codeKey = normalizeCode(item.itemCode);
    codeCounts.set(codeKey, (codeCounts.get(codeKey) ?? 0) + 1);
  }

  const items = itemRows.map((item) => {
    const isSingleVariant = (codeCounts.get(normalizeCode(item.itemCode)) ?? 0) <= 1;
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

  return items;
}

async function loadLatestUploadRowsByKind(kind: string): Promise<Record<string, unknown>[]> {
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

export default router;
