import { Router, type IRouter } from "express";
import { db, itemMasterTable, bufferCategoriesTable, uploadedFilesTable, weeklyReleaseBandsTable, plumbingMachineCapacityTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { computeItemPlan, annotateWeeklyRelease, summarizePlan, type ItemSourceRow, type WeeklyBandConfig } from "../lib/calc";
import {
  fetchAvg3MoSaleTotals,
  fetchLiveOrderTotals,
  fetchPlumbingBomWeights,
  fetchPlumbingPlanData,
  fetchPlumbingSheet3Production,
  itemKey,
  normalizeCode,
  normalizeCodeStrict,
  type DualTotals,
  type PlumbingSheet3Row,
} from "../lib/sheets";
import { exportPlanExcel } from "../lib/excel-export";
import { exportPlanPdf } from "../lib/pdf-export";
import { exportWeeklyReleaseExcel } from "../lib/weekly-excel-export";
import { runMachineCascade, type PlanItemForCascade } from "../lib/machine-capacity-engine";
import {
  PLUMBING_GOLDEN,
  PLUMBING_GOLDEN_TOLERANCE,
  PLUMBING_BUFFER_DEFAULTS,
  SOLVENT_MEMBERSHIP,
  PLUMBING_KG_GOLDEN,
  PLUMBING_KG_TOLERANCE,
  PLUMBING_KG_GRAND_TOTAL,
  PLUMBING_WEEKLY_GOLDEN,
  PLUMBING_WEEKLY_TOLERANCE,
  PLUMBING_WEEKLY_PLANT,
  PLUMBING_REPLAN_GOLDEN,
  PLUMBING_REPLAN_TOLERANCE,
  PLUMBING_REPLAN_CAP_TOLERANCE,
  PLUMBING_REPLAN_WORKING_DAYS_REMAINING,
  PLUMBING_REPLAN_TOTAL_PRODUCED,
  PLUMBING_REPLAN_TOTAL_REMAINING,
  PLUMBING_REPLAN_TOTAL_FEASIBLE,
  PLUMBING_REPLAN_TOTAL_SHORTFALL,
  PLUMBING_REPLAN_UNPLANNED_TOTAL,
  PTMT_GRAND_MAX,
  PTMT_GRAND_MIN,
  PTMT_TOLERANCE,
  PTMT_CATEGORY_GOLDEN,
  PTMT_MULTIPLIER_GOLDEN,
  PLUMBING_MON_W1_MAPPED,
  PLUMBING_MON_W2_MAPPED,
  PLUMBING_MON_W1_UNMAPPED,
  PLUMBING_MON_W2_UNMAPPED,
  PLUMBING_MON_CAT_W1,
  PLUMBING_MON_CAT_W2,
  PLUMBING_MON_TOLERANCE,
} from "../lib/plumbing-golden";

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

/**
 * Plan item augmented with Plumbing BOM weight fields and machine-cascade output.
 * weightKg/noBomWeight and machine* fields are present for Plumbing items only.
 *   weightKg    = maxProduction × weight_per_pcs (from BOM sheet); 0 when no BOM entry.
 *   noBomWeight = true when item has no BOM weight entry (must be flagged, never silently dropped).
 *   machineW1..W4      = machine-feasible release quantities (re-timed from cover-band desired).
 *   assignedMachineId  = machine the item was scheduled on (null = unconstrained).
 *   machineWeek        = week the machine cascade assigned this item to (null = unfulfillable).
 *   machineUnfulfillable = true when item could not fit in any week's machine capacity.
 * PTMT items do not carry these fields (undefined).
 */
export type PlanItemWithBom = ReturnType<typeof computeItemPlan> & {
  weightKg?: number;
  noBomWeight?: boolean;
  machineW1?: number;
  machineW2?: number;
  machineW3?: number;
  machineW4?: number;
  assignedMachineId?: string | null;
  machineWeek?: 1 | 2 | 3 | 4 | null;
  machineUnfulfillable?: boolean;
};

/**
 * Plumbing plan — correct two-source architecture:
 *
 *   Stock, Pending-Last-Month  → plumbing_fg_stock UPLOAD (required)
 *     Net Stock col: POSITIVE = opening stock on 1st of month
 *                    NEGATIVE = |value| = pending order last month
 *
 *   Avg-3-Mo Sale, Pending Order, item TYPE → daily-production workbook
 *     All columns located by header name (never by position).
 *
 *   Live open orders  → Order Sheet 26-27
 *   BOM weight (KGs)  → BOM sheet
 *
 *   Buffer Req (per item) = Avg3Mo × multiplier (CPVC 1.5, UPVC 1.5, AGRI 1.5, SWR 1.0)
 *
 *   ONE formula for ALL 12 Plumbing categories (CPVC / UPVC / SWR / AGRI):
 *     Production Required = max( (Buffer − Stock) + PendingLM + Pending , 0 )
 *   Category total = sum of per-item values.
 *
 *   AGRI note: Stock ("STOCK AS ON <date>") and Buffer ("BUFFER STOCK REQ FOR <month>")
 *   are located by their header names, not by column position.  The AGRI tab's own cell
 *   formula transposes these two columns, so our header-name mapping intentionally produces
 *   different (correct) planning values vs the source sheet figures.
 * The workbook's Stock/PendingLM columns are NOT used — FG Stock upload is authoritative.
 */
async function buildPlumbingPlanItemsFromWorkbook(month: string): Promise<PlanItemWithBom[]> {
  const [workbookRows, fgStockRows, bufferRows, bandRows, liveOrderTotals, bomWeights, machineRows] = await Promise.all([
    fetchPlumbingPlanData(month),
    loadLatestUploadRowsByKind("plumbing_fg_stock"),
    db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, "Plumbing")),
    db.select().from(weeklyReleaseBandsTable).where(eq(weeklyReleaseBandsTable.segment, "Plumbing")),
    fetchLiveOrderTotals(month, "PLUMBING"),
    fetchPlumbingBomWeights(),
    db.select().from(plumbingMachineCapacityTable).where(eq(plumbingMachineCapacityTable.segment, "Plumbing")),
  ]);

  // Parse FG Stock upload (authoritative source for Stock and Pending-Last-Month).
  //   Net Stock positive  → opening stock on 1st of month
  //   Net Stock negative  → |value| = pending order last month (stock = 0)
  // Item type is NO LONGER resolved from FG Stock Category — it comes directly from
  // the workbook's per-row type column (PIPE / FITTING / FITTINGS / SOLVENT).
  const stockMap     = new Map<string, number>();
  const pendingLmMap = new Map<string, number>();

  for (const row of fgStockRows) {
    const code = normalizeCode(String(row["Item Code"] ?? "").trim());
    if (!code) continue;

    const rawNet = row["Net Stock"];
    const netStock = typeof rawNet === "number" ? rawNet : Number(String(rawNet ?? "").replace(/,/g, "")) || 0;
    if (netStock > 0) {
      stockMap.set(code, (stockMap.get(code) ?? 0) + netStock);
    } else if (netStock < 0) {
      pendingLmMap.set(code, (pendingLmMap.get(code) ?? 0) + Math.abs(netStock));
    }
  }

  // Two maps for the three-tier multiplier priority:
  //   1. overrideMultiplier (user-set in UI)  — always wins
  //   2. row.sheetMultiplier (per-item cell)  — default source
  //   3. bufferRow.multiplier (DB default)    — fallback when sheet cell is blank
  const bufferOverrideMap = new Map<string, number | null>(
    bufferRows.map((b) => [b.name, b.overrideMultiplier]),
  );
  const bufferDefaultMap = new Map<string, number>(
    bufferRows.map((b) => [b.name, b.multiplier]),
  );
  const bandsByCategory = new Map<string, WeeklyBandConfig>(
    bandRows.map((b) => [b.categoryName, { w1Upper: b.w1Upper, w2Upper: b.w2Upper, w3Upper: b.w3Upper, w4Upper: b.w4Upper }]),
  );

  // Type comes directly from the workbook per-row type column.
  // Rows without a type tag (~3 per tab) are dropped.
  const items: PlanItemWithBom[] = workbookRows
    .map((row): PlanItemWithBom | null => {
      const code = normalizeCode(row.itemCode);

      // row.type is set by fetchPlumbingPlanData from the type column on each row.
      const resolvedType = row.type;
      if (!resolvedType) return null; // ~3 rows per tab lack a type tag — drop
      const resolvedCategory = `${row.material} ${resolvedType}`;

      const source: ItemSourceRow = {
        itemCode: row.itemCode,
        colour: "",
        // calc.ts computes avg3MoSale = avg3MoSaleTotal3Mo / 3.
        // The workbook column "LAST 3 MONTH AVG SALE" is already the monthly average,
        // so multiply by 3 here so that /3 in calc.ts recovers the correct figure.
        avg3MoSaleTotal3Mo:    row.avg3MoSale * 3,
        // Stock and pendingLM come from the FG Stock UPLOAD — NOT from the workbook.
        stock:                 stockMap.get(code) ?? 0,
        stockNeedsReview:      false,
        pendingOrderLastMonth: pendingLmMap.get(code) ?? 0,
        // Pending order (current month) from workbook; live open order from Order Sheet.
        pendingOrder:          row.pendingOrder,
        order:                 liveOrderTotals.byCode.get(code) ?? 0,
      };

      // Three-tier multiplier priority:
      //   1. User override (set in UI) — always wins, ignores sheet
      //   2. Per-item sheet value — the sheet's own multiplier cell per row
      //   3. DB default (AI-suggested or seed) — fallback for blank sheet cells
      const override = bufferOverrideMap.get(resolvedCategory) ?? null;
      const multiplier = override !== null
        ? override
        : (row.sheetMultiplier ?? bufferDefaultMap.get(resolvedCategory) ?? 1);

      // One formula for all 12 Plumbing categories: max((Buffer − Stock) + PendingLM + Pending, 0).
      // AGRI: columns located by header name — the AGRI tab's own cell formula transposes Stock
      // and Buffer, so our header-name mapping intentionally differs from the source sheet figures.
      const computed = computeItemPlan(source, resolvedCategory, multiplier);

      // BOM weight — ~3% of items may have no BOM entry; flag them, never drop or guess.
      const weightPcs = bomWeights.get(code);
      const noBomWeight = weightPcs === undefined;
      const weightKg = noBomWeight ? 0 : Math.round(computed.maxProduction * weightPcs! * 100) / 100;
      return { ...computed, weightKg, noBomWeight };
    })
    .filter((item): item is PlanItemWithBom => item !== null);

  annotateWeeklyRelease(items, bandsByCategory);

  if (machineRows.length > 0) {
    runMachineCascade(items as unknown as PlanItemForCascade[], machineRows, month);
  }

  return items;
}

/**
 * Build plan items for a given month and segment.
 * For Plumbing, delegates to buildPlumbingPlanItemsFromWorkbook which reads all inputs
 * (avg sale, stock, pending, pending-LM) from the workbook by header-name mapping.
 * segment defaults to "PTMT".
 */
export async function buildPlanItems(month: string, segment: string = "PTMT"): Promise<PlanItemWithBom[]> {
  // Plumbing: all inputs come from the daily-production workbook — no item_master or uploads.
  if (segment === "Plumbing") {
    return buildPlumbingPlanItemsFromWorkbook(month);
  }

  // ── PTMT data loads (all parallel) ──────────────────────────────────────────
  const [itemRows, bufferRows, bandRows, rawPendingOrderRows, avg3MoTotals, liveOrderTotals, currentStockRows, pendingLastMoRows] =
    await Promise.all([
      db.select().from(itemMasterTable).where(eq(itemMasterTable.segment, segment)),
      db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, segment)),
      db.select().from(weeklyReleaseBandsTable).where(eq(weeklyReleaseBandsTable.segment, segment)),
      // DATA.xlsx (pending_orders) — global upload; rows for all segments stored, filtered below.
      loadLatestUploadRowsByKind("pending_orders"),
      fetchAvg3MoSaleTotals(month),
      fetchLiveOrderTotals(month, "PTMT"),
      loadLatestUploadRowsByKind("current_stock"),
      loadLatestUploadRowsByKind("last_month_pending"),
    ]);

  // DATA.xlsx stores rows for all segments; keep only PTMT rows.
  const pendingOrderRows = rawPendingOrderRows.filter((row) => {
    const seg = String(row["Segment"] ?? "").trim().toUpperCase();
    return seg === "PTMT" || seg === "PT";
  });

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

  // Stock: F.G Sheet — try every item-code column variant the FG Stock upload may carry.
  const stockTotals = sumByKey(
    currentStockRows,
    ["Item Code", "Old Item Code", "Cat No", "Cat-No", "Item No."],
    ["Colour", "Color"],
    ["Qty"],
  );

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

  const items: PlanItemWithBom[] = itemRows.map((item) => {
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
    // One formula for all PTMT categories: max(BufferReq − Stock + PendingLM + Pending, 0).
    const computed = computeItemPlan(source, item.category, multiplier);
    return computed;
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
  const segment = String(req.query.segment ?? "PTMT");
  const category = req.query.category ? String(req.query.category) : undefined;
  const items = await buildPlanItems(month, segment);
  const filtered = category ? items.filter((i) => i.category === category) : items;
  res.json(filtered);
});

// All 12 Plumbing category tabs that must always appear in the export,
// even when an individual category has zero items (e.g. AGRI Solvent = 0, SWR Solvent tab).
const PLUMBING_CATEGORIES = [
  "CPVC Pipe", "CPVC Fitting", "CPVC Solvent",
  "UPVC Pipe", "UPVC Fitting", "UPVC Solvent",
  "SWR Pipe",  "SWR Fitting",  "SWR Solvent",
  "AGRI Pipe", "AGRI Fitting", "AGRI Solvent",
];

router.get("/plan/export/excel", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const segment = String(req.query.segment ?? "PTMT");
  const items = await buildPlanItems(month, segment);
  const summary = summarizePlan(items);
  const requiredCategories = segment === "Plumbing" ? PLUMBING_CATEGORIES : undefined;
  const buffer = await exportPlanExcel(month, items, summary, requiredCategories);
  const prefix = segment === "Plumbing" ? "Plumbing" : "PTMT";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${prefix}_Production_Plan_${month}.xlsx"`);
  res.send(buffer);
});

router.get("/plan/export/pdf", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const segment = String(req.query.segment ?? "PTMT");
  const items = await buildPlanItems(month, segment);
  const summary = summarizePlan(items);
  const buffer = await exportPlanPdf(month, items, summary);
  const prefix = segment === "Plumbing" ? "Plumbing" : "PTMT";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${prefix}_Production_Plan_${month}.pdf"`);
  res.send(buffer);
});

router.get("/plan/export/weekly-excel", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const segment = String(req.query.segment ?? "PTMT");
  const items = await buildPlanItems(month, segment);
  const buffer = await exportWeeklyReleaseExcel(month, items);
  const prefix = segment === "Plumbing" ? "Plumbing" : "PTMT";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${prefix}_Weekly_Release_Plan_${month}.xlsx"`);
  res.send(buffer);
});

/**
 * BOM data-quality report for Plumbing: lists items whose maxProduction > 0
 * but have no BOM weight entry. These must be flagged (shown as 0 kg) and
 * never silently dropped. Spec: ~3% of planned pieces lack BOM weight.
 */
router.get("/plan/bom-quality", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) { res.status(400).json({ error: "month is required" }); return; }
  const segment = String(req.query.segment ?? "Plumbing");
  const items = await buildPlanItems(month, segment);
  const missing = items.filter((i) => i.noBomWeight && (i.maxProduction ?? 0) > 0);
  const missingPcs = missing.reduce((s, i) => s + (i.maxProduction ?? 0), 0);
  const totalPcs = items.reduce((s, i) => s + (i.maxProduction ?? 0), 0);
  const missingPct = totalPcs > 0 ? Math.round(missingPcs / totalPcs * 10000) / 100 : 0;
  res.json({
    segment,
    month,
    totalItems: items.length,
    missingBomItems: missing.map((i) => ({
      itemCode: i.itemCode,
      colour: i.colour,
      category: i.category,
      pcs: i.maxProduction,
    })),
    missingPcs: Math.round(missingPcs),
    totalPcs: Math.round(totalPcs),
    missingPct,
  });
});

router.get("/plan/weekly-bands", async (req, res): Promise<void> => {
  const segment = req.query.segment ? String(req.query.segment) : undefined;
  const bands = segment
    ? await db.select().from(weeklyReleaseBandsTable).where(eq(weeklyReleaseBandsTable.segment, segment))
    : await db.select().from(weeklyReleaseBandsTable);
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

// ── Corrective re-plan types ──────────────────────────────────────────────────

interface ReplanCategoryResult {
  category: string;
  plan: number;
  produced: number;
  producedCapped: number;
  remaining: number;
  capPerDay: number;
  feasible: number;
  shortfall: number;
  flags: string[];
}

interface CorrectiveReplanResult {
  month: string;
  workingDaysRemaining: number;
  categories: ReplanCategoryResult[];
  unplannedProduction: Array<{ code: string; qty: number }>;
  totalProduced: number;
  totalProducedCapped: number;
  totalRemaining: number;
  totalFeasible: number;
  totalShortfall: number;
  unplannedTotal: number;
}

/**
 * Core corrective re-plan computation.
 *
 * For each plan item: matches produced quantity from Sheet3 via normalizeCodeStrict
 * (strips hyphens/spaces/dots so "A465" ↔ "A-465" match).
 *
 * Per-category output:
 *   produced      = sum of actual Sheet3 qty for plan item codes in this category
 *   producedCapped = sum of min(produced_for_item, plan_item) — used for reconciliation
 *   remaining     = sum of max(plan_item − produced_for_item, 0)  [no cross-item netting]
 *   capPerDay     = p90 of daily category totals (only days with recorded production)
 *                   using index floor(n × 0.9)
 *   feasible      = capPerDay × workingDaysRemaining
 *   shortfall     = max(remaining − feasible, 0)
 *
 * Structural invariant always true: producedCapped + remaining == plan (by construction).
 */
function computeCorrectiveReplan(
  planItems: PlanItemWithBom[],
  sheet3Rows: PlumbingSheet3Row[],
  month: string,
  workingDaysRemaining: number,
): CorrectiveReplanResult {
  // Build code → category map (keyed on normalizeCodeStrict)
  const normCodeToCategory = new Map<string, string>();
  for (const item of planItems) {
    normCodeToCategory.set(normalizeCodeStrict(item.itemCode), item.category);
  }

  // Process Sheet3 rows: accumulate produced per code and daily totals per category
  const producedByNormCode = new Map<string, number>();
  // Map<category, Map<dateStr, dailyQty>>
  const dailyByCat = new Map<string, Map<string, number>>();
  const unplannedByCode = new Map<string, number>();

  for (const row of sheet3Rows) {
    if (row.qty <= 0) continue;
    const category = normCodeToCategory.get(row.normCode);
    if (category) {
      producedByNormCode.set(row.normCode, (producedByNormCode.get(row.normCode) ?? 0) + row.qty);
      let dayMap = dailyByCat.get(category);
      if (!dayMap) { dayMap = new Map(); dailyByCat.set(category, dayMap); }
      dayMap.set(row.dateStr, (dayMap.get(row.dateStr) ?? 0) + row.qty);
    } else {
      unplannedByCode.set(row.rawCode, (unplannedByCode.get(row.rawCode) ?? 0) + row.qty);
    }
  }

  // Per-category computation
  const allCategories = [...new Set(planItems.map((i) => i.category))].sort();
  const planByCategory = new Map<string, number>();
  const itemsByCategory = new Map<string, PlanItemWithBom[]>();
  for (const item of planItems) {
    planByCategory.set(item.category, (planByCategory.get(item.category) ?? 0) + item.maxProduction);
    const arr = itemsByCategory.get(item.category) ?? [];
    arr.push(item);
    itemsByCategory.set(item.category, arr);
  }

  const categories: ReplanCategoryResult[] = allCategories.map((category) => {
    const categoryItems = itemsByCategory.get(category) ?? [];
    // Round planTotal so the structural invariant producedCapped + remaining = plan holds
    // exactly even when individual item.maxProduction values are non-integer floats.
    const planTotal = Math.round(planByCategory.get(category) ?? 0);

    let produced = 0;
    let rawProducedCapped = 0;

    for (const item of categoryItems) {
      const itemProduced = producedByNormCode.get(normalizeCodeStrict(item.itemCode)) ?? 0;
      produced += itemProduced;
      rawProducedCapped += Math.min(itemProduced, item.maxProduction);
    }
    produced = Math.round(produced);
    const producedCapped = Math.round(rawProducedCapped);
    // Derive remaining from planTotal and producedCapped to guarantee the invariant
    // producedCapped + remaining === plan (exact) — no independent rounding drift.
    const remaining = planTotal - producedCapped;

    // p90 of daily totals for this category (only days with production)
    const dayMap = dailyByCat.get(category);
    const dailyValues = dayMap ? [...dayMap.values()].sort((a, b) => a - b) : [];
    const capPerDay = dailyValues.length > 0
      ? Math.round(dailyValues[Math.floor(dailyValues.length * 0.9)]!)
      : 0;

    const feasible = capPerDay * workingDaysRemaining;
    const shortfall = Math.max(remaining - feasible, 0);

    const flags: string[] = [];
    if (shortfall > 0) flags.push("UNFULFILLABLE_THIS_MONTH");
    if (produced === 0 && planTotal > 0) flags.push("NOT_STARTED");
    if (capPerDay === 0 && planTotal > 0) flags.push("NO_DEMONSTRATED_CAPACITY");

    return { category, plan: planTotal, produced, producedCapped, remaining, capPerDay, feasible, shortfall, flags };
  });

  // Unplanned production: codes in Sheet3 not present in any plan item
  const unplannedProduction = [...unplannedByCode.entries()]
    .map(([code, qty]) => ({ code, qty: Math.round(qty) }))
    .sort((a, b) => b.qty - a.qty);

  let totalProduced = 0, totalProducedCapped = 0, totalRemaining = 0, totalFeasible = 0, totalShortfall = 0;
  for (const cat of categories) {
    totalProduced += cat.produced;
    totalProducedCapped += cat.producedCapped;
    totalRemaining += cat.remaining;
    totalFeasible += cat.feasible;
    totalShortfall += cat.shortfall;
  }
  const unplannedTotal = unplannedProduction.reduce((s, u) => s + u.qty, 0);

  return {
    month,
    workingDaysRemaining,
    categories,
    unplannedProduction,
    totalProduced,
    totalProducedCapped,
    totalRemaining,
    totalFeasible,
    totalShortfall,
    unplannedTotal,
  };
}

/**
 * Corrective re-plan for Plumbing: reads production-to-date from Sheet3 and
 * computes per-category produced / remaining / capacity / shortfall.
 *
 * Query params:
 *   month                — planning month YYYY-MM (required)
 *   workingDaysRemaining — integer, days left to produce (required)
 */
router.get("/plan/corrective-replan", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) { res.status(400).json({ error: "month is required" }); return; }
  const wdr = parseInt(String(req.query.workingDaysRemaining ?? ""), 10);
  if (isNaN(wdr) || wdr < 0) {
    res.status(400).json({ error: "workingDaysRemaining must be a non-negative integer" });
    return;
  }

  const [planItems, sheet3Rows] = await Promise.all([
    buildPlanItems(month, "Plumbing") as Promise<PlanItemWithBom[]>,
    fetchPlumbingSheet3Production(month),
  ]);

  const result = computeCorrectiveReplan(planItems, sheet3Rows, month, wdr);
  res.json(result);
});

/**
 * Structural + golden-value self-check for the Plumbing corrective re-plan.
 *
 * Structural invariants (always true):
 *   producedCapped + remaining = plan  (per category)
 *   feasible = capPerDay × workingDaysRemaining  (per category)
 *   shortfall = max(remaining − feasible, 0)  (per category)
 *
 * Point-in-time golden checks (±1% produced/remaining/shortfall, ±5% cap/day/feasible):
 *   Values match the 14-Jul-2026 snapshot (12 working days used, 15 remaining).
 *   These will drift as more production is recorded to Sheet3.
 *
 * Query params:
 *   month                — planning month YYYY-MM (required)
 *   workingDaysRemaining — default 15 (matches golden snapshot)
 */
router.get("/plan/validate-replan", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) { res.status(400).json({ error: "month is required" }); return; }
  const wdr = parseInt(String(req.query.workingDaysRemaining ?? `${PLUMBING_REPLAN_WORKING_DAYS_REMAINING}`), 10);

  type CheckResult = {
    name: string;
    expected: number;
    actual: number;
    pass: boolean;
    tolerance?: string;
  };

  const [planItems, sheet3Rows] = await Promise.all([
    buildPlanItems(month, "Plumbing") as Promise<PlanItemWithBom[]>,
    fetchPlumbingSheet3Production(month),
  ]);

  const replan = computeCorrectiveReplan(planItems, sheet3Rows, month, wdr);
  const catMap = new Map(replan.categories.map((c) => [c.category, c]));
  const checks: CheckResult[] = [];

  // ── Guard ────────────────────────────────────────────────────────────────────
  checks.push({
    name: "ReplanGuard · Sheet3 rows loaded > 0",
    expected: 1,
    actual: sheet3Rows.length,
    pass: sheet3Rows.length > 0,
    tolerance: "> 0",
  });
  checks.push({
    name: "ReplanGuard · Total produced > 0",
    expected: 1,
    actual: replan.totalProduced,
    pass: replan.totalProduced > 0,
    tolerance: "> 0",
  });

  // ── Structural invariants (always true) ──────────────────────────────────────
  for (const { cat } of PLUMBING_REPLAN_GOLDEN) {
    const c = catMap.get(cat);
    if (!c) {
      checks.push({ name: `ReplanInv · ${cat} · category present`, expected: 1, actual: 0, pass: false });
      continue;
    }

    // producedCapped + remaining = plan (exact)
    const invSum = c.producedCapped + c.remaining;
    checks.push({
      name: `ReplanInv · ${cat} · producedCapped + remaining = plan`,
      expected: c.plan,
      actual: invSum,
      pass: invSum === c.plan,
      tolerance: "exact",
    });

    // feasible = capPerDay × workingDaysRemaining (exact)
    const invFeasible = c.capPerDay * wdr;
    checks.push({
      name: `ReplanInv · ${cat} · feasible = capPerDay × days`,
      expected: invFeasible,
      actual: c.feasible,
      pass: c.feasible === invFeasible,
      tolerance: "exact",
    });

    // shortfall = max(remaining − feasible, 0) (exact)
    const invShortfall = Math.max(c.remaining - c.feasible, 0);
    checks.push({
      name: `ReplanInv · ${cat} · shortfall = max(remaining − feasible, 0)`,
      expected: invShortfall,
      actual: c.shortfall,
      pass: c.shortfall === invShortfall,
      tolerance: "exact",
    });
  }

  // ── Point-in-time golden checks ───────────────────────────────────────────────
  const pct    = (a: number, e: number) => (e === 0 ? (a === 0 ? 0 : Infinity) : Math.abs(a - e) / e);
  const tolStr = (t: number) => `±${(t * 100).toFixed(0)}%`;

  for (const g of PLUMBING_REPLAN_GOLDEN) {
    const c = catMap.get(g.cat);
    const ap  = Math.round(c?.produced    ?? 0);
    const ar  = Math.round(c?.remaining   ?? 0);
    const acp = Math.round(c?.capPerDay   ?? 0);
    const af  = Math.round(c?.feasible    ?? 0);
    const ash = Math.round(c?.shortfall   ?? 0);

    checks.push({ name: `Replan · ${g.cat} · produced`,  expected: g.produced,  actual: ap,  pass: pct(ap,  g.produced)  <= PLUMBING_REPLAN_TOLERANCE,     tolerance: tolStr(PLUMBING_REPLAN_TOLERANCE) });
    checks.push({ name: `Replan · ${g.cat} · remaining`, expected: g.remaining, actual: ar,  pass: pct(ar,  g.remaining) <= PLUMBING_REPLAN_TOLERANCE,     tolerance: tolStr(PLUMBING_REPLAN_TOLERANCE) });
    checks.push({ name: `Replan · ${g.cat} · cap/day`,   expected: g.capPerDay, actual: acp, pass: pct(acp, g.capPerDay) <= PLUMBING_REPLAN_CAP_TOLERANCE, tolerance: tolStr(PLUMBING_REPLAN_CAP_TOLERANCE) });
    checks.push({ name: `Replan · ${g.cat} · feasible`,  expected: g.feasible,  actual: af,  pass: pct(af,  g.feasible)  <= PLUMBING_REPLAN_CAP_TOLERANCE, tolerance: tolStr(PLUMBING_REPLAN_CAP_TOLERANCE) });
    checks.push({ name: `Replan · ${g.cat} · shortfall`, expected: g.shortfall, actual: ash, pass: pct(ash, g.shortfall) <= PLUMBING_REPLAN_TOLERANCE,     tolerance: tolStr(PLUMBING_REPLAN_TOLERANCE) });
  }

  // ── Totals ────────────────────────────────────────────────────────────────────
  const atp  = replan.totalProduced;
  const atr  = replan.totalRemaining;
  const atf  = replan.totalFeasible;
  const ats  = replan.totalShortfall;
  const atu  = replan.unplannedTotal;

  checks.push({ name: "Replan · Total produced",   expected: PLUMBING_REPLAN_TOTAL_PRODUCED,  actual: atp, pass: pct(atp, PLUMBING_REPLAN_TOTAL_PRODUCED)  <= PLUMBING_REPLAN_TOLERANCE,     tolerance: tolStr(PLUMBING_REPLAN_TOLERANCE) });
  checks.push({ name: "Replan · Total remaining",  expected: PLUMBING_REPLAN_TOTAL_REMAINING, actual: atr, pass: pct(atr, PLUMBING_REPLAN_TOTAL_REMAINING) <= PLUMBING_REPLAN_TOLERANCE,     tolerance: tolStr(PLUMBING_REPLAN_TOLERANCE) });
  checks.push({ name: "Replan · Total feasible",   expected: PLUMBING_REPLAN_TOTAL_FEASIBLE,  actual: atf, pass: pct(atf, PLUMBING_REPLAN_TOTAL_FEASIBLE)  <= PLUMBING_REPLAN_CAP_TOLERANCE, tolerance: tolStr(PLUMBING_REPLAN_CAP_TOLERANCE) });
  checks.push({ name: "Replan · Total shortfall",  expected: PLUMBING_REPLAN_TOTAL_SHORTFALL, actual: ats, pass: pct(ats, PLUMBING_REPLAN_TOTAL_SHORTFALL) <= PLUMBING_REPLAN_TOLERANCE,     tolerance: tolStr(PLUMBING_REPLAN_TOLERANCE) });
  checks.push({ name: "Replan · Unplanned total",  expected: PLUMBING_REPLAN_UNPLANNED_TOTAL, actual: atu, pass: pct(atu, PLUMBING_REPLAN_UNPLANNED_TOTAL) <= PLUMBING_REPLAN_TOLERANCE,     tolerance: tolStr(PLUMBING_REPLAN_TOLERANCE) });

  const allPass = checks.every((c) => c.pass);
  const failCount = checks.filter((c) => !c.pass).length;
  res.json({ month, segment: "Plumbing", workingDaysRemaining: wdr, allPass, passCount: checks.length - failCount, failCount, checks });
});

/**
 * Golden-value self-check. Accepts ?segment= (default "PTMT").
 *
 * PTMT checks (6):
 *   1. Stock 121-O / WHITE = 1,644
 *   2. Last-month pending total = 137,939
 *   3. Current pending 144-O / WHITE = 132
 *   4. Avg 3-Mo Sale 144-O / WHITE = 5,222
 *   5. Grand Max total ≈ 576,037 (±5 %)
 *   6. Grand Min total ≈ 301,918 (±5 %)
 *
 * Plumbing checks (12) — exact integer match vs Daily Production PLUMBING master (AGRI intentionally corrected).
 * 12 lines = 4 materials (CPVC, UPVC, SWR, AGRI) × 3 types (Pipe, Fitting, Solvent).
 * Grand total = 1,922,309 pcs (matches Pipe Summary management tab).
 * ONE formula for all 12 categories: max((Buffer − Stock) + PendingLM + Pending, 0).
 * AGRI correction: master has Stock/Buffer swapped → corrected values ≈20,299 Pipe / ≈54,590 Fitting.
 *
 * Data sources (Plumbing):
 *   Stock + PendingLM   → plumbing_fg_stock UPLOAD (Net Stock col: +ve=stock, -ve=pendingLM)
 *   Avg3Mo + Pending    → daily-production workbook by header-name mapping (lib/sheets.ts)
 *   Live orders         → Order Sheet 26-27
 *   KGs                 → BOM sheet (1R7k5O6w4qaT74G-5X2VXBtD7-Fg3uByvIw3-TeViMmA)
 */
router.get("/plan/validate", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const segment = String(req.query.segment ?? "PTMT");

  type CheckResult = {
    name: string;
    expected: number;
    actual: number;
    pass: boolean;
    tolerance?: string;
  };

  // ── PLUMBING self-check ────────────────────────────────────────────────────
  if (segment === "Plumbing") {
    // Golden values live in lib/plumbing-golden.ts — update them there when the
    // reference month rolls over.  Never inline them here.
    const [items, fgStockRows, bufferRows, sheet3Rows] = await Promise.all([
      buildPlanItems(month, "Plumbing"),
      loadLatestUploadRowsByKind("plumbing_fg_stock"),
      db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, "Plumbing")),
      fetchPlumbingSheet3Production(month),
    ]);

    const checks: CheckResult[] = [];
    const roundInt = (v: number) => Math.round(v);

    // ── 1. Non-empty guard ─────────────────────────────────────────────────
    // If the FG Stock upload is missing OR the workbook connection failed, every
    // item's stock and pendingLM default to 0 → plan is all-zeros.  Catch it here
    // before the user discovers it in an export.
    const itemCount = items.length;
    const grandTotal = items.reduce((s, i) => s + i.maxProduction, 0);
    checks.push({
      name: "GUARD · Plumbing item count > 0",
      expected: 1,
      actual: itemCount,
      pass: itemCount > 0,
      tolerance: "> 0",
    });
    checks.push({
      name: "GUARD · Plumbing grand total > 0",
      expected: 1,
      actual: roundInt(grandTotal),
      pass: grandTotal > 0,
      tolerance: "> 0",
    });

    // ── 2. Required-upload guard ───────────────────────────────────────────
    // The FG Stock upload is the ONLY source of Stock and Pending-Last-Month.
    // Without it both inputs are 0, making Production Required = 0 for every item.
    const fgRowCount = fgStockRows.length;
    checks.push({
      name: "GUARD · FG Stock upload present (required)",
      expected: 1,
      actual: fgRowCount,
      pass: fgRowCount > 0,
      tolerance: "≥ 1 row",
    });

    // ── 3. Segment isolation ───────────────────────────────────────────────
    const plumbingCategories = new Set(items.map((i) => i.category));
    const distinctCatCount = plumbingCategories.size;
    checks.push({
      name: "ISOLATION · Plumbing category count = 12",
      expected: 12,
      actual: distinctCatCount,
      pass: distinctCatCount === 12,
    });
    const nonPlumbing = [...plumbingCategories].filter(
      (c) => !["CPVC", "UPVC", "SWR", "AGRI"].some((m) => c.startsWith(m)),
    );
    checks.push({
      name: "ISOLATION · No non-Plumbing categories in plan",
      expected: 0,
      actual: nonPlumbing.length,
      pass: nonPlumbing.length === 0,
    });

    // ── 4. Buffer multiplier defaults ──────────────────────────────────────
    // SWR is deliberately 1.0× (not 1.5×) — migration 011 (tolerance=0, exact).
    // CPVC / UPVC / AGRI are AI-computed and drift; tolerance=0.3 catches gross
    // misconfigurations while surviving normal corrective-engine updates.
    const bufferByName = new Map<string, number>(bufferRows.map((b) => [b.name, b.multiplier]));
    for (const { cat, expected, tolerance } of PLUMBING_BUFFER_DEFAULTS) {
      const actual = bufferByName.get(cat) ?? -1;
      const pass = actual >= 0 && Math.abs(actual - expected) <= (tolerance + 0.001);
      const label = tolerance === 0
        ? `${expected}×`
        : `${expected}× ±${tolerance}`;
      checks.push({
        name: `Buffer · ${cat} = ${label}`,
        expected,
        actual,
        pass,
      });
    }

    // ── 5. Solvent membership ──────────────────────────────────────────────
    // Catches the item-type mapping bug: Solvent items mis-classified or dropped.
    for (const { cat, mustInclude } of SOLVENT_MEMBERSHIP) {
      const catCodes = new Set(items.filter((i) => i.category === cat).map((i) => normalizeCode(i.itemCode)));
      for (const code of mustInclude) {
        const found = catCodes.has(normalizeCode(code));
        checks.push({
          name: `Solvent · ${code} in ${cat}`,
          expected: 1,
          actual: found ? 1 : 0,
          pass: found,
        });
      }
    }

    // ── 6. 12 category totals (±1%) ────────────────────────────────────────
    // Golden values from lib/plumbing-golden.ts.
    // AGRI values are an intentional correction — see plumbing-golden.ts header.
    const byCategory = new Map<string, number>();
    for (const item of items) {
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + item.maxProduction);
    }
    for (const { cat, expected } of PLUMBING_GOLDEN) {
      const actual = roundInt(byCategory.get(cat) ?? 0);
      const pct = expected === 0
        ? (actual === 0 ? 0 : Infinity)
        : Math.abs(actual - expected) / expected;
      const pass = expected === 0 ? actual === 0 : pct <= PLUMBING_GOLDEN_TOLERANCE;
      checks.push({
        name: cat,
        expected,
        actual,
        pass,
        tolerance: expected === 0 ? "= 0" : `±${(PLUMBING_GOLDEN_TOLERANCE * 100).toFixed(1)}%`,
      });
    }

    // ── 7. Item counts per category ────────────────────────────────────────
    // Catches the pipe-block-skipped bug (codeCol mismatch) and row-truncation bugs immediately.
    // Expected counts verified against live workbook: CPVC 293/296, UPVC 324/327,
    // SWR 297/300, AGRI 206/209 (remaining rows are blanks or untyped).
    const PLUMBING_ITEM_COUNTS: Array<{ cat: string; expected: number }> = [
      { cat: "CPVC Pipe",    expected: 40  },
      { cat: "CPVC Fitting", expected: 244 },
      { cat: "CPVC Solvent", expected: 9   },
      { cat: "UPVC Pipe",    expected: 52  },
      { cat: "UPVC Fitting", expected: 242 },
      { cat: "UPVC Solvent", expected: 30  },
      { cat: "SWR Pipe",     expected: 160 },
      { cat: "SWR Fitting",  expected: 134 },
      { cat: "SWR Solvent",  expected: 3   },
      { cat: "AGRI Pipe",    expected: 123 },
      { cat: "AGRI Fitting", expected: 82  },
      { cat: "AGRI Solvent", expected: 1   },
    ];
    const itemsByCategory = new Map<string, number>();
    for (const item of items) {
      itemsByCategory.set(item.category, (itemsByCategory.get(item.category) ?? 0) + 1);
    }
    for (const { cat, expected } of PLUMBING_ITEM_COUNTS) {
      const actual = itemsByCategory.get(cat) ?? 0;
      checks.push({
        name: `Items · ${cat} = ${expected}`,
        expected,
        actual,
        pass: actual === expected,
      });
    }

    // ── 8. KG from BOM (pieces × weight-per-piece) ─────────────────────────
    // Guard: if CPVC Pipe kg < 1,000 it was probably read from the broken
    // sheet kg column (~113 for 130,451 pipes — a ~1000× error).
    // Items with no BOM entry contribute 0 kg and are counted separately.
    const kgByCategory = new Map<string, number>();
    let totalNoBomPcs = 0;
    let totalScheduledPcs = 0;
    for (const item of items) {
      const bom = item as PlanItemWithBom;
      const kg = bom.weightKg ?? 0;
      kgByCategory.set(item.category, (kgByCategory.get(item.category) ?? 0) + kg);
      if (bom.noBomWeight) totalNoBomPcs += item.maxProduction;
      totalScheduledPcs += item.maxProduction;
    }

    const cpvcPipeKg = kgByCategory.get("CPVC Pipe") ?? 0;
    checks.push({
      name: "GUARD · KG source: CPVC Pipe kg > 1,000 (BOM-computed, not sheet column)",
      expected: 1_000,
      actual: Math.round(cpvcPipeKg),
      pass: cpvcPipeKg > 1_000,
      tolerance: "> 1,000",
    });

    for (const { cat, expectedKg } of PLUMBING_KG_GOLDEN) {
      const actualKg = Math.round(kgByCategory.get(cat) ?? 0);
      const pass = expectedKg === 0
        ? actualKg === 0
        : Math.abs(actualKg - expectedKg) / expectedKg <= PLUMBING_KG_TOLERANCE;
      checks.push({
        name: `KG · ${cat}`,
        expected: expectedKg,
        actual: actualKg,
        pass,
        tolerance: expectedKg === 0 ? "= 0" : "±1%",
      });
    }

    const totalKg = Math.round([...kgByCategory.values()].reduce((s, v) => s + v, 0));
    checks.push({
      name: "GUARD · Plumbing kg grand total",
      expected: PLUMBING_KG_GRAND_TOTAL,
      actual: totalKg,
      pass: Math.abs(totalKg - PLUMBING_KG_GRAND_TOTAL) / PLUMBING_KG_GRAND_TOTAL <= PLUMBING_KG_TOLERANCE,
      tolerance: "±1%",
    });

    // No-BOM guard: items with no BOM weight contribute 0 kg but must be reported.
    // Expected: ~117,135 pieces (<10% of plan) have no BOM entry.
    const noBomPct = totalScheduledPcs > 0 ? (totalNoBomPcs / totalScheduledPcs) * 100 : 0;
    checks.push({
      name: "GUARD · No-BOM pieces < 10% of plan",
      expected: 10,
      actual: Math.round(noBomPct * 10) / 10,
      pass: noBomPct < 10,
      tolerance: "< 10%",
    });

    // ── 9. Weekly release (cover = Stock / Avg3MoSale; bands 0.3/0.5/0.8) ──
    // Plumbing weekly release bands must be seeded in weekly_release_bands
    // (segment='Plumbing', w1Upper=0.3, w2Upper=0.5, w3Upper=0.8, w4Upper=99).
    // annotateWeeklyRelease() is called inside buildPlumbingPlanItemsFromWorkbook.
    const w1Raw = new Map<string, number>();
    const w2Raw = new Map<string, number>();
    const w3Raw = new Map<string, number>();
    const w4Raw = new Map<string, number>();
    for (const item of items) {
      w1Raw.set(item.category, (w1Raw.get(item.category) ?? 0) + item.w1);
      w2Raw.set(item.category, (w2Raw.get(item.category) ?? 0) + item.w2);
      w3Raw.set(item.category, (w3Raw.get(item.category) ?? 0) + item.w3);
      w4Raw.set(item.category, (w4Raw.get(item.category) ?? 0) + item.w4);
    }

    const plantW1 = Math.round(items.reduce((s, i) => s + i.w1, 0));
    const plantW2 = Math.round(items.reduce((s, i) => s + i.w2, 0));
    const plantW3 = Math.round(items.reduce((s, i) => s + i.w3, 0));
    const plantW4 = Math.round(items.reduce((s, i) => s + i.w4, 0));

    const weekPass = (actual: number, expected: number): boolean =>
      expected === 0 ? actual === 0 : Math.abs(actual - expected) / expected <= PLUMBING_WEEKLY_TOLERANCE;
    const weekTol = (expected: number): string => (expected === 0 ? "= 0" : "±1%");

    checks.push({ name: "Weekly · Plant W1", expected: PLUMBING_WEEKLY_PLANT.w1, actual: plantW1, pass: weekPass(plantW1, PLUMBING_WEEKLY_PLANT.w1), tolerance: "±1%" });
    checks.push({ name: "Weekly · Plant W2", expected: PLUMBING_WEEKLY_PLANT.w2, actual: plantW2, pass: weekPass(plantW2, PLUMBING_WEEKLY_PLANT.w2), tolerance: "±1%" });
    checks.push({ name: "Weekly · Plant W3", expected: PLUMBING_WEEKLY_PLANT.w3, actual: plantW3, pass: weekPass(plantW3, PLUMBING_WEEKLY_PLANT.w3), tolerance: "±1%" });
    checks.push({ name: "Weekly · Plant W4", expected: PLUMBING_WEEKLY_PLANT.w4, actual: plantW4, pass: weekPass(plantW4, PLUMBING_WEEKLY_PLANT.w4), tolerance: "±1%" });

    for (const g of PLUMBING_WEEKLY_GOLDEN) {
      const rw1 = w1Raw.get(g.cat) ?? 0;
      const rw2 = w2Raw.get(g.cat) ?? 0;
      const rw3 = w3Raw.get(g.cat) ?? 0;
      const rw4 = w4Raw.get(g.cat) ?? 0;
      const aw1 = Math.round(rw1);
      const aw2 = Math.round(rw2);
      const aw3 = Math.round(rw3);
      const aw4 = Math.round(rw4);

      checks.push({ name: `Weekly · ${g.cat} · W1`, expected: g.w1, actual: aw1, pass: weekPass(aw1, g.w1), tolerance: weekTol(g.w1) });
      checks.push({ name: `Weekly · ${g.cat} · W2`, expected: g.w2, actual: aw2, pass: weekPass(aw2, g.w2), tolerance: weekTol(g.w2) });
      checks.push({ name: `Weekly · ${g.cat} · W3`, expected: g.w3, actual: aw3, pass: weekPass(aw3, g.w3), tolerance: weekTol(g.w3) });
      checks.push({ name: `Weekly · ${g.cat} · W4`, expected: g.w4, actual: aw4, pass: weekPass(aw4, g.w4), tolerance: weekTol(g.w4) });

      // Sum check: all weekly totals must equal the category's production required.
      // Items with cover = "OS" (avg3MoSale = 0) and maxProduction > 0 are unscheduled
      // and will cause this check to fail — that is intentional (a data-quality signal).
      const weeklySum = Math.round(rw1 + rw2 + rw3 + rw4);
      const prodReq   = roundInt(byCategory.get(g.cat) ?? 0);
      checks.push({
        name: `Weekly · ${g.cat} · sum = prod req`,
        expected: prodReq,
        actual: weeklySum,
        pass: weeklySum === prodReq,
      });
    }

    const categoryTotals: Record<string, number> = {};
    for (const [cat, total] of byCategory.entries()) categoryTotals[cat] = roundInt(total);
    for (const { cat } of PLUMBING_GOLDEN) if (!(cat in categoryTotals)) categoryTotals[cat] = 0;

    // ── 8. Monitoring actuals vs frozen golden values (28 checks) ────────────
    // Folded so /plan/validate?segment=Plumbing covers all 163 checks in one call.
    // W1 = Jul 1–7, W2 = Jul 8–14 (both elapsed, actuals are stable).
    {
      const normMap = new Map<string, string>();
      for (const item of items) {
        const norm = normalizeCodeStrict(item.itemCode);
        if (!normMap.has(norm)) normMap.set(norm, item.category);
      }
      const catAct = new Map<string, number[]>();
      const unmWk = [0, 0, 0, 0];
      for (const row of sheet3Rows) {
        const d = parseInt(row.dateStr.slice(8), 10);
        const wi = d <= 7 ? 0 : d <= 14 ? 1 : d <= 21 ? 2 : 3;
        const cat = normMap.get(row.normCode);
        if (!cat) { unmWk[wi]! += row.qty; continue; }
        const arr = catAct.get(cat) ?? [0, 0, 0, 0];
        arr[wi]! += row.qty;
        catAct.set(cat, arr);
      }
      const plantM = [0, 0, 0, 0];
      for (const [, arr] of catAct) for (let i = 0; i < 4; i++) plantM[i]! += arr[i]!;

      const MON_TOL = PLUMBING_MON_TOLERANCE;
      const monChk = (name: string, expected: number, actual: number): CheckResult => {
        const pass = expected === 0 ? actual === 0 : Math.abs(actual - expected) / expected <= MON_TOL;
        return { name, expected: Math.round(expected), actual: Math.round(actual), pass,
          tolerance: expected === 0 ? "exact" : `±${(MON_TOL * 100).toFixed(0)}%` };
      };
      checks.push(monChk("Mon · Plant W1 mapped",   PLUMBING_MON_W1_MAPPED,   plantM[0]!));
      checks.push(monChk("Mon · Plant W2 mapped",   PLUMBING_MON_W2_MAPPED,   plantM[1]!));
      checks.push(monChk("Mon · W1 unmapped",       PLUMBING_MON_W1_UNMAPPED, unmWk[0]!));
      checks.push(monChk("Mon · W2 unmapped",       PLUMBING_MON_W2_UNMAPPED, unmWk[1]!));
      for (const [cat, exp] of Object.entries(PLUMBING_MON_CAT_W1))
        checks.push(monChk(`Mon · ${cat} W1`, exp, (catAct.get(cat) ?? [0, 0, 0, 0])[0]!));
      for (const [cat, exp] of Object.entries(PLUMBING_MON_CAT_W2))
        checks.push(monChk(`Mon · ${cat} W2`, exp, (catAct.get(cat) ?? [0, 0, 0, 0])[1]!));
    }

    // ── 9. Machine cascade checks ───────────────────────────────────────────
    {
      const FLEX_MACHINES = new Set(["MC3", "MC4", "MC5"]);
      const hasMachineData = items.some(i => (i as PlanItemWithBom).machineW1 !== undefined);
      checks.push({
        name: "Machine · cascade ran (machines seeded)",
        expected: 1,
        actual: hasMachineData ? 1 : 0,
        pass: hasMachineData,
        tolerance: "bool",
      });

      if (hasMachineData) {
        let sumInconsistent = 0;
        for (const item of items) {
          if (item.maxProduction <= 0) continue;
          const cat = item.category;
          if (cat.endsWith("Solvent")) continue;
          const bom = item as PlanItemWithBom;
          if (bom.machineUnfulfillable) continue;
          const mSum = (bom.machineW1 ?? 0) + (bom.machineW2 ?? 0) + (bom.machineW3 ?? 0) + (bom.machineW4 ?? 0);
          if (Math.abs(mSum - item.maxProduction) > 1) sumInconsistent++;
        }
        checks.push({
          name: "Machine · cascade sum consistency (machineW sum = maxProduction)",
          expected: 0,
          actual: sumInconsistent,
          pass: sumInconsistent === 0,
        });

        const agriPipeItems = items.filter(i => i.category === "AGRI Pipe" && i.maxProduction > 0);
        const agriOnNonFlex = agriPipeItems.filter(i => {
          const mid = (i as PlanItemWithBom).assignedMachineId;
          return mid !== null && mid !== undefined && !FLEX_MACHINES.has(mid);
        });
        checks.push({
          name: "Machine · AGRI Pipe only on flex machines (MC3/MC4/MC5)",
          expected: 0,
          actual: agriOnNonFlex.length,
          pass: agriOnNonFlex.length === 0,
        });
      }
    }

    // ── machineFeasible summary — full cascade result: categories + utilisation + unfulfillable ──
    let machineFeasible: {
      categories: { category: string; desiredPcs: number; feasiblePcs: number; unfulfillablePcs: number }[];
      utilisation: import("../lib/machine-capacity-engine").MachineWeekUtilisation[];
      unfulfillable: { itemCode: string; category: string; pieces: number; bindingMachine: string | null }[];
    } | null = null;
    if (segment === "Plumbing") {
      // Re-run cascade to obtain utilisation + unfulfillable alongside the category summary.
      const machinesForFeasible = await db
        .select()
        .from(plumbingMachineCapacityTable)
        .where(eq(plumbingMachineCapacityTable.segment, "Plumbing"));

      const freshCascadeItems = items.map(i => ({
        ...(i as PlanItemWithBom),
        machineW1: 0 as number,
        machineW2: 0 as number,
        machineW3: 0 as number,
        machineW4: 0 as number,
        assignedMachineId: null as string | null,
        machineWeek: null as 1 | 2 | 3 | 4 | null,
        machineUnfulfillable: false,
      }));

      const machineResult = runMachineCascade(
        freshCascadeItems as unknown as PlanItemForCascade[],
        machinesForFeasible,
        month,
      );

      const allCats = [...new Set(items.map(i => i.category))].sort();
      const catSummary = allCats.map(cat => {
        const catItems  = freshCascadeItems.filter(i => i.category === cat);
        const desiredPcs = catItems.reduce((s, i) => s + i.maxProduction, 0);
        const feasiblePcs = catItems.reduce(
          (s, i) => s + (i.machineW1 ?? 0) + (i.machineW2 ?? 0) + (i.machineW3 ?? 0) + (i.machineW4 ?? 0),
          0,
        );
        const unfulfillablePcs = catItems
          .filter(i => i.machineUnfulfillable)
          .reduce((s, i) => s + i.maxProduction, 0);
        return { category: cat, desiredPcs, feasiblePcs, unfulfillablePcs };
      });

      machineFeasible = {
        categories: catSummary,
        utilisation: machineResult.utilisation,
        unfulfillable: machineResult.unfulfillable,
      };
    }

    const allPass = checks.every((c) => c.pass);
    const failCount = checks.filter((c) => !c.pass).length;
    res.json({ month, segment, allPass, passCount: checks.length - failCount, failCount, checks, categoryTotals, machineFeasible });
    return;
  }

  // ── PTMT self-check ────────────────────────────────────────────────────────
  // Fetch everything in one parallel batch — DB reads + both Sheets calls
  // so we only pay the throttle penalty once (they overlap in Promise.all).
  const [
    stockRows,
    rawPendingRows,
    lastMoRows,
    itemRows,
    bufferRows,
    avg3MoTotals,
    liveOrderTotals,
  ] = await Promise.all([
    loadLatestUploadRowsByKind("current_stock"),
    loadLatestUploadRowsByKind("pending_orders"),
    loadLatestUploadRowsByKind("last_month_pending"),
    db.select().from(itemMasterTable).where(eq(itemMasterTable.segment, "PTMT")),
    db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, "PTMT")),
    fetchAvg3MoSaleTotals(month),
    fetchLiveOrderTotals(month),
  ]);

  // Filter DATA.xlsx rows to PTMT segment (file now stores all segments; filter here mirrors buildPlanItems)
  const pendingRows = rawPendingRows.filter((row) => {
    const seg = String(row["Segment"] ?? "").trim().toUpperCase();
    return seg === "PTMT" || seg === "PT";
  });

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
  const maxPct = Math.abs(summary.grandMaxTotal - PTMT_GRAND_MAX) / PTMT_GRAND_MAX;
  const minPct = Math.abs(summary.grandMinTotal - PTMT_GRAND_MIN) / PTMT_GRAND_MIN;
  const tolLabel = `±${(PTMT_TOLERANCE * 100).toFixed(1)}%`;
  checks.push({
    name: `Grand Max total ≈ ${PTMT_GRAND_MAX.toLocaleString("en-IN")}`,
    expected: PTMT_GRAND_MAX,
    actual: summary.grandMaxTotal,
    pass: maxPct <= PTMT_TOLERANCE,
    tolerance: tolLabel,
  });
  checks.push({
    name: `Grand Min total ≈ ${PTMT_GRAND_MIN.toLocaleString("en-IN")}`,
    expected: PTMT_GRAND_MIN,
    actual: summary.grandMinTotal,
    pass: minPct <= PTMT_TOLERANCE,
    tolerance: tolLabel,
  });

  // ── Per-category Max / Min (±0.1%) ─────────────────────────────────────────
  const catMap = new Map(summary.categories.map((c) => [c.category, c]));
  for (const g of PTMT_CATEGORY_GOLDEN) {
    const cat = catMap.get(g.cat);
    const actualMax = cat?.maxTotal ?? 0;
    const actualMin = cat?.minTotal ?? 0;
    const catMaxPct = g.maxExpected > 0
      ? Math.abs(actualMax - g.maxExpected) / g.maxExpected
      : actualMax === 0 ? 0 : 1;
    const catMinPct = g.minExpected > 0
      ? Math.abs(actualMin - g.minExpected) / g.minExpected
      : actualMin === 0 ? 0 : 1;
    checks.push({
      name: `PTMT · ${g.cat} · Max`,
      expected: g.maxExpected,
      actual: Math.round(actualMax),
      pass: catMaxPct <= PTMT_TOLERANCE,
      tolerance: tolLabel,
    });
    checks.push({
      name: `PTMT · ${g.cat} · Min`,
      expected: g.minExpected,
      actual: Math.round(actualMin),
      pass: catMinPct <= PTMT_TOLERANCE,
      tolerance: tolLabel,
    });
  }

  // ── Applied multiplier lock (exact match) ───────────────────────────────────
  // Catches any recompute that lets Suggested silently replace the business multiplier.
  // Applied = multiplier column in the DB (set to override when present; seed ensures
  // all 7 categories have the override locked at startup).
  const bufferByName = new Map<string, { multiplier: number; overrideMultiplier: number | null }>(
    bufferRows.map((b) => [b.name, { multiplier: b.multiplier, overrideMultiplier: b.overrideMultiplier ?? null }]),
  );
  for (const { cat, multiplier: expectedMult } of PTMT_MULTIPLIER_GOLDEN) {
    const row = bufferByName.get(cat);
    const actualOverride = row?.overrideMultiplier ?? -1;
    const overridePass = actualOverride === expectedMult;
    checks.push({
      name: `PTMT · ${cat} · Override locked ×${expectedMult}`,
      expected: expectedMult,
      actual: actualOverride,
      pass: overridePass,
      tolerance: "exact",
    });
    const actualApplied = row?.multiplier ?? -1;
    const appliedPass = Math.abs(actualApplied - expectedMult) < 0.001;
    checks.push({
      name: `PTMT · ${cat} · Applied ×${expectedMult}`,
      expected: expectedMult,
      actual: actualApplied,
      pass: appliedPass,
      tolerance: "exact",
    });
  }

  const allPass = checks.every((c) => c.pass);
  const failCount = checks.filter((c) => !c.pass).length;

  res.json({ month, segment, allPass, passCount: checks.length - failCount, failCount, checks });
});

// ── GET /plan/plumbing-monitoring ─────────────────────────────────────────────
// Returns per-week and per-category Sheet3 actuals vs plan release targets.
// Methodology:
//   - MAPPED actual  = Sheet3 codes that match a plan item via normalizeCodeStrict
//   - UNMAPPED       = Sheet3 codes with no plan-master match (surfaced, not dropped)
//   - Cumulative attainment = cumMapped / cumRelease (suppressed if week not started)
// 5-min response cache so the first cold call (9s) doesn't block subsequent browser hits.
const _plumbingMonCache = new Map<string, { payload: unknown; expires: number }>();
router.get("/plan/plumbing-monitoring", async (req, res) => {
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month query param required (YYYY-MM)" });
    return;
  }
  const cached = _plumbingMonCache.get(month);
  if (cached && Date.now() < cached.expires) {
    res.json(cached.payload);
    return;
  }
  try {
    const [planItems, sheet3Rows] = await Promise.all([
      buildPlanItems(month, "Plumbing"),
      fetchPlumbingSheet3Production(month),
    ]);

    // Code → category map (strict normalization: "A465" matches "A-465")
    const codeToCategory = new Map<string, string>();
    const catRelease = new Map<string, [number, number, number, number]>();
    for (const item of planItems) {
      const norm = normalizeCodeStrict(item.itemCode);
      if (!codeToCategory.has(norm)) codeToCategory.set(norm, item.category);
      const arr = catRelease.get(item.category) ?? [0, 0, 0, 0];
      arr[0] += (item as unknown as Record<string, number>)["w1"] ?? 0;
      arr[1] += (item as unknown as Record<string, number>)["w2"] ?? 0;
      arr[2] += (item as unknown as Record<string, number>)["w3"] ?? 0;
      arr[3] += (item as unknown as Record<string, number>)["w4"] ?? 0;
      catRelease.set(item.category, arr);
    }

    function wkIdx(day: number): number { return day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3; }

    const catActual = new Map<string, [number, number, number, number]>();
    const unmappedByWeek: [number, number, number, number] = [0, 0, 0, 0];
    const unmappedCodeQty = new Map<string, number>();

    for (const row of sheet3Rows) {
      const cat = codeToCategory.get(row.normCode);
      const wi = wkIdx(parseInt(row.dateStr.slice(8), 10));
      if (!cat) {
        unmappedByWeek[wi] += row.qty;
        unmappedCodeQty.set(row.rawCode, (unmappedCodeQty.get(row.rawCode) ?? 0) + row.qty);
        continue;
      }
      const arr = catActual.get(cat) ?? [0, 0, 0, 0];
      arr[wi] += row.qty;
      catActual.set(cat, arr);
    }

    // Week calendar
    const [yr, mo] = month.split("-").map(Number);
    const lastDayOfMonth = new Date(yr, mo, 0).getDate();
    function p2(n: number) { return String(n).padStart(2, "0"); }
    const calendar = [
      { week: 1, label: `W1 (${mo}/1–7)`,           startDay: 1,  endDay: 7,            startDate: `${yr}-${p2(mo)}-01`, endDate: `${yr}-${p2(mo)}-07` },
      { week: 2, label: `W2 (${mo}/8–14)`,           startDay: 8,  endDay: 14,           startDate: `${yr}-${p2(mo)}-08`, endDate: `${yr}-${p2(mo)}-14` },
      { week: 3, label: `W3 (${mo}/15–21)`,          startDay: 15, endDay: 21,           startDate: `${yr}-${p2(mo)}-15`, endDate: `${yr}-${p2(mo)}-21` },
      { week: 4, label: `W4 (${mo}/22–${lastDayOfMonth})`, startDay: 22, endDay: lastDayOfMonth, startDate: `${yr}-${p2(mo)}-22`, endDate: `${yr}-${p2(mo)}-${p2(lastDayOfMonth)}` },
    ];

    // Plant totals per week (round release — plan items have fractional w1-w4 due to band multiplication)
    const plantRelease: [number, number, number, number] = [0, 0, 0, 0];
    const plantMapped:  [number, number, number, number] = [0, 0, 0, 0];
    for (const [, arr] of catRelease) for (let i = 0; i < 4; i++) plantRelease[i] += arr[i];
    for (const [, arr] of catActual)  for (let i = 0; i < 4; i++) plantMapped[i]  += arr[i];
    for (let i = 0; i < 4; i++) plantRelease[i] = Math.round(plantRelease[i]);

    // Working days elapsed (non-Sunday days from 1st through last data date)
    const lastDataDate = sheet3Rows.length > 0 ? [...sheet3Rows].map((r) => r.dateStr).sort().pop()! : null;
    let workingDaysElapsed = 0;
    if (lastDataDate) {
      const throughDay = parseInt(lastDataDate.slice(8), 10);
      for (let d = 1; d <= throughDay; d++) {
        if (new Date(`${month}-${p2(d)}T00:00:00Z`).getUTCDay() !== 0) workingDaysElapsed++;
      }
    }

    // Build per-week response (cumulative columns)
    const today = new Date().toISOString().slice(0, 10);
    let cumRelease = 0, cumMapped = 0, cumTotal = 0;
    const weeks = calendar.map((wk, i) => {
      const release = plantRelease[i]!;
      const mapped   = plantMapped[i]!;
      const unmapped = unmappedByWeek[i]!;
      const actual   = mapped + unmapped;
      cumRelease += release;
      cumMapped  += mapped;
      cumTotal   += actual;
      const wkStarted = today.slice(0, 7) === month && today >= wk.startDate;
      const cumAttPct  = cumRelease > 0 && wkStarted ? Math.round((cumMapped  / cumRelease) * 1000) / 10 : null;
      const wkAttPct   = release   > 0 && wkStarted ? Math.round((mapped     / release)    * 1000) / 10 : null;
      return { week: wk.week, label: wk.label, startDate: wk.startDate, endDate: wk.endDate,
        release, mapped, unmapped, actual, wkAttPct,
        cumRelease, cumMapped, cumTotal, cumAttPct };
    });

    // Per-category rows
    const allCats = new Set([...catRelease.keys(), ...catActual.keys()]);
    const categories = [...allCats].map((cat) => {
      const rel = catRelease.get(cat) ?? [0, 0, 0, 0];
      const act = catActual.get(cat) ?? [0, 0, 0, 0];
      const totalRelease = rel.reduce((s, v) => s + v, 0);
      const totalActual  = act.reduce((s, v) => s + v, 0);
      return {
        category: cat,
        w1Release: Math.round(rel[0]), w1Actual: act[0],
        w2Release: Math.round(rel[1]), w2Actual: act[1],
        w3Release: Math.round(rel[2]), w3Actual: act[2],
        w4Release: Math.round(rel[3]), w4Actual: act[3],
        totalRelease: Math.round(totalRelease), totalActual,
        notStarted: totalActual === 0 && totalRelease > 0,
      };
    }).sort((a, b) => b.totalRelease - a.totalRelease);

    // Unmapped top codes
    const topCodes = [...unmappedCodeQty.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 20).map(([code, qty]) => ({ code, qty }));

    const totalUnmapped = unmappedByWeek.reduce((s, v) => s + v, 0);
    const totalMapped   = plantMapped.reduce((s, v) => s + v, 0);
    const totalProduced = totalMapped + totalUnmapped;
    const runRatePerDay = workingDaysElapsed > 0 ? Math.round(totalProduced / workingDaysElapsed) : 0;

    const payload = { month, lastDataDate, workingDaysElapsed,
      weeks, categories,
      unmapped: { byWeek: [...unmappedByWeek], total: totalUnmapped, topCodes },
      totalProduced, totalMapped, totalUnmapped, runRatePerDay };

    _plumbingMonCache.set(month, { payload, expires: Date.now() + 5 * 60 * 1000 });
    res.json(payload);
  } catch (err) {
    req.log.error({ err, month }, "plan/plumbing-monitoring failed");
    res.status(500).json({ error: "Failed to compute Plumbing monitoring" });
  }
});

// ── GET /plan/validate-plumbing-monitoring ─────────────────────────────────────
// Regression endpoint: compares Sheet3 W1/W2 actuals against frozen golden values.
// W1 (Jul 1-7) and W2 (Jul 8-14) are both elapsed and their actuals are stable.
router.get("/plan/validate-plumbing-monitoring", async (req, res) => {
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month query param required (YYYY-MM)" });
    return;
  }
  try {
    const [planItems, sheet3Rows] = await Promise.all([
      buildPlanItems(month, "Plumbing"),
      fetchPlumbingSheet3Production(month),
    ]);

    const codeToCategory2 = new Map<string, string>();
    for (const item of planItems) {
      const norm = normalizeCodeStrict(item.itemCode);
      if (!codeToCategory2.has(norm)) codeToCategory2.set(norm, item.category);
    }

    function wkIdx2(day: number): number { return day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3; }

    const catActual2 = new Map<string, [number, number, number, number]>();
    const unmappedByWeek2: [number, number, number, number] = [0, 0, 0, 0];

    for (const row of sheet3Rows) {
      const cat = codeToCategory2.get(row.normCode);
      const wi  = wkIdx2(parseInt(row.dateStr.slice(8), 10));
      if (!cat) { unmappedByWeek2[wi] += row.qty; continue; }
      const arr = catActual2.get(cat) ?? [0, 0, 0, 0];
      arr[wi] += row.qty;
      catActual2.set(cat, arr);
    }

    const plantMapped2: [number, number, number, number] = [0, 0, 0, 0];
    for (const [, arr] of catActual2) for (let i = 0; i < 4; i++) plantMapped2[i] += arr[i];

    type MonCheckResult = { name: string; expected: number; actual: number; pass: boolean; tolerance?: string };

    function chk(name: string, expected: number, actual: number, tol: number): MonCheckResult {
      const pass = expected === 0 ? actual === 0 : Math.abs(actual - expected) / expected <= tol;
      return { name, expected: Math.round(expected), actual: Math.round(actual), pass,
        tolerance: expected === 0 ? "exact" : `±${(tol * 100).toFixed(0)}%` };
    }

    const checks: MonCheckResult[] = [];
    const TOL = PLUMBING_MON_TOLERANCE;

    // Plant-level W1 and W2 mapped totals
    checks.push(chk("Mon · Plant W1 mapped",   PLUMBING_MON_W1_MAPPED,   plantMapped2[0]!, TOL));
    checks.push(chk("Mon · Plant W2 mapped",   PLUMBING_MON_W2_MAPPED,   plantMapped2[1]!, TOL));
    checks.push(chk("Mon · W1 unmapped",       PLUMBING_MON_W1_UNMAPPED, unmappedByWeek2[0]!, TOL));
    checks.push(chk("Mon · W2 unmapped",       PLUMBING_MON_W2_UNMAPPED, unmappedByWeek2[1]!, TOL));

    // Per-category W1 actuals
    for (const [cat, expected] of Object.entries(PLUMBING_MON_CAT_W1)) {
      const actual = (catActual2.get(cat) ?? [0, 0, 0, 0])[0]!;
      checks.push(chk(`Mon · ${cat} W1`, expected, actual, TOL));
    }

    // Per-category W2 actuals
    for (const [cat, expected] of Object.entries(PLUMBING_MON_CAT_W2)) {
      const actual = (catActual2.get(cat) ?? [0, 0, 0, 0])[1]!;
      checks.push(chk(`Mon · ${cat} W2`, expected, actual, TOL));
    }

    const allPass   = checks.every((c) => c.pass);
    const failCount = checks.filter((c) => !c.pass).length;
    res.json({ month, allPass, passCount: checks.length - failCount, failCount, checks });
  } catch (err) {
    req.log.error({ err, month }, "plan/validate-plumbing-monitoring failed");
    res.status(500).json({ error: "Failed to validate Plumbing monitoring" });
  }
});

// ── GET /plan/summary ─────────────────────────────────────────────────────────
// Unified plan summary consumed by both:
//   • production-planning /summary page  → grandMinTotal, grandMaxTotal,
//       categories[].{category, minTotal, maxTotal}
//   • ops-dashboard segment filter       → totalPcs, totalKg, totalMin,
//       categories[].{name, pcs, kg}
router.get("/plan/summary", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  const segment = String(req.query.segment ?? "PTMT");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month query param required (YYYY-MM)" });
    return;
  }
  try {
    const items = await buildPlanItems(month, segment);
    // Full summarizePlan result (used by summary page)
    const planSummary = summarizePlan(items);
    // Per-category kg accumulator (Plumbing BOM weight)
    const catKg = new Map<string, number>();
    let totalKg = 0;
    for (const item of items) {
      const kg = Math.round((item as any).weightKg ?? 0);
      totalKg += kg;
      catKg.set(item.category, (catKg.get(item.category) ?? 0) + kg);
    }
    // Merged categories: both old shape (category/minTotal/maxTotal)
    // and new shape (name/pcs/kg) so both consumers work
    const categories = planSummary.categories.map((c) => ({
      ...c,                          // category, minTotal, maxTotal (summary page)
      name: c.category,             // ops-dashboard
      pcs:  Math.round(c.maxTotal), // ops-dashboard
      kg:   catKg.get(c.category) ?? 0, // ops-dashboard
    }));
    res.json({
      month,
      segment,
      // production-planning summary page fields
      grandMinTotal: planSummary.grandMinTotal,
      grandMaxTotal: planSummary.grandMaxTotal,
      // ops-dashboard fields
      totalPcs: planSummary.grandMaxTotal,
      totalKg:  Math.round(totalKg),
      totalMin: planSummary.grandMinTotal,
      categories,
    });
  } catch (err) {
    req.log.error({ err, month, segment }, "plan/summary failed");
    res.status(500).json({ error: "Failed to compute plan summary" });
  }
});

export default router;
