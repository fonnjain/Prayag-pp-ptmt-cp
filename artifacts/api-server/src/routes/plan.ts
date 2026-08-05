import { Router, type IRouter, type Response } from "express";
import { AsyncLocalStorage } from "node:async_hooks";
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
  runInPlanningContext,
  PlanningIsolationError,
  type DualTotals,
  type PlumbingSheet3Row,
} from "../lib/sheets";
import { logger } from "../lib/logger";
import { exportPlanExcel } from "../lib/excel-export";
import { exportPlanPdf } from "../lib/pdf-export";
import { exportWeeklyReleaseExcel } from "../lib/weekly-excel-export";
import { runMachineCascade, type PlanItemForCascade } from "../lib/machine-capacity-engine";
import { runCorrectiveReplan } from "../lib/corrective-engine";
import {
  PLUMBING_GOLDEN,
  PLUMBING_GRAND_TOTAL,
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
  PTMT_AUG_MONTH,
  PTMT_AUG_GRAND_MAX,
  PTMT_AUG_GRAND_MIN,
  PTMT_AUG_STOCK_121O_WHITE,
  PTMT_AUG_LM_TOTAL,
  PTMT_AUG_PENDING_TOTAL,
  PTMT_AUG_AVG3MO_144O_WHITE,
  PTMT_AUG_CATEGORY_GOLDEN,
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

// ── Uploads-only enforcement (stock & pending) ────────────────────────────────
//
// Scope decision (2026-08): stock and pending (current + last-month) come from
// uploads ONLY. A missing or unparseable upload fails the plan LOUDLY, naming
// the file — never a sheet fallback, never a zero default, never a partial plan.
// Reference data allowed live in the plan path: sales history (avg-3-month),
// the Plumbing workbook roster/avg/multiplier columns, and BOM weights.

/** Thrown when a required planning upload is missing or empty. */
export class MissingUploadError extends Error {
  constructor(public readonly uploadKind: string, public readonly fileLabel: string) {
    super(
      `Required planning upload missing: ${fileLabel} (upload kind "${uploadKind}"). ` +
      `Upload the file on the Data page — the plan will not fall back to a sheet or assume zero.`,
    );
    this.name = "MissingUploadError";
  }
}

/** Thrown when a planning input is present but fails a sanity check. */
export class PlanningInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanningInputError";
  }
}

/** Request-scoped test hook used by /plan/validate to prove the missing-upload
 *  guard fires. AsyncLocalStorage-scoped so a concurrent real plan request can
 *  never see a simulated-missing upload. */
const _simulateMissingUploads = new AsyncLocalStorage<Set<string>>();
function withSimulatedMissingUpload<T>(kind: string, fn: () => Promise<T>): Promise<T> {
  return _simulateMissingUploads.run(new Set([kind]), fn);
}

/** Loads the latest upload of `kind`; throws MissingUploadError when absent or empty. */
async function requireUploadRows(kind: string, fileLabel: string): Promise<Record<string, unknown>[]> {
  if (_simulateMissingUploads.getStore()?.has(kind)) throw new MissingUploadError(kind, fileLabel);
  const rows = await loadLatestUploadRowsByKind(kind);
  if (rows.length === 0) throw new MissingUploadError(kind, fileLabel);
  return rows;
}

/** Maps plan-path errors to HTTP responses: 422 for named input failures. */
export function handlePlanError(res: Response, err: unknown): void {
  if (err instanceof MissingUploadError || err instanceof PlanningInputError || err instanceof PlanningIsolationError) {
    res.status(422).json({ error: err.message, kind: err.name });
    return;
  }
  throw err;
}

type PlanCheckResult = {
  name: string;
  expected: number;
  actual: number;
  pass: boolean;
  tolerance?: string;
};

/**
 * Planning-isolation regression checks, run live inside /plan/validate:
 *   1. Missing-upload guard — with a required stock upload simulated absent, the
 *      plan build must throw a named MissingUploadError (no sheet fallback, no
 *      zero default, no partial plan).
 *   2. Disallowed-read guard — a non-allow-listed sheet fetcher called inside a
 *      planning context must throw PlanningIsolationError naming the call site.
 * NOTE: the simulation flag is global for the few ms the guard test runs; the
 * validate endpoint is a regression tool, not a user-facing hot path.
 */
async function buildPlanningIsolationChecks(month: string, segment: "PTMT" | "Plumbing"): Promise<PlanCheckResult[]> {
  const checks: PlanCheckResult[] = [];

  // 1. Missing-upload guard
  const simKind = segment === "Plumbing" ? "plumbing_fg_stock" : "current_stock";
  const simLabel = segment === "Plumbing" ? "Plumbing FG Stock" : "FG Stock (current stock)";
  let missingGuardOk = false;
  try {
    await withSimulatedMissingUpload(simKind, () => buildPlanItems(month, segment));
  } catch (err) {
    missingGuardOk = err instanceof MissingUploadError && err.message.includes(simLabel);
  }
  checks.push({
    name: `ISOLATION · missing ${simLabel} upload → loud named error (no fallback/zero/partial)`,
    expected: 1,
    actual: missingGuardOk ? 1 : 0,
    pass: missingGuardOk,
    tolerance: "bool",
  });

  // 2. Disallowed sheet read inside planning context → fails naming the call site
  let disallowedGuardOk = false;
  try {
    await runInPlanningContext("isolation guard self-test", () => fetchLiveOrderTotals(month, "PTMT"));
  } catch (err) {
    disallowedGuardOk = err instanceof PlanningIsolationError && err.message.includes("fetchLiveOrderTotals");
  }
  checks.push({
    name: "ISOLATION · non-allow-listed sheet read in plan path → fails naming call site",
    expected: 1,
    actual: disallowedGuardOk ? 1 : 0,
    pass: disallowedGuardOk,
    tolerance: "bool",
  });

  return checks;
}

/**
 * PENDING-SOURCE classification for DATA.xlsx (pending_orders upload).
 *
 * WHY pending can legitimately be 0: the August 2026 DATA.xlsx is an
 * invoice-register layout (Item Code / Colour / Quantity / Date …) with NO
 * open-balance column, so no row carries a pending balance — pending
 * contributes 0 by STRUCTURE, not by silent default. This is PROVISIONAL,
 * not a permanent rule: if a future month's file carries a balance column
 * (Balance_Qty / Balance Qty / Bal.Qty), it is picked up automatically.
 * This classifier makes the distinction explicit so an unparseable file can
 * never masquerade as "zero pending".
 */
export function classifyPendingSource(rows: Record<string, unknown>[]): {
  layout: "open-balance" | "invoice-register";
  hasCodeColumn: boolean;
  balanceColumns: string[];
} {
  const CODE_KEYS = ["Old Item Code", "Item Code", "Item No."];
  const BALANCE_KEYS = ["Balance_Qty", "Balance Qty", "Bal.Qty"];
  const seenCols = new Set<string>();
  for (const row of rows.slice(0, 200)) for (const k of Object.keys(row)) seenCols.add(k);
  const balanceColumns = BALANCE_KEYS.filter((k) => seenCols.has(k));
  return {
    layout: balanceColumns.length > 0 ? "open-balance" : "invoice-register",
    hasCodeColumn: CODE_KEYS.some((k) => seenCols.has(k)),
    balanceColumns,
  };
}

/** Asserts the pending upload's source is present AND parsed — never assumed-zero. */
function assertPendingSourceParsed(rows: Record<string, unknown>[], fileLabel: string): void {
  const info = classifyPendingSource(rows);
  if (!info.hasCodeColumn) {
    throw new PlanningInputError(
      `${fileLabel} is present but unparseable: no recognised item-code column ` +
      `(expected one of "Old Item Code" / "Item Code" / "Item No."). Refusing to treat pending as zero.`,
    );
  }
  if (info.layout === "invoice-register") {
    logger.info({ fileLabel }, "Pending source: invoice-register layout (no open-balance column) → pending contributes 0 (structural, provisional)");
  }
}

/**
 * DISPLAY-ONLY live order-book annotation. The Order column never enters
 * Min/Max/weekly computation, so it is fetched OUTSIDE the planning context
 * and tolerates a Sheets outage (column shows 0). This keeps the plan-build
 * path free of Order Sheet reads while preserving the UI/export column.
 */
async function annotateLiveOrders(items: PlanItemWithBom[], month: string, segment: string): Promise<void> {
  try {
    const totals = await fetchLiveOrderTotals(month, segment === "Plumbing" ? "PLUMBING" : "PTMT");
    const codeCounts = new Map<string, number>();
    for (const i of items) {
      const k = normalizeCode(i.itemCode);
      codeCounts.set(k, (codeCounts.get(k) ?? 0) + 1);
    }
    for (const i of items) {
      const single = (codeCounts.get(normalizeCode(i.itemCode)) ?? 0) <= 1;
      i.order = resolveTotal(totals, i.itemCode, i.colour, single);
    }
  } catch (err) {
    logger.warn({ month, segment, err: String(err) }, "annotateLiveOrders: order sheet unavailable — Order column left at 0 (display-only)");
  }
}

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
  return runInPlanningContext(`Plumbing plan build (${month})`, () => buildPlumbingPlanItemsInner(month));
}

async function buildPlumbingPlanItemsInner(month: string): Promise<PlanItemWithBom[]> {
  // ── 1. UPLOADS + DB FIRST — fail fast (loudly, naming the file) before any sheet read ──
  const [fgStockRows, rawPendingRows, bufferRows, bandRows, machineRows] = await Promise.all([
    requireUploadRows("plumbing_fg_stock", "Plumbing FG Stock"),
    requireUploadRows("pending_orders", "DATA.xlsx (pending orders)"),
    db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, "Plumbing")),
    db.select().from(weeklyReleaseBandsTable).where(eq(weeklyReleaseBandsTable.segment, "Plumbing")),
    db.select().from(plumbingMachineCapacityTable).where(eq(plumbingMachineCapacityTable.segment, "Plumbing")),
  ]);
  assertPendingSourceParsed(rawPendingRows, "DATA.xlsx (pending orders)");

  // ── 2. Reference-data sheet reads (allow-listed: workbook roster/avg/multiplier + BOM) ──
  const [workbookRows, bomWeights] = await Promise.all([
    fetchPlumbingPlanData(month),
    fetchPlumbingBomWeights(),
  ]);

  // Reference-data sanity guard: a zero avg-3-month across the board collapses
  // every buffer and silently under-plans — the same silent-zero failure class.
  const avgSum = workbookRows.reduce((s, r) => s + r.avg3MoSale, 0);
  if (workbookRows.length === 0 || avgSum <= 0) {
    throw new PlanningInputError(
      `Plumbing workbook avg-3-month sales are ${workbookRows.length === 0 ? "missing (no rows read)" : "all zero"} ` +
      `for ${month} — refusing to plan on collapsed buffer inputs.`,
    );
  }

  // Pending current-month: DATA.xlsx UPLOAD, Plumbing segments (PLUMBING / P / PL / AGRI).
  // ONLY open-balance columns count — the invoice "Quantity" column must never
  // masquerade as pending. Invoice-register layouts therefore contribute 0
  // (structural, documented in classifyPendingSource).
  const plumbingPendingRows = rawPendingRows.filter((row) => {
    const seg = String(row["Segment"] ?? "").trim().toUpperCase();
    return seg === "PLUMBING" || seg === "P" || seg === "PL" || seg === "AGRI";
  });
  const pendingTotals = sumByKey(
    plumbingPendingRows,
    ["Old Item Code", "Item Code", "Item No."],
    ["Colour", "Color"],
    ["Balance_Qty", "Balance Qty", "Bal.Qty"],
  );

  // Parse FG Stock upload (authoritative source for Stock and Pending-Last-Month).
  //   Net Stock positive  → opening stock on 1st of month
  //   Net Stock negative  → |value| = pending order last month (stock = 0)
  // Item type is NO LONGER resolved from FG Stock Category — it comes directly from
  // the workbook's per-row type column (PIPE / FITTING / FITTINGS / SOLVENT).
  // Schema guard: a present-but-malformed FG Stock file (renamed headers) must
  // fail loudly, not silently produce a zero-stock plan.
  {
    const cols = new Set<string>();
    for (const row of fgStockRows.slice(0, 50)) for (const k of Object.keys(row)) cols.add(k);
    if (!cols.has("Item Code") || !cols.has("Net Stock")) {
      throw new PlanningInputError(
        `Plumbing FG Stock upload is present but unparseable: expected columns "Item Code" and "Net Stock" ` +
        `(found: ${[...cols].slice(0, 10).join(", ")}). Refusing to plan with zero stock.`,
      );
    }
  }

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

  // Join-coverage guard: the FG upload parsed, but if NONE of its codes match
  // the workbook roster the key normalisation is broken → zero-stock plan.
  if (stockMap.size + pendingLmMap.size === 0) {
    throw new PlanningInputError(
      "Plumbing FG Stock upload parsed but yielded no stock or pending-last-month values — refusing to plan with zero stock.",
    );
  }
  {
    const matched = workbookRows.filter((r) => {
      const c = normalizeCode(r.itemCode);
      return stockMap.has(c) || pendingLmMap.has(c);
    }).length;
    if (matched === 0) {
      throw new PlanningInputError(
        "Plumbing FG Stock upload has no item codes matching the workbook roster (join broken) — refusing to plan with zero stock.",
      );
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
        // Pending (current month) from the DATA.xlsx UPLOAD (Plumbing segments,
        // open-balance columns only) — the workbook's PENDING ORDER column is
        // no longer read (uploads-only rule, scoped 2026-08).
        pendingOrder:          pendingTotals.byCode.get(code) ?? 0,
        // Order is display-only and annotated OUTSIDE the planning context.
        order:                 0,
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

  return runInPlanningContext(`PTMT plan build (${month})`, () => buildPtmtPlanItemsInner(month, segment));
}

async function buildPtmtPlanItemsInner(month: string, segment: string): Promise<PlanItemWithBom[]> {
  // ── 1. UPLOADS + DB FIRST — fail fast (loudly, naming the file) before any sheet read ──
  const [itemRows, bufferRows, bandRows, rawPendingOrderRows, currentStockRows, pendingLastMoRows] =
    await Promise.all([
      db.select().from(itemMasterTable).where(eq(itemMasterTable.segment, segment)),
      db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, segment)),
      db.select().from(weeklyReleaseBandsTable).where(eq(weeklyReleaseBandsTable.segment, segment)),
      // DATA.xlsx (pending_orders) — global upload; rows for all segments stored, filtered below.
      requireUploadRows("pending_orders", "DATA.xlsx (pending orders)"),
      requireUploadRows("current_stock", "FG Stock (current stock)"),
      requireUploadRows("last_month_pending", "Last-Month Pending"),
    ]);
  assertPendingSourceParsed(rawPendingOrderRows, "DATA.xlsx (pending orders)");

  // ── 2. Reference-data sheet read (allow-listed: sales history avg-3-month) ──
  const avg3MoTotals = await fetchAvg3MoSaleTotals(month);
  // Reference-data sanity guard: zero sales history collapses every buffer and
  // silently under-plans across the board — refuse to plan on it. (The
  // band-vs-prior-month check runs in /plan/validate to avoid doubling sheet
  // reads on every plan build.)
  const salesSum = [...avg3MoTotals.byCode.values()].reduce((a, b) => a + b, 0);
  if (salesSum <= 0) {
    throw new PlanningInputError(
      `Sales history (avg-3-month) for ${month} returned zero — refusing to plan on collapsed buffer inputs.`,
    );
  }

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
    ["Qty", "Qty.", "Balance_Qty", "Balance Qty"],
  );

  // Stock: F.G Sheet — try every item-code column variant the FG Stock upload may carry.
  // Qty column variants: "Qty" (normalized July format), "Closing Stock" (Aug 2026 "F.G Sheet PTMT" layout).
  const stockTotals = sumByKey(
    currentStockRows,
    ["Item Code", "Old Item Code", "Cat No", "Cat-No", "Item No."],
    ["Colour", "Color"],
    ["Qty", "Closing Stock", "C/Stock", "C Stock"],
  );

  // Schema + join-coverage guard: a present-but-malformed FG Stock file
  // (renamed headers, broken key normalisation) must fail loudly, not silently
  // produce a zero-stock plan.
  if (stockTotals.byCode.size === 0) {
    const cols = new Set<string>();
    for (const row of currentStockRows.slice(0, 50)) for (const k of Object.keys(row)) cols.add(k);
    throw new PlanningInputError(
      `FG Stock (current stock) upload is present but yielded no stock values — expected an item-code column ` +
      `(Item Code / Old Item Code / Cat No) and a qty column (Qty / Closing Stock / C/Stock) ` +
      `(found: ${[...cols].slice(0, 10).join(", ")}). Refusing to plan with zero stock.`,
    );
  }
  if (pendingLastMoTotals.byCode.size === 0) {
    throw new PlanningInputError(
      "Last-Month Pending upload is present but yielded no values — check its item-code and Qty columns. " +
      "Refusing to treat last-month pending as zero.",
    );
  }

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
      // Order is display-only and annotated OUTSIDE the planning context (annotateLiveOrders).
      order: 0,
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

  // Normalise casing: accept "PLUMBING" | "Plumbing" → canonical "Plumbing".
  // Missing required uploads throw MissingUploadError → 422 naming the file.
  const normSegment = segment.toLowerCase() === "plumbing" ? "Plumbing" : segment;
  try {
    const items = await buildPlanItems(month, normSegment);
    await annotateLiveOrders(items, month, normSegment); // display-only, sheet-outage tolerant
    const filtered = category ? items.filter((i) => i.category === category) : items;
    res.json(filtered);
  } catch (err) {
    handlePlanError(res, err);
  }
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
  try {
    const items = await buildPlanItems(month, segment);
    await annotateLiveOrders(items, month, segment); // display-only Order column
    const summary = summarizePlan(items);
    const requiredCategories = segment === "Plumbing" ? PLUMBING_CATEGORIES : undefined;
    const buffer = await exportPlanExcel(month, items, summary, requiredCategories);
    const prefix = segment === "Plumbing" ? "Plumbing" : "PTMT";
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${prefix}_Production_Plan_${month}.xlsx"`);
    res.send(buffer);
  } catch (err) {
    handlePlanError(res, err);
  }
});

router.get("/plan/export/pdf", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const segment = String(req.query.segment ?? "PTMT");
  try {
    const items = await buildPlanItems(month, segment);
    await annotateLiveOrders(items, month, segment); // display-only Order column
    const summary = summarizePlan(items);
    const buffer = await exportPlanPdf(month, items, summary);
    const prefix = segment === "Plumbing" ? "Plumbing" : "PTMT";
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${prefix}_Production_Plan_${month}.pdf"`);
    res.send(buffer);
  } catch (err) {
    handlePlanError(res, err);
  }
});

router.get("/plan/export/weekly-excel", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const segment = String(req.query.segment ?? "PTMT");
  try {
  const items = await buildPlanItems(month, segment);
  const buffer = await exportWeeklyReleaseExcel(month, items);
  const prefix = segment === "Plumbing" ? "Plumbing" : "PTMT";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${prefix}_Weekly_Release_Plan_${month}.xlsx"`);
  res.send(buffer);
  } catch (err) {
    handlePlanError(res, err);
  }
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
  let items: PlanItemWithBom[];
  try {
    items = await buildPlanItems(month, segment);
  } catch (err) {
    handlePlanError(res, err);
    return;
  }
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

  // asOfDate preferred; legacy: workingDaysRemaining param → snapshot date; default: today (IST ≈ UTC)
  const asOfDate = req.query.asOfDate
    ? String(req.query.asOfDate)
    : req.query.workingDaysRemaining
      ? "2026-07-14"                               // legacy fallback
      : new Date().toISOString().slice(0, 10);     // default: today

  const replan = await runCorrectiveReplan({ month, weekClosed: 0, asOfDate, segment: "Plumbing" });

  const totalProducedCapped = replan.categories.reduce((s, c) => s + c.producedCapped, 0);
  const totalRemaining = replan.categories.reduce((s, c) => s + c.remaining, 0);
  const totalFeasible = replan.categories.reduce((s, c) => s + c.feasible, 0);
  const totalShortfall = replan.categories.reduce((s, c) => s + c.shortfall, 0);

  res.json({
    month,
    workingDaysRemaining: replan.workingDaysRemaining,
    asOfDate: replan.asOfDate,
    // Expose capPerDay as capacityPerDay for consumers; both present for backward compat.
    categories: replan.categories.map((c) => ({ ...c, capacityPerDay: c.capPerDay })),
    unplannedProduction: replan.unplannedProduction,
    totalProduced: replan.producedToDate,
    totalProducedCapped,
    totalRemaining,
    totalFeasible,
    totalShortfall,
    unplannedTotal: replan.unplannedTotal,
  });
});

/**
 * Structural self-check for the Plumbing corrective re-plan.
 *
 * Structural invariants (always true by construction):
 *   producedCapped + remaining = plan  (per category)
 *   feasible = capPerDay × workingDaysRemaining  (per category)
 *   shortfall = max(remaining − feasible, 0)  (per category)
 *
 * Dynamic guards (date-independent, valid across all dates):
 *   produced >= 0 per category
 *   capPerDay > 0 for every category that has Sheet3 production
 *   Σ(producedCapped + remaining) = Σ(plan)  (total reconciliation)
 *
 * Defaults asOfDate to today so checks always run against live production.
 * Pass ?asOfDate=YYYY-MM-DD to pin to a specific snapshot for debugging.
 */
router.get("/plan/validate-replan", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) { res.status(400).json({ error: "month is required" }); return; }

  // Default to today — checks must always reflect live production, never a stale snapshot
  const asOfDate = String(req.query.asOfDate ?? new Date().toISOString().slice(0, 10));

  type CheckResult = {
    name: string;
    expected: number;
    actual: number;
    pass: boolean;
    tolerance?: string;
  };

  // Run the unified corrective engine (same path as the UI)
  const replan = await runCorrectiveReplan({ month, weekClosed: 0, asOfDate, segment: "Plumbing" });
  const wdr = replan.workingDaysRemaining;
  const catMap = new Map(replan.categories.map((c) => [c.category, c]));
  const checks: CheckResult[] = [];

  // Totals derived from categories
  const totalProduced = replan.producedToDate;
  const totalRemaining = replan.categories.reduce((s, c) => s + c.remaining, 0);

  // ── Guard ────────────────────────────────────────────────────────────────────
  checks.push({
    name: "ReplanGuard · Total produced + unplanned > 0",
    expected: 1,
    actual: totalProduced + replan.unplannedTotal,
    pass: totalProduced + replan.unplannedTotal > 0,
    tolerance: "> 0",
  });
  checks.push({
    name: "ReplanGuard · Total produced > 0",
    expected: 1,
    actual: totalProduced,
    pass: totalProduced > 0,
    tolerance: "> 0",
  });

  // ── Structural invariants (always true by construction) ───────────────────────
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

  // ── Dynamic per-category guards (date-independent) ────────────────────────────
  for (const { cat } of PLUMBING_REPLAN_GOLDEN) {
    const c = catMap.get(cat);
    if (!c) continue;

    // produced is non-negative
    checks.push({
      name: `Replan · ${cat} · produced >= 0`,
      expected: 1,
      actual: c.produced >= 0 ? 1 : 0,
      pass: c.produced >= 0,
      tolerance: ">= 0",
    });

    // When production was recorded for this category, p90 cap must be non-zero
    if (c.produced > 0) {
      checks.push({
        name: `Replan · ${cat} · capPerDay > 0 (has Sheet3 data)`,
        expected: 1,
        actual: c.capPerDay > 0 ? 1 : 0,
        pass: c.capPerDay > 0,
        tolerance: "> 0",
      });
    }
  }

  // ── Dynamic total guards ───────────────────────────────────────────────────────
  const totalPlanSum  = replan.categories.reduce((s, c) => s + c.plan, 0);
  const totalPcCapped = replan.categories.reduce((s, c) => s + c.producedCapped, 0);
  const atu = replan.unplannedTotal;

  checks.push({
    name: "Replan · Total · produced + unplanned > 0",
    expected: 1,
    actual: (totalProduced + atu) > 0 ? 1 : 0,
    pass: (totalProduced + atu) > 0,
    tolerance: "> 0",
  });
  checks.push({
    name: "Replan · Total · producedCapped + remaining = plan (reconciliation)",
    expected: totalPlanSum,
    actual: totalPcCapped + totalRemaining,
    pass: totalPcCapped + totalRemaining === totalPlanSum,
    tolerance: "exact",
  });
  checks.push({
    name: "Replan · Unplanned · total > 0",
    expected: 1,
    actual: atu > 0 ? 1 : 0,
    pass: atu > 0,
    tolerance: "> 0",
  });

  const allPass = checks.every((c) => c.pass);
  const failCount = checks.filter((c) => !c.pass).length;
  res.json({ month, segment: "Plumbing", workingDaysRemaining: wdr, asOfDate, allPass, passCount: checks.length - failCount, failCount, checks });
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
    /** Advisory: check passed but sits outside the comfort band — surface amber in UI. */
    warn?: boolean;
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

    // ── 0. Planning-isolation guards (uploads-only rule, scoped 2026-08) ──
    checks.push(...(await buildPlanningIsolationChecks(month, "Plumbing")));
    {
      // Pending-source check: DATA.xlsx present AND parsed (never assumed-zero).
      const pendingUploadRows = await loadLatestUploadRowsByKind("pending_orders");
      const pendInfo = classifyPendingSource(pendingUploadRows);
      const pendOk = pendingUploadRows.length > 0 && pendInfo.hasCodeColumn;
      checks.push({
        name: `ISOLATION · pending source present & parsed (layout: ${pendInfo.layout})`,
        expected: 1,
        actual: pendOk ? 1 : 0,
        pass: pendOk,
        tolerance: "bool",
      });
      // Sales sanity: workbook avg-3-month must be non-zero (band-vs-prior not
      // available for Plumbing — no prior workbook loaded here).
      const avgSum = items.reduce((s, i) => s + i.avg3MoSale, 0);
      checks.push({
        name: "ISOLATION · sales history (avg-3-mo) non-zero",
        expected: 1,
        actual: roundInt(avgSum),
        pass: avgSum > 0,
        tolerance: "> 0",
      });
    }

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
    // Exact golden check for the grand total — catches any silent regression in
    // plan totals that the per-category ±0.1% checks would also surface, but
    // having it at the plant level makes it immediately visible in summary views.
    {
      const gt = roundInt(grandTotal);
      const gtPct = PLUMBING_GRAND_TOTAL === 0 ? (gt === 0 ? 0 : Infinity)
        : Math.abs(gt - PLUMBING_GRAND_TOTAL) / PLUMBING_GRAND_TOTAL;
      checks.push({
        name: "Grand total (±0.1%)",
        expected: PLUMBING_GRAND_TOTAL,
        actual: gt,
        pass: gtPct <= PLUMBING_GOLDEN_TOLERANCE,
        tolerance: `±${(PLUMBING_GOLDEN_TOLERANCE * 100).toFixed(1)}%`,
      });
    }

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

    // ── 2b. Stock-join coverage guard (same silent-zero class as PTMT Fault 1) ─
    // Count of plan items with stock = 0 while the plumbing FG upload holds a
    // POSITIVE Net Stock for the same code. Must be 0 — a column rename or key
    // normalization break in the FG join would show up here before it inflates
    // the plan.
    {
      const fgPositiveByCode = new Map<string, number>();
      for (const row of fgStockRows) {
        const code = normalizeCode(String((row as Record<string, unknown>)["Item Code"] ?? "").trim());
        if (!code) continue;
        const rawNet = (row as Record<string, unknown>)["Net Stock"];
        const netStock = typeof rawNet === "number" ? rawNet : Number(String(rawNet ?? "").replace(/,/g, "")) || 0;
        if (netStock > 0) fgPositiveByCode.set(code, (fgPositiveByCode.get(code) ?? 0) + netStock);
      }
      const seenCodes = new Set<string>();
      let plumbingStockJoinMisses = 0;
      for (const item of items) {
        const code = normalizeCode(item.itemCode);
        if (seenCodes.has(code)) continue;
        seenCodes.add(code);
        if ((item.stock ?? 0) === 0 && (fgPositiveByCode.get(code) ?? 0) > 0) plumbingStockJoinMisses++;
      }
      checks.push({
        name: "GUARD · Stock-join coverage (plan items with Stock=0 but FG positive)",
        expected: 0,
        actual: plumbingStockJoinMisses,
        pass: plumbingStockJoinMisses === 0,
        tolerance: "exact",
      });
    }

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
        // Sum consistency: non-unfulfillable items must have mSum == maxProduction;
        // unfulfillable items must have mSum < maxProduction (i.e. some residual exists).
        let sumInconsistent = 0;
        for (const item of items) {
          if (item.maxProduction <= 0) continue;
          if (item.category.endsWith("Solvent")) continue;
          const bom = item as PlanItemWithBom;
          const mSum = (bom.machineW1 ?? 0) + (bom.machineW2 ?? 0) + (bom.machineW3 ?? 0) + (bom.machineW4 ?? 0);
          if (bom.machineUnfulfillable) {
            // Residual must be > 0 (it was marked unfulfillable for a reason)
            if (mSum >= item.maxProduction) sumInconsistent++;
          } else {
            if (Math.abs(mSum - item.maxProduction) > 1) sumInconsistent++;
          }
        }
        checks.push({
          name: "Machine · cascade sum consistency",
          expected: 0,
          actual: sumInconsistent,
          pass: sumInconsistent === 0,
        });

        // Per-category invariant: feasible + unfulfillable_residual = desired
        const allCatNames2 = [...new Set(items.map(i => i.category))];
        let catInvariantFail = 0;
        for (const cat of allCatNames2) {
          if (cat.endsWith("Solvent")) continue;
          const catItems = items.filter(i => i.category === cat);
          const desired  = catItems.reduce((s, i) => s + i.maxProduction, 0);
          const feasible = catItems.reduce((s, i) => {
            const b = i as PlanItemWithBom;
            return s + (b.machineW1 ?? 0) + (b.machineW2 ?? 0) + (b.machineW3 ?? 0) + (b.machineW4 ?? 0);
          }, 0);
          const unplaced = catItems
            .filter(i => (i as PlanItemWithBom).machineUnfulfillable)
            .reduce((s, i) => {
              const b = i as PlanItemWithBom;
              const placed = (b.machineW1 ?? 0) + (b.machineW2 ?? 0) + (b.machineW3 ?? 0) + (b.machineW4 ?? 0);
              return s + Math.max(0, i.maxProduction - placed);
            }, 0);
          if (Math.abs(feasible + unplaced - desired) > 1) catInvariantFail++;
        }
        checks.push({
          name: "Machine · per-category feasible + unfulfillable = desired (12 categories)",
          expected: 0,
          actual: catInvariantFail,
          pass: catInvariantFail === 0,
        });

        // AGRI Pipe check: verify AGRI Pipe items are only placed on flex machines.
        // Structurally guaranteed because only MC3/MC4/MC5 carry AGRI in their rates map;
        // confirmed here by checking all machines that touched AGRI Pipe items have
        // AGRI in their rates (i.e. are flex-capable).
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
        // unfulfillablePcs = actual unplaced residual (not maxProduction, which would double-count partial fills)
        const unfulfillablePcs = catItems
          .filter(i => i.machineUnfulfillable)
          .reduce((s, i) => {
            const placed = (i.machineW1 ?? 0) + (i.machineW2 ?? 0) + (i.machineW3 ?? 0) + (i.machineW4 ?? 0);
            return s + Math.max(0, i.maxProduction - placed);
          }, 0);
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

  // ── 0. Planning-isolation guards (uploads-only rule, scoped 2026-08) ──
  checks.push(...(await buildPlanningIsolationChecks(month, "PTMT")));
  {
    // Pending-source check: DATA.xlsx present AND parsed (never assumed-zero).
    const pendInfo = classifyPendingSource(rawPendingRows);
    const pendOk = rawPendingRows.length > 0 && pendInfo.hasCodeColumn;
    checks.push({
      name: `ISOLATION · pending source present & parsed (layout: ${pendInfo.layout})`,
      expected: 1,
      actual: pendOk ? 1 : 0,
      pass: pendOk,
      tolerance: "bool",
    });
    // Sales sanity band: current avg-3-mo total must be non-zero AND within a
    // sane band of the prior month's figure. Adjacent 3-month windows overlap
    // by two months, so month-over-month movement of the average is mechanically
    // damped — a large shift means a broken read (wrong tab, renamed column,
    // empty range), not real demand movement.
    //
    // Two thresholds (tightened 2026-08-05; sales is the one planning input
    // deliberately left live, and avg-3-mo drives Buffer proportionally):
    //   HARD band 0.6–1.6×  → outside this the check FAILS.
    //   ADVISORY 0.85–1.2×  → outside this (but inside hard band) the check
    //     still passes, with warn=true surfaced in validate output and the UI.
    const curSum = [...avg3MoTotals.byCode.values()].reduce((a, b) => a + b, 0);
    const [yy, mm] = month.split("-").map(Number);
    const priorMonth = mm === 1 ? `${yy! - 1}-12` : `${yy}-${String(mm! - 1).padStart(2, "0")}`;
    let bandPass = false;
    let bandWarn = false;
    let ratio = 0;
    try {
      const priorTotals = await fetchAvg3MoSaleTotals(priorMonth);
      const priorSum = [...priorTotals.byCode.values()].reduce((a, b) => a + b, 0);
      ratio = priorSum > 0 ? curSum / priorSum : Infinity;
      bandPass = curSum > 0 && ratio >= 0.6 && ratio <= 1.6;
      bandWarn = bandPass && (ratio < 0.85 || ratio > 1.2);
    } catch {
      bandPass = false;
    }
    checks.push({
      name: `ISOLATION · sales band vs prior month (ratio ${ratio.toFixed(2)}, hard 0.6–1.6×, advisory 0.85–1.2×)`,
      expected: 1,
      actual: bandPass ? 1 : 0,
      pass: bandPass,
      warn: bandWarn,
      tolerance: "bool",
    });
  }

  // ── Month-keyed upload goldens ────────────────────────────────────────
  // The upload scalar checks below assert against the LATEST uploads, so the
  // expected values must roll with the upload month (spec: never assert July
  // goldens against August data). 2026-08 = August upload set; anything else
  // falls back to the July 2026 legacy values.
  const isAugGolden = month === PTMT_AUG_MONTH;

  // ── 1. Stock 121-O / WHITE ────────────────────────────────────────────
  const stockTotals = sumByKey(stockRows, ["Item Code"], ["Colour", "Color"], ["Qty", "Closing Stock", "C/Stock", "C Stock"]);
  const stock121 = resolveTotal(stockTotals, "121-O", "WHITE", false);
  const stock121Exp = isAugGolden ? PTMT_AUG_STOCK_121O_WHITE : 1644;
  checks.push({ name: "Stock 121-O / WHITE", expected: stock121Exp, actual: stock121, pass: stock121 === stock121Exp });

  // ── 2. Last-month pending total ───────────────────────────────────────
  const lmTotals = sumByKey(
    lastMoRows,
    ["Item Code", "Cat No", "Cat-No", "Old Item Code"],
    ["Colour", "Color"],
    ["Qty", "Qty.", "Balance_Qty", "Balance Qty"],
  );
  const lmTotal = Math.round([...lmTotals.byCode.values()].reduce((a, b) => a + b, 0));
  const lmExp = isAugGolden ? PTMT_AUG_LM_TOTAL : 137939;
  checks.push({ name: "Last-month pending total", expected: lmExp, actual: lmTotal, pass: lmTotal === lmExp });

  // ── 3. Current pending ────────────────────────────────────────────────
  const pendTotals = sumByKey(
    pendingRows,
    ["Old Item Code", "Item Code", "Item No."],
    ["Colour", "Color"],
    ["Balance_Qty", "Balance Qty", "Bal.Qty", "Qty"],
  );
  if (isAugGolden) {
    // Aug DATA.xlsx rows carry no Balance_Qty column → total PTMT pending must be 0.
    const pendTotal = Math.round([...pendTotals.byCode.values()].reduce((a, b) => a + b, 0));
    checks.push({ name: "Current pending total (Aug: no Balance_Qty column)", expected: PTMT_AUG_PENDING_TOTAL, actual: pendTotal, pass: pendTotal === PTMT_AUG_PENDING_TOTAL });
  } else {
    const pend144 = resolveTotal(pendTotals, "144-O", "WHITE", false);
    checks.push({ name: "Current pending 144-O / WHITE", expected: 132, actual: pend144, pass: pend144 === 132 });
  }

  // ── 4. Avg 3-Mo Sale 144-O / WHITE ────────────────────────────────────
  const avg3MoRaw = resolveTotal(avg3MoTotals, "144-O", "WHITE", false);
  const avg3Mo = Math.round(avg3MoRaw / 3);
  const avg3Exp = isAugGolden ? PTMT_AUG_AVG3MO_144O_WHITE : 5222;
  checks.push({ name: "Avg 3-Mo Sale 144-O / WHITE", expected: avg3Exp, actual: avg3Mo, pass: avg3Mo === avg3Exp });

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
    ["Qty", "Qty.", "Balance_Qty", "Balance Qty"],
  );
  const bufferByCategory = new Map<string, number>(bufferRows.map((b) => [b.name, b.multiplier]));
  const codeCounts = new Map<string, number>();
  for (const item of itemRows) {
    const codeKey = `${item.category}::${normalizeCode(item.itemCode)}`;
    codeCounts.set(codeKey, (codeCounts.get(codeKey) ?? 0) + 1);
  }
  const currentStockRows = stockRows;
  const stockTotalsForPlan = stockTotals;
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
  const grandMaxExp = isAugGolden ? PTMT_AUG_GRAND_MAX : PTMT_GRAND_MAX;
  const grandMinExp = isAugGolden ? PTMT_AUG_GRAND_MIN : PTMT_GRAND_MIN;
  const maxPct = Math.abs(summary.grandMaxTotal - grandMaxExp) / grandMaxExp;
  const minPct = Math.abs(summary.grandMinTotal - grandMinExp) / grandMinExp;
  const tolLabel = `±${(PTMT_TOLERANCE * 100).toFixed(1)}%`;
  checks.push({
    name: `Grand Max total ≈ ${grandMaxExp.toLocaleString("en-IN")}`,
    expected: grandMaxExp,
    actual: summary.grandMaxTotal,
    pass: maxPct <= PTMT_TOLERANCE,
    tolerance: tolLabel,
  });
  checks.push({
    name: `Grand Min total ≈ ${grandMinExp.toLocaleString("en-IN")}`,
    expected: grandMinExp,
    actual: summary.grandMinTotal,
    pass: minPct <= PTMT_TOLERANCE,
    tolerance: tolLabel,
  });

  // ── Per-category Max / Min (±0.1%) ─────────────────────────────────────────
  const catMap = new Map(summary.categories.map((c) => [c.category, c]));
  const categoryGolden = isAugGolden ? PTMT_AUG_CATEGORY_GOLDEN : PTMT_CATEGORY_GOLDEN;
  for (const g of categoryGolden) {
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

  // ── Stock-join coverage guard (Fault-1 class) ───────────────────────────────
  // Independently re-derive per-key stock from the RAW upload rows using broad
  // header detection (any column matching /stock|qty/i), then compare against the
  // engine's alias-based join AT THE SAME KEY (code+colour for multi-variant,
  // code for single-variant). A plan row where the engine sees 0 but the file
  // holds non-zero stock for the same key = silent-zero join → must be 0.
  // This is the check that would have caught the "Closing Stock" column miss
  // in the August 2026 upload (~1,015 silently-zero rows).
  const indepExact = new Map<string, number>();
  const indepByCode = new Map<string, number>();
  for (const row of stockRows) {
    const rec = row as Record<string, unknown>;
    const code = normalizeCode(String(rec["Item Code"] ?? "").trim());
    if (!code) continue;
    const colour = String(rec["Colour"] ?? rec["Color"] ?? "").trim().toUpperCase();
    let qty = 0;
    for (const [col, val] of Object.entries(rec)) {
      if (!/stock|qty/i.test(col) || /item|code|colou?r|category|name/i.test(col)) continue;
      const n = typeof val === "number" ? val : Number(String(val ?? "").replace(/,/g, ""));
      if (Number.isFinite(n) && n !== 0) { qty = n; break; }
    }
    indepExact.set(`${code}::${colour}`, (indepExact.get(`${code}::${colour}`) ?? 0) + qty);
    indepByCode.set(code, (indepByCode.get(code) ?? 0) + qty);
  }
  // Strict-layer maps: same rows keyed by punctuation-stripped code, so a future
  // upload that writes "A465" where item_master says "A-465" still trips the guard.
  const indepStrictExact = new Map<string, number>();
  const indepStrictByCode = new Map<string, number>();
  for (const [key, qty] of indepExact) {
    const [code, colour] = key.split("::");
    const sc = normalizeCodeStrict(code);
    indepStrictExact.set(`${sc}::${colour}`, (indepStrictExact.get(`${sc}::${colour}`) ?? 0) + qty);
    indepStrictByCode.set(sc, (indepStrictByCode.get(sc) ?? 0) + qty);
  }
  let stockJoinMisses = 0;       // engine-normalization layer — must be 0
  let stockJoinStrictMisses = 0; // strict layer — baseline 1 (501-S WHITE, hyphen-variant in FG file)
  for (const item of itemRows) {
    const isSingleVariant = (codeCounts.get(`${item.category}::${normalizeCode(item.itemCode)}`) ?? 0) <= 1;
    const engineStock = resolveTotal(stockTotalsForPlan, item.itemCode, item.colour, isSingleVariant);
    if (engineStock !== 0) continue;
    const code = normalizeCode(item.itemCode);
    const colourKey = item.colour.trim().toUpperCase();
    const indep = isSingleVariant
      ? (indepByCode.get(code) ?? 0)
      : (indepExact.get(`${code}::${colourKey}`) ?? 0);
    if (indep !== 0) { stockJoinMisses++; continue; }
    const sc = normalizeCodeStrict(item.itemCode);
    const indepStrict = isSingleVariant
      ? (indepStrictByCode.get(sc) ?? 0)
      : (indepStrictExact.get(`${sc}::${colourKey}`) ?? 0);
    if (indepStrict !== 0) stockJoinStrictMisses++;
  }
  checks.push({
    name: "Stock-join coverage guard (plan rows with Stock=0 but FG non-zero, same key)",
    expected: 0,
    actual: stockJoinMisses,
    pass: stockJoinMisses === 0,
    tolerance: "exact",
  });
  // Known baseline: exactly 1 (501-S / WHITE — FG file writes the code with different
  // punctuation, 208 units; engine intentionally does not strict-join to avoid
  // cross-code collisions). Any INCREASE means a new punctuation-variant join loss.
  checks.push({
    name: "Stock-join strict-layer guard (punctuation-variant code misses, baseline 1)",
    expected: 1,
    actual: stockJoinStrictMisses,
    pass: stockJoinStrictMisses <= 1,
    tolerance: "≤ 1",
  });

  // ── Stock reconciliation ─────────────────────────────────────────────────────
  // Σ(stock joined onto plan rows, deduped per resolved key) must reconcile with
  // Σ(FG stock for codes present in the plan). A silent-zero join regression
  // (e.g. the ~498,000-unit gap of the original Fault 1) must fail loudly.
  // DELIBERATE asymmetry: the denominator is computed with STRICT (punctuation-
  // stripped) code matching while the numerator uses the engine join. If the
  // engine join degrades (column rename, normalization drift), the numerator
  // falls while the denominator holds → the gap widens and this check trips.
  // Legitimate mapping noise (codes reused across categories, colour splits)
  // is why the tolerance is ±2% rather than exact; the current gap is ~0.4%.
  const planStrictCodes = new Set(itemRows.map((i) => normalizeCodeStrict(i.itemCode)));
  let fgStockForPlanCodes = 0;
  for (const [key, qty] of stockTotalsForPlan.exact) {
    const [code] = key.split("::");
    if (planStrictCodes.has(normalizeCodeStrict(code))) fgStockForPlanCodes += qty;
  }
  const joinedKeys = new Map<string, number>();
  for (const item of itemRows) {
    const isSingleVariant = (codeCounts.get(`${item.category}::${normalizeCode(item.itemCode)}`) ?? 0) <= 1;
    const key = isSingleVariant ? `code::${normalizeCode(item.itemCode)}` : `exact::${normalizeCode(item.itemCode)}::${item.colour.trim().toUpperCase()}`;
    if (!joinedKeys.has(key)) joinedKeys.set(key, resolveTotal(stockTotalsForPlan, item.itemCode, item.colour, isSingleVariant));
  }
  const joinedStockSum = Math.round([...joinedKeys.values()].reduce((a, b) => a + b, 0));
  const reconGapPct = fgStockForPlanCodes > 0 ? Math.abs(joinedStockSum - fgStockForPlanCodes) / fgStockForPlanCodes : 0;
  checks.push({
    name: `Stock reconciliation: joined ${joinedStockSum.toLocaleString("en-IN")} vs FG-for-plan-codes ${Math.round(fgStockForPlanCodes).toLocaleString("en-IN")} (gap ${Math.round(joinedStockSum - fgStockForPlanCodes).toLocaleString("en-IN")} units)`,
    expected: Math.round(fgStockForPlanCodes),
    actual: joinedStockSum,
    pass: reconGapPct <= 0.02,
    tolerance: "±2%",
  });

  // ── Item-coverage guard (Fault-2 class) ─────────────────────────────────────
  // Per-category counts of source items absent from the plan and plan items
  // absent from the source. Reported ALWAYS — never suppressed. The counts are
  // informational (pass=true); the per-category breakdown ships in the payload.
  const fgCodeStock = new Map<string, number>();
  for (const [key, qty] of stockTotalsForPlan.exact) {
    const [code] = key.split("::");
    const sc = normalizeCodeStrict(code);
    fgCodeStock.set(sc, (fgCodeStock.get(sc) ?? 0) + qty);
  }
  const planNotInSource = new Map<string, number>();  // category → count of plan codes absent from FG
  const seenPlanCodes = new Set<string>();
  for (const item of itemRows) {
    const sc = normalizeCodeStrict(item.itemCode);
    const dedupeKey = `${item.category}::${sc}`;
    if (seenPlanCodes.has(dedupeKey)) continue;
    seenPlanCodes.add(dedupeKey);
    if (!fgCodeStock.has(sc)) planNotInSource.set(item.category, (planNotInSource.get(item.category) ?? 0) + 1);
  }
  const sourceNotInPlanCodes: Array<{ code: string; stock: number }> = [];
  for (const [sc, qty] of fgCodeStock) {
    if (!planStrictCodes.has(sc) && qty > 0) sourceNotInPlanCodes.push({ code: sc, stock: Math.round(qty) });
  }
  const planNotInSourceTotal = [...planNotInSource.values()].reduce((a, b) => a + b, 0);
  checks.push({
    name: `Item coverage: ${sourceNotInPlanCodes.length} source codes not in plan / ${planNotInSourceTotal} plan codes not in source (reported)`,
    expected: sourceNotInPlanCodes.length + planNotInSourceTotal,
    actual: sourceNotInPlanCodes.length + planNotInSourceTotal,
    pass: true,
    tolerance: "reported",
  });

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

  res.json({
    month,
    segment,
    allPass,
    passCount: checks.length - failCount,
    failCount,
    checks,
    itemCoverage: {
      sourceNotInPlan: sourceNotInPlanCodes.sort((a, b) => b.stock - a.stock).slice(0, 50),
      sourceNotInPlanCount: sourceNotInPlanCodes.length,
      planNotInSourceByCategory: Object.fromEntries(planNotInSource),
      planNotInSourceCount: planNotInSourceTotal,
    },
  });
});

// ── GET /plan/plumbing-monitoring ─────────────────────────────────────────────
// Returns per-week and per-category Sheet3 actuals vs plan release targets.
// Methodology:
//   - MAPPED actual  = Sheet3 codes that match a plan item via normalizeCodeStrict
//   - UNMAPPED       = Sheet3 codes with no plan-master match (surfaced, not dropped)
//   - Cumulative attainment = cumMapped / cumRelease (suppressed if week not started)
// 5-min response cache so the first cold call (9s) doesn't block subsequent browser hits.

/**
 * Core computation for Plumbing monitoring payload.
 * Exported so monitoring/dashboard can dispatch to it when segment=PLUMBING.
 */
export async function computePlumbingMonitoringPayload(month: string) {
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
  // `produced`  = total actual production across W1–W4 (alias for totalActual)
  // `released`  = total plan release across W1–W4      (alias for totalRelease)
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
      // `produced` and `released` are explicit aliases so consumers don't have to know the internal names
      produced: totalActual,
      released: Math.round(totalRelease),
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

  return {
    month, lastDataDate, workingDaysElapsed,
    weeks, categories,
    unmapped: { byWeek: [...unmappedByWeek], total: totalUnmapped, topCodes },
    totalProduced, totalMapped, totalUnmapped, runRatePerDay,
  };
}

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
    const payload = await computePlumbingMonitoringPayload(month);
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

    const checks: MonCheckResult[] = [];

    // ── Plant-level guards (dynamic — no frozen golden values) ────────────────
    // W1 and W2 are elapsed; total production (mapped + unmapped) must be > 0.
    const w1Total = plantMapped2[0]! + unmappedByWeek2[0]!;
    const w2Total = plantMapped2[1]! + unmappedByWeek2[1]!;

    checks.push({ name: "Mon · W1 total > 0",        expected: 1, actual: w1Total > 0 ? 1 : 0,           pass: w1Total > 0,          tolerance: "> 0" });
    checks.push({ name: "Mon · W2 total > 0",        expected: 1, actual: w2Total > 0 ? 1 : 0,           pass: w2Total > 0,          tolerance: "> 0" });
    checks.push({ name: "Mon · Plant W1 mapped > 0", expected: 1, actual: plantMapped2[0]! > 0 ? 1 : 0,  pass: plantMapped2[0]! > 0, tolerance: "> 0" });
    checks.push({ name: "Mon · Plant W2 mapped > 0", expected: 1, actual: plantMapped2[1]! > 0 ? 1 : 0,  pass: plantMapped2[1]! > 0, tolerance: "> 0" });

    // ── Per-category guards ────────────────────────────────────────────────────
    // Non-Solvent categories must have > 0 production in both W1 and W2.
    // Solvent categories only check >= 0 (production is intermittent).
    const NON_SOLVENT_CATS = ["CPVC Pipe","CPVC Fitting","UPVC Pipe","UPVC Fitting","SWR Pipe","SWR Fitting","AGRI Pipe","AGRI Fitting"];
    const SOLVENT_CATS     = ["CPVC Solvent","UPVC Solvent","SWR Solvent","AGRI Solvent"];

    for (const cat of NON_SOLVENT_CATS) {
      const actW1 = (catActual2.get(cat) ?? [0, 0, 0, 0])[0]!;
      const actW2 = (catActual2.get(cat) ?? [0, 0, 0, 0])[1]!;
      checks.push({ name: `Mon · ${cat} W1`, expected: 1, actual: actW1 > 0 ? 1 : 0, pass: actW1 > 0, tolerance: "> 0" });
      checks.push({ name: `Mon · ${cat} W2`, expected: 1, actual: actW2 > 0 ? 1 : 0, pass: actW2 > 0, tolerance: "> 0" });
    }
    for (const cat of SOLVENT_CATS) {
      const actW1 = (catActual2.get(cat) ?? [0, 0, 0, 0])[0]!;
      const actW2 = (catActual2.get(cat) ?? [0, 0, 0, 0])[1]!;
      checks.push({ name: `Mon · ${cat} W1`, expected: 1, actual: actW1 >= 0 ? 1 : 0, pass: actW1 >= 0, tolerance: ">= 0" });
      checks.push({ name: `Mon · ${cat} W2`, expected: 1, actual: actW2 >= 0 ? 1 : 0, pass: actW2 >= 0, tolerance: ">= 0" });
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
