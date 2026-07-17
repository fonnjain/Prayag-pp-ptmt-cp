import { Router, type IRouter } from "express";
import { db, itemMasterTable, bufferCategoriesTable, uploadedFilesTable, weeklyReleaseBandsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { computeItemPlan, annotateWeeklyRelease, summarizePlan, type ItemSourceRow, type WeeklyBandConfig } from "../lib/calc";
import {
  fetchAvg3MoSaleTotals,
  fetchLiveOrderTotals,
  fetchPlumbingBomWeights,
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
 * Build plan items for a given month and segment.
 * segment defaults to "PTMT" — passing "Plumbing" scopes every DB read and
 * upload-kind lookup to the Plumbing category set without touching PTMT data.
 */
export async function buildPlanItems(month: string, segment: string = "PTMT"): Promise<PlanItemWithBom[]> {
  const isPlumbing = segment === "Plumbing";
  const orderGroup = isPlumbing ? "PLUMBING" : "PTMT";

  // ── Shared data (loads in parallel for both segments) ───────────────────────
  const [itemRows, bufferRows, bandRows, rawPendingOrderRows, avg3MoTotals, liveOrderTotals, bomWeights] =
    await Promise.all([
      db.select().from(itemMasterTable).where(eq(itemMasterTable.segment, segment)),
      db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, segment)),
      db.select().from(weeklyReleaseBandsTable).where(eq(weeklyReleaseBandsTable.segment, segment)),
      // DATA.xlsx (pending_orders) — global upload serving both PTMT + Plumbing.
      // Rows for all segments are stored; we filter to this segment below.
      loadLatestUploadRowsByKind("pending_orders"),
      fetchAvg3MoSaleTotals(month),
      fetchLiveOrderTotals(month, orderGroup),
      isPlumbing ? fetchPlumbingBomWeights() : Promise.resolve(new Map<string, number>()),
    ]);

  // Filter DATA.xlsx rows to this segment (file stores rows for all segments)
  const pendingOrderRows = rawPendingOrderRows.filter((row) => {
    const seg = String(row["Segment"] ?? "").trim().toUpperCase();
    if (isPlumbing) return seg === "PLUMBING" || seg === "P";
    return seg === "PTMT" || seg === "PT";
  });

  // ── Segment-specific stock + last-month-pending data ────────────────────────
  // Plumbing: single "plumbing_fg_stock" upload provides both inputs via Col R sign.
  //   Positive Net Stock → opening stock as on 1st of planning month (→ Stock input)
  //   Negative Net Stock → |value| = pending order last month (→ Pending-LM input)
  // PTMT: two separate uploads unchanged (current_stock, last_month_pending).
  let currentStockRows: Record<string, unknown>[] = [];
  let pendingLastMoRows: Record<string, unknown>[] = [];

  if (isPlumbing) {
    const fgStockRows = await loadLatestUploadRowsByKind("plumbing_fg_stock");
    for (const row of fgStockRows) {
      const ns =
        typeof row["Net Stock"] === "number"
          ? row["Net Stock"]
          : Number(String(row["Net Stock"] ?? 0).replace(/,/g, ""));
      if (ns > 0) {
        currentStockRows.push({ ...row, Qty: ns });
      } else if (ns < 0) {
        pendingLastMoRows.push({ ...row, Qty: Math.abs(ns) });
      }
      // ns === 0: skip (no stock and no pending-LM contribution)
    }
  } else {
    [currentStockRows, pendingLastMoRows] = await Promise.all([
      loadLatestUploadRowsByKind("current_stock"),
      loadLatestUploadRowsByKind("last_month_pending"),
    ]);
  }

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
    const computed = computeItemPlan(source, item.category, multiplier);

    // Plumbing: attach kg computed from BOM (never from master kg column).
    // ~3% of items may have no BOM entry — flag them, never drop or guess.
    if (isPlumbing) {
      const weightPcs = bomWeights.get(normalizeCode(item.itemCode));
      const noBomWeight = weightPcs === undefined;
      const weightKg = noBomWeight ? 0 : Math.round(computed.maxProduction * weightPcs! * 100) / 100;
      return { ...computed, weightKg, noBomWeight };
    }
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

router.get("/plan/export/excel", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const segment = String(req.query.segment ?? "PTMT");
  const items = await buildPlanItems(month, segment);
  const summary = summarizePlan(items);
  const buffer = await exportPlanExcel(month, items, summary);
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
 * Plumbing checks (4) — exact integer match, verified July 2026 vs master Excel:
 *   1. CPVC Pipe Production Required   = 130,451
 *   2. CPVC Fitting Production Required = 763,253
 *   3. UPVC Pipe Production Required   = 51,899
 *   4. UPVC Fitting Production Required = 633,038
 *   SWR + AGRI are informational only (separate material planning sheets; 0 this month is correct).
 *
 * Data sources (Plumbing):
 *   Stock + Pending-LM  → plumbing_fg_stock upload, Col R split by sign
 *   Avg-3-Mo sale       → live Sale 26-27 Google Sheet (NOT from DATA.xlsx — that holds one month only)
 *   Current pending     → DATA.xlsx pending_orders upload, filtered to Plumbing segment
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
    // Run the full Plumbing plan (FG Stock upload + live sheets).
    // buildPlanItems handles all data-source wiring: Col R sign split, segment filter
    // on pending_orders, avg-3mo from live Sale 26-27, BOM weights from Sheets.
    const items = await buildPlanItems(month, "Plumbing");

    // Sum maxProduction (= Production Required) by category
    const byCategory = new Map<string, number>();
    for (const item of items) {
      byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + item.maxProduction);
    }
    const roundInt = (v: number) => Math.round(v);

    // Verified July 2026 golden values — Production Required (PCS) per category.
    // Source: Daily Production PLUMBING master Excel per-material tabs.
    //   CPVC tab → col O header "PRODUCTION REQUIRED FOR Jul26 (PCS)"
    //   UPVC tab → col Q header "PRODUCTION REQUIRED FOR Jul26 (PCS)"
    //   SWR  tab → col S header "PRODUCTION REQUIRED FOR Jul26 (PCS)"
    //   AGRI tab → col S header "PRODUCTION REQUIRED FOR Jul26 (PCS)"
    // Grand total = 1,905,228 pcs (matches Pipe Summary management tab).
    // All 9 categories carry real plan quantities — none may be zero.
    const PLUMBING_GOLDEN: Array<{ cat: string; expected: number }> = [
      { cat: "CPVC Pipe",    expected: 130451 },
      { cat: "CPVC Fitting", expected: 763253 },
      { cat: "UPVC Pipe",    expected: 51899  },
      { cat: "UPVC Fitting", expected: 633038 },
      { cat: "SWR Pipe",     expected: 64515  },
      { cat: "SWR Fitting",  expected: 236315 },
      { cat: "SWR Solvent",  expected: 1255   },
      { cat: "AGRI Pipe",    expected: 9688   },
      { cat: "AGRI Fitting", expected: 14814  },
    ];

    const checks: CheckResult[] = PLUMBING_GOLDEN.map(({ cat, expected }) => {
      const actual = roundInt(byCategory.get(cat) ?? 0);
      return { name: `${cat} Production Required`, expected, actual, pass: actual === expected };
    });

    // Full category totals map for display (keyed by category name, rounded pcs)
    const categoryTotals: Record<string, number> = {};
    for (const [cat, total] of byCategory.entries()) {
      categoryTotals[cat] = roundInt(total);
    }
    for (const { cat } of PLUMBING_GOLDEN) {
      if (!(cat in categoryTotals)) categoryTotals[cat] = 0;
    }

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

  res.json({ month, segment, allPass, passCount: checks.length - failCount, failCount, checks });
});

export default router;
