import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db, uploadedFilesTable, itemMasterTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import {
  parseRateListRows,
  RATE_LIST_UPLOAD_KIND,
} from "../lib/rate-list";
import { inferUploadPlanningMonth, monthInUploadFilename } from "../lib/upload-period";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const VALID_KINDS = new Set([
  "pending_orders",
  "last_month_pending",
  "current_stock",
  "plumbing_fg_stock",
  RATE_LIST_UPLOAD_KIND,
]);

const PENDING_BALANCE_HEADERS = ["Balance_Qty", "Balance Qty", "Bal.Qty", "Bal. Qty"];
const CURRENT_STOCK_HEADERS = ["C/Stock", "C Stock", "Closing Stock"];
const ITEM_CODE_HEADERS = ["Item Code", "ItemCode", "Item No.", "Old Item Code"];
const PENDING_QTY_HEADERS = ["Qty", "Qty.", ...PENDING_BALANCE_HEADERS, ...CURRENT_STOCK_HEADERS];

export interface SheetSelectionDiagnostic {
  name: string;
  headerRowIndex: number;
  headers: string[];
  dataRowCount?: number;
  selectionRule?: string;
}

export type PendingSheetDiagnostic = SheetSelectionDiagnostic;

export class SheetSelectionError extends Error {
  constructor(
    readonly code: string,
    readonly sheets: SheetSelectionDiagnostic[],
    readonly expected: string,
  ) {
    super(`No ${expected} worksheet was found. ${expected} must be identified by its required columns or an accepted worksheet name.`);
    this.name = "SheetSelectionError";
  }
}

// Kept as an exported compatibility alias for callers and tests that refer to
// the original pending-specific error name.
export { SheetSelectionError as PendingSheetSelectionError };

router.get("/uploads", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: uploadedFilesTable.id,
      kind: uploadedFilesTable.kind,
      filename: uploadedFilesTable.filename,
      period: uploadedFilesTable.period,
      rowCount: uploadedFilesTable.rowCount,
      sourceMetadata: uploadedFilesTable.sourceMetadata,
      uploadedAt: uploadedFilesTable.uploadedAt,
    })
    .from(uploadedFilesTable)
    .orderBy(desc(uploadedFilesTable.uploadedAt));
  res.json(rows.map((row) => ({
    ...row,
    // Legacy rows predate the explicit period column. Derive their period
    // once at the API boundary so every consumer applies the same rule.
    period: inferUploadPlanningMonth(row.kind, row.filename, row.uploadedAt, row.period),
  })));
});

router.post("/uploads/:kind", upload.single("file"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.kind) ? req.params.kind[0] : req.params.kind;
  if (!VALID_KINDS.has(raw)) {
    res.status(400).json({ error: "Invalid upload kind" });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }
  const requestedPeriod = typeof req.body?.period === "string" ? req.body.period.trim() : "";
  if (requestedPeriod && !/^\d{4}-(0[1-9]|1[0-2])$/.test(requestedPeriod)) {
    res.status(400).json({ error: "Invalid upload period", message: "period must use YYYY-MM format" });
    return;
  }
  let workbook: XLSX.WorkBook;
  let rows: Record<string, unknown>[];
  let selectedSheet: SheetSelectionDiagnostic;
  try {
    workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    rows = extractRows(workbook, raw);
    selectedSheet = selectedSheetForUpload(workbook, raw);
  } catch (err) {
    req.log.warn({ err }, "Failed to parse uploaded workbook");
    if (err instanceof SheetSelectionError) {
      res.status(400).json({
        error: err.code,
        message: err.message,
        expected: err.expected,
        sheets: err.sheets,
      });
      return;
    }
    res.status(400).json({ error: "Could not parse the uploaded Excel file" });
    return;
  }
  const sourcePeriod = raw === "pending_orders"
    ? monthInUploadFilename(selectedSheet.name)
    : monthInUploadFilename(req.file.originalname);
  const period = inferUploadPlanningMonth(
    raw,
    req.file.originalname,
    new Date(),
    requestedPeriod || null,
    sourcePeriod,
  );
  const quantityTotals: Record<string, number> = {};
  for (const row of rows) {
    const rawSegment = String(row.Segment ?? "").trim().toUpperCase();
    const segment = rawSegment === "PT" || rawSegment === "PTMT"
      ? "PTMT"
      : rawSegment === "PL" || rawSegment === "PLUMBING" || rawSegment === "AGRI"
        ? "Plumbing"
        : rawSegment || "total";
    const rawQuantity = row.Balance_Qty ?? row["Balance Qty"] ?? row["Bal. Qty"] ?? row.Qty ?? row["Net Stock"];
    const quantity = Number(rawQuantity);
    if (Number.isFinite(quantity)) quantityTotals[segment] = (quantityTotals[segment] ?? 0) + quantity;
  }
  const sourceMetadata: Record<string, unknown> = {
    worksheet: selectedSheet.name,
    selectionRule: selectedSheet.selectionRule ?? "content-based selection",
    sourceDataRowCount: selectedSheet.dataRowCount ?? rows.length,
    detectedSourcePeriod: sourcePeriod,
    detectedPlanningPeriod: inferUploadPlanningMonth(raw, req.file.originalname, new Date(), null, sourcePeriod),
    periodBasis: requestedPeriod ? "explicit-upload-period" : sourcePeriod ? "workbook-or-filename-period" : "upload-date",
    quantityTotals,
  };

  // For Plumbing stock uploads: also upsert item_master (segment='Plumbing').
  // This is the mechanism that seeds Plumbing items into the planning catalogue.
  let itemMasterUpsert: { upserted: number; skipped: number } | undefined;
  if (raw === "plumbing_fg_stock") {
    try {
      itemMasterUpsert = await upsertPlumbingItemMaster(rows);
      req.log.info(itemMasterUpsert, "Plumbing item_master upserted from FG Stock upload");
    } catch (err) {
      req.log.warn({ err }, "Plumbing item_master upsert failed — FG Stock stored, item_master unchanged");
    }
  }

  const [record] = await db
    .insert(uploadedFilesTable)
    .values({
      kind: raw,
      filename: req.file.originalname,
      period,
      rowCount: rows.length,
      rows,
      sourceMetadata,
    })
    .returning({
      id: uploadedFilesTable.id,
      kind: uploadedFilesTable.kind,
      filename: uploadedFilesTable.filename,
      period: uploadedFilesTable.period,
      rowCount: uploadedFilesTable.rowCount,
      sourceMetadata: uploadedFilesTable.sourceMetadata,
      uploadedAt: uploadedFilesTable.uploadedAt,
    });

  res.status(201).json({
    ...record,
    period: inferUploadPlanningMonth(record!.kind, record!.filename, record!.uploadedAt, record!.period),
    sourceMetadata: record!.sourceMetadata,
    ...(itemMasterUpsert ? { itemMasterUpsert } : {}),
  });
});

const HEADER_HINTS = ["item code", "item no.", "old item code", "colour", "color", "qty", "balance_qty", "segment"];

/**
 * Locates the real header row within the first few rows of a sheet. Some
 * source workbooks have title/subtotal rows before the actual column
 * headers, so we can't assume row 0 is the header.
 */
function normaliseHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function findHeaderRowIndex(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const cells = (rows[i] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
    const hits = cells.filter((c) => HEADER_HINTS.some((hint) => normaliseHeader(hint) === normaliseHeader(c))).length;
    if (hits >= 2) return i;
  }
  return 0;
}

function inspectSheet(sheet: XLSX.WorkSheet, name: string): PendingSheetDiagnostic {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const headerRowIndex = findHeaderRowIndex(raw);
  const headers = (raw[headerRowIndex] ?? [])
    .map((h) => String(h ?? "").trim())
    .filter(Boolean);
  const dataRowCount = raw
    .slice(headerRowIndex + 1)
    .filter((row) => (row ?? []).some((cell) => cell !== null && cell !== undefined && cell !== ""))
    .length;
  return { name, headerRowIndex, headers, dataRowCount };
}

function sheetToObjects(sheet: XLSX.WorkSheet): Record<string, unknown>[] {
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const headerIdx = findHeaderRowIndex(raw);
  const headers = (raw[headerIdx] ?? []).map((h) => String(h ?? "").trim());
  const out: Record<string, unknown>[] = [];
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i] ?? [];
    if (row.every((c) => c === null || c === undefined || c === "")) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, idx) => {
      if (h) obj[h] = row[idx] ?? null;
    });
    out.push(obj);
  }
  return out;
}

function hasAnyHeader(headers: string[], acceptedHeaders: string[]): boolean {
  const accepted = new Set(acceptedHeaders.map(normaliseHeader));
  return headers.some((header) => accepted.has(normaliseHeader(header)));
}

function hasCurrentStockHeader(headers: string[]): boolean {
  return (
    hasAnyHeader(headers, ITEM_CODE_HEADERS) &&
    hasAnyHeader(headers, ["Colour", "Color"]) &&
    hasAnyHeader(headers, CURRENT_STOCK_HEADERS)
  );
}

function hasPtmtSheetHeader(headers: string[]): boolean {
  return hasAnyHeader(headers, ITEM_CODE_HEADERS) && hasAnyHeader(headers, PENDING_QTY_HEADERS);
}

function hasLastMonthPendingHeader(headers: string[]): boolean {
  return (
    hasAnyHeader(headers, ITEM_CODE_HEADERS) &&
    hasAnyHeader(headers, ["Colour", "Color"]) &&
    hasAnyHeader(headers, PENDING_QTY_HEADERS)
  );
}

function hasPlumbingStockHeader(headers: string[]): boolean {
  return hasAnyHeader(headers, ITEM_CODE_HEADERS) && hasAnyHeader(headers, ["Net Stock"]);
}

function isNamedPendingSheet(name: string): boolean {
  return /pending/i.test(name) || /^\s*po(?:\s|[-_]|$)/i.test(name);
}

type SheetSelectionSpec = {
  code: string;
  expected: string;
  hasRequiredHeaders: (headers: string[]) => boolean;
  isAcceptedName: (name: string) => boolean;
  preference?: "largest" | "smallest";
  selectionRule?: string;
};

function selectSheet(workbook: XLSX.WorkBook, spec: SheetSelectionSpec): SheetSelectionDiagnostic {
  const diagnostics = workbook.SheetNames.map((name) => inspectSheet(workbook.Sheets[name]!, name));
  const contentSheets = diagnostics.filter((sheet) => spec.hasRequiredHeaders(sheet.headers));
  if (contentSheets.length > 0) {
    const candidates = [...contentSheets];
    if (spec.preference === "largest") {
      candidates.sort((a, b) => (b.dataRowCount ?? 0) - (a.dataRowCount ?? 0));
    } else if (spec.preference === "smallest") {
      candidates.sort((a, b) => (a.dataRowCount ?? 0) - (b.dataRowCount ?? 0));
    }
    const selected = candidates[0]!;
    selected.selectionRule = spec.selectionRule ?? "required headers";
    return selected;
  }

  const namedSheet = diagnostics.find((sheet) => spec.isAcceptedName(sheet.name));
  if (namedSheet) {
    namedSheet.selectionRule = "accepted worksheet name fallback";
    return namedSheet;
  }

  throw new SheetSelectionError(spec.code, diagnostics, spec.expected);
}

export function selectPendingSheet(workbook: XLSX.WorkBook): PendingSheetDiagnostic {
  return selectSheet(workbook, {
    code: "PENDING_SHEET_NOT_FOUND",
    expected: "pending-order",
    hasRequiredHeaders: (headers) => hasAnyHeader(headers, PENDING_BALANCE_HEADERS),
    isAcceptedName: isNamedPendingSheet,
    preference: "largest",
    selectionRule: "required balance headers; largest matching data sheet",
  });
}

export function extractPendingRows(workbook: XLSX.WorkBook): {
  sheetName: string;
  rows: Record<string, unknown>[];
} {
  const selected = selectPendingSheet(workbook);
  const sheet = workbook.Sheets[selected.name]!;
  const rows = sheetToObjects(sheet).map((row) => {
    const rawCode = String(row["Old Item Code"] ?? row["Item Code"] ?? row["Item No."] ?? "");
    const rawColour = String(row["Color"] ?? row["Colour"] ?? "");
    const { code, colour } = applyPendingOrderAlias(rawCode, rawColour);
    return {
      ...row,
      "Old Item Code": code,
      "Item Code": code,
      "Item No.": code,
      Colour: colour,
      Color: colour,
    };
  });
  return { sheetName: selected.name, rows };
}

/**
 * Map a raw FG-Stock Category string (+ optional item name) to one of the 12 canonical
 * Plumbing planning categories.
 *
 * Solvent items in the actual FG Stock file appear under *-TRADING categories
 * (e.g. "CPVC-TRADING", "UPVC-TRADING", "Agri-Trading") rather than a dedicated
 * "CPVC-SOLVENT" category.  We detect them via the item *name* containing
 * "SOLVENT" or "CEMENT", and resolve the material from the category string.
 * All other TRADING rows are excluded (they are procured/traded, not produced).
 */
function inferPlumbingCategory(raw: string, itemName = ""): string | null {
  const g = raw.trim().toUpperCase();
  const n = itemName.trim().toUpperCase();

  // ── TRADING rows ─────────────────────────────────────────────────────────────
  // Solvent/cement items appear under *-TRADING categories in the actual ERP export.
  // Detect them by item name; resolve material from the category string itself.
  if (g.includes("TRADING")) {
    const nameIsSolvent = n.includes("SOLVENT") || n.includes("CEMENT");
    if (!nameIsSolvent) return null; // non-Solvent trading item — skip
    if (g.includes("CPVC")) return "CPVC Solvent";
    if (g.includes("UPVC")) return "UPVC Solvent";
    if (g.includes("SWR"))  return "SWR Solvent";
    if (g.includes("AGRI") || g.includes("AGRICULTURE")) return "AGRI Solvent";
    return null; // unknown material — skip
  }

  // ── Other explicitly excluded categories ─────────────────────────────────────
  if (
    g.includes("WATER TANK") ||   // Water tanks — out of scope
    g.includes("COLUMN PIPE") ||  // Column Pipe — separate category
    g.includes("PPR")             // PPR fittings — separate category
  ) {
    return null;
  }

  // ── Solvent/Cement by category name (future-proofing) ────────────────────────
  // Detect SOLVENT/CEMENT BEFORE the generic Pipe/Fitting check so that
  // "CPVC-SOLVENT" maps to "CPVC Solvent" (not "CPVC Pipe").
  const isSolvent = g.includes("SOLVENT") || g.includes("CEMENT");
  if (isSolvent) {
    if (g.includes("CPVC")) return "CPVC Solvent";
    if (g.includes("UPVC")) return "UPVC Solvent";
    if (g.includes("SWR"))  return "SWR Solvent";
    if (g.includes("AGRI") || g.includes("AGRICULTURE")) return "AGRI Solvent";
    return null;
  }

  // "-FG" suffix = Fitting (FG Stock file convention); also honour legacy FITTING / FTG spellings.
  // "*-PIPE" or bare material name = Pipe.
  const isFitting = g.includes("FITTING") || g.includes("FTG") || g.endsWith("-FG") || g.endsWith(" FG");
  if (g.includes("CPVC")) return isFitting ? "CPVC Fitting" : "CPVC Pipe";
  if (g.includes("UPVC")) return isFitting ? "UPVC Fitting" : "UPVC Pipe";
  if (g.includes("SWR"))  return isFitting ? "SWR Fitting"  : "SWR Pipe";
  if (g.includes("AGRI") || g.includes("AGRICULTURE")) return isFitting ? "AGRI Fitting" : "AGRI Pipe";
  return null;
}

/**
 * The ERP records several pending-order variants under a renamed suffix +
 * placeholder colour that does not match the planning Cat-no catalogue. An
 * exact-match join on the raw ERP code silently drops these items (they
 * simply produce no match), which understates Production Plan for the
 * affected codes. Apply the known ERP -> planning aliasing before joining.
 *
 * Suffix aliases: -LSBB -> -LSB, -LSTBB -> -LSTB, -LSQBB -> -LSQB, all
 * recorded as colour BLACK in the ERP but BLUE in the planning catalogue.
 */
export function applyPendingOrderAlias(code: string, colour: string): { code: string; colour: string } {
  const trimmedCode = code.trim();
  const trimmedColour = colour.trim().toUpperCase();

  const suffixAliasMap: [RegExp, string][] = [
    [/LSTBB$/i, "LSTB"],
    [/LSQBB$/i, "LSQB"],
    [/LSBB$/i, "LSB"],
  ];
  for (const [pattern, replacement] of suffixAliasMap) {
    if (pattern.test(trimmedCode) && trimmedColour === "BLACK") {
      return { code: trimmedCode.replace(pattern, replacement), colour: "BLUE" };
    }
  }

  return { code: trimmedCode, colour: trimmedColour };
}

export function extractRows(workbook: XLSX.WorkBook, kind: string): Record<string, unknown>[] {
  if (kind === RATE_LIST_UPLOAD_KIND) {
    return extractRateListRows(workbook);
  }

  if (kind === "pending_orders") {
    // DATA.xlsx — shared across ALL segments (PTMT + Plumbing).
    // Store every row; plan.ts filters by segment when consuming.
    // The alias transform is applied here to all rows; it is a no-op for non-PTMT codes
    // (the suffix patterns -LSBB/-LSTBB/-LSQBB only appear in PTMT codes).
    return extractPendingRows(workbook).rows;
  }

  if (kind === "current_stock") {
    // F.G. STOCK factory Excel → "F.G Sheet" tab.
    // Col A = Item Code, Col B = Colour, Col C = C/Stock.
    // Normalize "C/Stock" → "Qty" so sumByKey in plan.ts works unchanged.
    const fgSheetSelection = selectSheet(workbook, {
      code: "CURRENT_STOCK_SHEET_NOT_FOUND",
      expected: "current-stock",
      hasRequiredHeaders: hasCurrentStockHeader,
      isAcceptedName: (name) =>
        /f\.g\.?\s*sheet/i.test(name) || /f\.g/i.test(name) || /stock/i.test(name),
      preference: "largest",
      selectionRule: "Item Code + Colour + C/Stock headers; largest matching data sheet",
    });
    const fgSheet = workbook.Sheets[fgSheetSelection.name]!;
    const rows = sheetToObjects(fgSheet);
    return rows.map((row) => {
      const normalized: Record<string, unknown> = { ...row };
      // Rename "C/Stock" (and common variants) to "Qty" for downstream aggregation
      const cstockKey = Object.keys(normalized).find((k) => /c[\s/\\]?stock/i.test(k) || /closing\s*stock/i.test(k));
      if (cstockKey && cstockKey !== "Qty") {
        normalized["Qty"] = normalized[cstockKey];
        delete normalized[cstockKey];
      }
      return normalized;
    });
  }

  if (kind === "last_month_pending") {
    // LAST_MONTH_PENDING_ORDERS_<month> file → read the PTMT tab.
    // Columns: Item Code, Colour, Qty (already Cat-no format).
    // Per spec §4: do NOT take this from F.G. STOCK's LAST MONTH PENDING ITEMS tab
    // — that contains all-segment data (total ~275,878) not the PTMT-only figure (137,939).
    const sheetSelection = selectSheet(workbook, {
      code: "LAST_MONTH_PENDING_SHEET_NOT_FOUND",
      expected: "last-month-pending",
      hasRequiredHeaders: hasLastMonthPendingHeader,
      isAcceptedName: (name) =>
        /^ptmt$/i.test(name) ||
        /ptmt/i.test(name) ||
        /last.month.pending/i.test(name) ||
        /pending/i.test(name),
      preference: "smallest",
      selectionRule: "Item Code + Colour + Qty headers; smallest matching data sheet",
    });
    const sheet = workbook.Sheets[sheetSelection.name]!;
    return sheetToObjects(sheet).map((row) => {
      const normalized: Record<string, unknown> = { ...row };
      const quantityKey = Object.keys(normalized).find(
        (key) => /^qty\.?$/i.test(key) || /balance|c[\s/\\]?stock|closing\s*stock/i.test(key),
      );
      if (quantityKey && quantityKey !== "Qty") {
        normalized.Qty = normalized[quantityKey];
        delete normalized[quantityKey];
      }
      return normalized;
    });
  }

  if (kind === "plumbing_fg_stock") {
    // Plumbing FG Stock file — e.g. "FG Stock and Pending Production month of June.xlsx"
    // Worksheet: "FG Stock" (or closest match)
    // Header row: the first row (within first 15 rows) that contains BOTH "Item Code" and "Net Stock"
    // Col A (index 0) = Item Code
    // Col C (index 2) = Category  (CPVC-PIPE, CPVC-FG, UPVC-PIPE, UPVC-FG, SWR-PIPE, SWR-FG, Agri-Pipe, AGRI-FG)
    // Col R (index 17) = Net Stock
    //
    // Sign semantics (enforced in plan.ts, not here — stored as-is):
    //   Positive Net Stock → opening stock as on 1st of the planning month
    //   Negative Net Stock → |value| = pending order last month (oversold / dummy stock)
    //   Zero → ignored
    //
    // "TOTAL" rows and blank item codes are skipped.
    // A "Pending prod." sibling tab mirrors the negatives — use Col R of FG Stock tab only.
    const sheetSelection = selectSheet(workbook, {
      code: "PLUMBING_FG_STOCK_SHEET_NOT_FOUND",
      expected: "Plumbing FG stock",
      hasRequiredHeaders: hasPlumbingStockHeader,
      isAcceptedName: (name) =>
        /^fg\s*stock$/i.test(name) || /fg.stock/i.test(name) || /stock/i.test(name),
    });
    const sheet = workbook.Sheets[sheetSelection.name]!;
    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });

    // Locate header row: the first row containing both "Item Code" and "Net Stock" headers
    let headerIdx = 0;
    for (let i = 0; i < Math.min(15, raw.length); i++) {
      const cells = (raw[i] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
      if (cells.some((c) => /item\s*code/i.test(c)) && cells.some((c) => /net\s*stock/i.test(c))) {
        headerIdx = i;
        break;
      }
    }

    const headers = (raw[headerIdx] ?? []).map((h) => String(h ?? "").trim());
    // Resolve column indices from headers — fall back to fixed A/B/C/R positions if not found
    const iCode = Math.max(0, headers.findIndex((h) => /item\s*code/i.test(h)));
    const iName = headers.findIndex((h) => /item.*(name|desc)/i.test(h)) >= 0
      ? headers.findIndex((h) => /item.*(name|desc)/i.test(h))
      : 1; // Column B
    const iCat  = headers.findIndex((h) => /^cat(egory)?$/i.test(h)) >= 0
      ? headers.findIndex((h) => /^cat(egory)?$/i.test(h))
      : 2; // Column C
    const iNet  = headers.findIndex((h) => /net\s*stock/i.test(h)) >= 0
      ? headers.findIndex((h) => /net\s*stock/i.test(h))
      : 17; // Column R

    const out: Record<string, unknown>[] = [];
    for (let i = headerIdx + 1; i < raw.length; i++) {
      const row = raw[i] ?? [];
      const itemCode = String(row[iCode] ?? "").trim();
      if (!itemCode || /^total$/i.test(itemCode)) continue;
      const itemName = String(row[iName] ?? "").trim();
      const category = String(row[iCat] ?? "").trim();
      const netStockRaw = row[iNet];
      const netStock =
        typeof netStockRaw === "number"
          ? netStockRaw
          : Number(String(netStockRaw ?? "").replace(/,/g, "")) || 0;
      if (netStock === 0) continue; // skip zero rows
      // Item Name is carried through so upsertPlumbingItemMaster can detect Solvent items
      // whose Category is *-TRADING rather than a dedicated Solvent category string.
      out.push({ "Item Code": itemCode, "Item Name": itemName, Category: category, "Net Stock": netStock });
    }
    return out;
  }

  const sheetSelection = selectSheet(workbook, {
    code: "PTMT_SHEET_NOT_FOUND",
    expected: "PTMT",
    hasRequiredHeaders: hasPtmtSheetHeader,
    isAcceptedName: (name) => /^ptmt$/i.test(name),
  });
  const sheet = workbook.Sheets[sheetSelection.name]!;
  return sheetToObjects(sheet);
}

/**
 * Returns the same deterministic worksheet choice used by extractRows. This
 * is intentionally exported so the upload route can persist provenance
 * without duplicating the selection heuristic.
 */
export function selectedSheetForUpload(
  workbook: XLSX.WorkBook,
  kind: string,
): SheetSelectionDiagnostic {
  if (kind === "pending_orders") return selectPendingSheet(workbook);
  if (kind === "current_stock") {
    return selectSheet(workbook, {
      code: "CURRENT_STOCK_SHEET_NOT_FOUND",
      expected: "current-stock",
      hasRequiredHeaders: hasCurrentStockHeader,
      isAcceptedName: (name) => /f\.g\.?\s*sheet/i.test(name) || /f\.g/i.test(name) || /stock/i.test(name),
      preference: "largest",
      selectionRule: "Item Code + Colour + C/Stock headers; largest matching data sheet",
    });
  }
  if (kind === "last_month_pending") {
    return selectSheet(workbook, {
      code: "LAST_MONTH_PENDING_SHEET_NOT_FOUND",
      expected: "last-month-pending",
      hasRequiredHeaders: hasLastMonthPendingHeader,
      isAcceptedName: (name) => /^ptmt$/i.test(name) || /ptmt/i.test(name) || /last.month.pending/i.test(name) || /pending/i.test(name),
      preference: "smallest",
      selectionRule: "Item Code + Colour + Qty headers; smallest matching data sheet",
    });
  }
  if (kind === "plumbing_fg_stock") {
    return selectSheet(workbook, {
      code: "PLUMBING_FG_STOCK_SHEET_NOT_FOUND",
      expected: "Plumbing FG stock",
      hasRequiredHeaders: hasPlumbingStockHeader,
      isAcceptedName: (name) => /^fg\s*stock$/i.test(name) || /fg.stock/i.test(name) || /stock/i.test(name),
      selectionRule: "Item Code + Net Stock headers",
    });
  }
  const firstName = workbook.SheetNames[0];
  if (!firstName) throw new SheetSelectionError("RATE_LIST_SHEET_NOT_FOUND", [], "rate-list");
  return { name: firstName, headerRowIndex: 0, headers: [], selectionRule: "first worksheet (CSV/rate-list import)" };
}

export function extractRateListRows(workbook: XLSX.WorkBook): Record<string, unknown>[] {
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName || !workbook.Sheets[firstSheetName]) {
    throw new Error("Rate-list CSV has no worksheet.");
  }
  const sheet = workbook.Sheets[firstSheetName]!;
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null });
  const rows = sheetToObjects(sheet);
  if (rows.length === 0 && raw[0]) {
    const headerOnly: Record<string, unknown> = {};
    (raw[0] ?? []).forEach((header, index) => {
      const key = String(header ?? "").trim();
      if (key) headerOnly[key] = null;
    });
    // Preserve the header vocabulary so a header-only file gets the specific
    // "no recognised code rows" error rather than an opaque empty upload.
    parseRateListRows([headerOnly]);
  }
  // parseRateListRows performs strict header and empty-recognised-row
  // validation, then we store the canonical field names as the durable source.
  return parseRateListRows(rows).map((row) => ({
    source_tab: row.sourceTab,
    code: row.code,
    name: row.name,
    range: row.range,
    range_name: row.rangeName,
  }));
}

/**
 * Upsert Plumbing item_master rows from the parsed plumbing_current_stock file.
 * Expects rows to have Item Code, Colour, and a Category/Group/Material column.
 * Skips rows where the category cannot be mapped to a canonical Plumbing category.
 * Uses ON CONFLICT DO NOTHING — the unique constraint is (item_code, colour, category).
 */
async function upsertPlumbingItemMaster(rows: Record<string, unknown>[]): Promise<{ upserted: number; skipped: number }> {
  const toInsert: { segment: string; category: string; itemCode: string; colour: string }[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const itemCode = String(
      row["Item Code"] ?? row["ITEM CODE"] ?? row["ItemCode"] ?? row["item_code"] ?? ""
    ).trim().toUpperCase();
    if (!itemCode) continue;

    const colour = String(
      row["Colour"] ?? row["Color"] ?? row["COLOR"] ?? ""
    ).trim().toUpperCase();

    // Item name — used by inferPlumbingCategory to detect Solvent items in TRADING rows
    const itemName = String(row["Item Name"] ?? row["Item/Service Description"] ?? "").trim();

    // Category column: try direct "Category", "GROUP", "Group", "Material", "Material Type"
    const rawCategory = String(
      row["Category"] ?? row["GROUP"] ?? row["Group"] ?? row["Material"] ??
      row["Material Type"] ?? row["MATERIAL"] ?? row["type"] ?? ""
    ).trim();

    const category = rawCategory ? inferPlumbingCategory(rawCategory, itemName) : null;
    if (!category) continue; // skip rows we can't categorize

    const key = `${itemCode}::${colour}::${category}`;
    if (seen.has(key)) continue;
    seen.add(key);
    toInsert.push({ segment: "Plumbing", category, itemCode, colour });
  }

  if (toInsert.length === 0) return { upserted: 0, skipped: rows.length };

  // Batch insert in chunks of 500 to avoid parameter limits
  const CHUNK = 500;
  for (let i = 0; i < toInsert.length; i += CHUNK) {
    await db
      .insert(itemMasterTable)
      .values(toInsert.slice(i, i + CHUNK))
      .onConflictDoNothing();
  }

  return { upserted: toInsert.length, skipped: rows.length - toInsert.length };
}

export default router;
