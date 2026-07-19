import { Router, type IRouter } from "express";
import { db, itemMasterTable, bufferCategoriesTable, uploadedFilesTable, weeklyReleaseBandsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { computeItemPlan, annotateWeeklyRelease, summarizePlan, type ItemSourceRow, type WeeklyBandConfig } from "../lib/calc";
import {
  fetchAvg3MoSaleTotals,
  fetchLiveOrderTotals,
  fetchPlumbingBomWeights,
  fetchPlumbingPlanData,
  itemKey,
  normalizeCode,
  type DualTotals,
} from "../lib/sheets";
import { exportPlanExcel } from "../lib/excel-export";
import { exportPlanPdf } from "../lib/pdf-export";
import { exportWeeklyReleaseExcel } from "../lib/weekly-excel-export";
import {
  PLUMBING_GOLDEN,
  PLUMBING_GOLDEN_TOLERANCE,
  PLUMBING_BUFFER_DEFAULTS,
  SOLVENT_MEMBERSHIP,
  PTMT_GRAND_MAX,
  PTMT_GRAND_MIN,
  PTMT_TOLERANCE,
  PTMT_CATEGORY_GOLDEN,
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
 * Plan item augmented with Plumbing BOM weight fields.
 * weightKg and noBomWeight are present for Plumbing items only.
 *   weightKg = maxProduction × weight_per_pcs (from BOM sheet); 0 when no BOM entry.
 *   noBomWeight = true when item has no BOM weight entry (must be flagged, never silently dropped).
 * PTMT items do not carry these fields (undefined).
 */
export type PlanItemWithBom = ReturnType<typeof computeItemPlan> & {
  weightKg?: number;
  noBomWeight?: boolean;
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
 *   Production Required   = max( (Buffer − Stock) + PendingLM + Pending , 0 )
 *   Category total        = sum of per-item values
 *
 * AGRI correction: the master's AGRI tab has Stock and Buffer columns SWAPPED.
 * By reading columns by header name the app gets the correct values and produces
 * the right plan (≈20,299 AGRI Pipe; ≈54,590 AGRI Fitting).
 * The workbook's Stock/PendingLM columns are NOT used — FG Stock upload is authoritative.
 */
async function buildPlumbingPlanItemsFromWorkbook(month: string): Promise<PlanItemWithBom[]> {
  const [workbookRows, fgStockRows, bufferRows, bandRows, liveOrderTotals, bomWeights] = await Promise.all([
    fetchPlumbingPlanData(month),
    loadLatestUploadRowsByKind("plumbing_fg_stock"),
    db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, "Plumbing")),
    db.select().from(weeklyReleaseBandsTable).where(eq(weeklyReleaseBandsTable.segment, "Plumbing")),
    fetchLiveOrderTotals(month, "PLUMBING"),
    fetchPlumbingBomWeights(),
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

      // One formula for all 12 Plumbing categories: max((Buffer − Stock) + PendingLM + Pending, 0)
      const computed = computeItemPlan(source, resolvedCategory, multiplier);

      // BOM weight — ~3% of items may have no BOM entry; flag them, never drop or guess.
      const weightPcs = bomWeights.get(code);
      const noBomWeight = weightPcs === undefined;
      const weightKg = noBomWeight ? 0 : Math.round(computed.maxProduction * weightPcs! * 100) / 100;
      return { ...computed, weightKg, noBomWeight };
    })
    .filter((item): item is PlanItemWithBom => item !== null);

  annotateWeeklyRelease(items, bandsByCategory);
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

router.get("/plan/summary", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const segment = String(req.query.segment ?? "PTMT");
  const items = await buildPlanItems(month, segment);
  const summary = summarizePlan(items);
  res.json({ month, ...summary });
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
    const [items, fgStockRows, bufferRows] = await Promise.all([
      buildPlanItems(month, "Plumbing"),
      loadLatestUploadRowsByKind("plumbing_fg_stock"),
      db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, "Plumbing")),
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
        tolerance: expected === 0 ? "= 0" : `±${(PLUMBING_GOLDEN_TOLERANCE * 100).toFixed(0)}%`,
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

    const categoryTotals: Record<string, number> = {};
    for (const [cat, total] of byCategory.entries()) categoryTotals[cat] = roundInt(total);
    for (const { cat } of PLUMBING_GOLDEN) if (!(cat in categoryTotals)) categoryTotals[cat] = 0;

    const allPass = checks.every((c) => c.pass);
    const failCount = checks.filter((c) => !c.pass).length;
    res.json({ month, segment, allPass, passCount: checks.length - failCount, failCount, checks, categoryTotals });
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

  const allPass = checks.every((c) => c.pass);
  const failCount = checks.filter((c) => !c.pass).length;

  res.json({ month, segment, allPass, passCount: checks.length - failCount, failCount, checks });
});

export default router;
