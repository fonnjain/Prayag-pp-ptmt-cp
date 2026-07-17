import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db, uploadedFilesTable, itemMasterTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const VALID_KINDS = new Set([
  "pending_orders",
  "last_month_pending",
  "current_stock",
  "plumbing_fg_stock",
]);

router.get("/uploads", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      id: uploadedFilesTable.id,
      kind: uploadedFilesTable.kind,
      filename: uploadedFilesTable.filename,
      rowCount: uploadedFilesTable.rowCount,
      uploadedAt: uploadedFilesTable.uploadedAt,
    })
    .from(uploadedFilesTable)
    .orderBy(desc(uploadedFilesTable.uploadedAt));
  res.json(rows);
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

  let workbook: XLSX.WorkBook;
  let rows: Record<string, unknown>[];
  try {
    workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    rows = extractRows(workbook, raw);
  } catch (err) {
    req.log.warn({ err }, "Failed to parse uploaded workbook");
    res.status(400).json({ error: "Could not parse the uploaded Excel file" });
    return;
  }

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
      rowCount: rows.length,
      rows,
    })
    .returning({
      id: uploadedFilesTable.id,
      kind: uploadedFilesTable.kind,
      filename: uploadedFilesTable.filename,
      rowCount: uploadedFilesTable.rowCount,
      uploadedAt: uploadedFilesTable.uploadedAt,
    });

  res.status(201).json({ ...record, ...(itemMasterUpsert ? { itemMasterUpsert } : {}) });
});

const HEADER_HINTS = ["item code", "item no.", "old item code", "colour", "color", "qty", "balance_qty", "segment"];

/**
 * Locates the real header row within the first few rows of a sheet. Some
 * source workbooks have title/subtotal rows before the actual column
 * headers, so we can't assume row 0 is the header.
 */
function findHeaderRowIndex(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const cells = (rows[i] ?? []).map((c) => String(c ?? "").trim().toLowerCase());
    const hits = cells.filter((c) => HEADER_HINTS.includes(c)).length;
    if (hits >= 2) return i;
  }
  return 0;
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

/**
 * Map a raw material/group/category string from the Plumbing FG Stock file to
 * one of the 12 canonical Plumbing categories used in item_master.
 * Mirrors the mapGroupToCategory logic in seasonality-engine.ts.
 *
 * FG Stock file Category column uses the format: CPVC-PIPE, CPVC-FG, UPVC-PIPE,
 * UPVC-FG, SWR-PIPE, SWR-FG, Agri-Pipe, AGRI-FG, CPVC-SOLVENT, SWR-CEMENT, etc.
 * The "-FG" suffix means "Fitting/Finished Goods" (= Fitting in the canonical catalogue).
 *
 * 12 canonical categories: 4 materials (CPVC, UPVC, SWR, AGRI) × 3 types (Pipe, Fitting, Solvent).
 *
 * Returns null for strings that cannot be mapped (row is skipped for item_master).
 */
function inferPlumbingCategory(raw: string): string | null {
  const g = raw.trim().toUpperCase();

  // Explicitly exclude non-manufactured categories that must not enter the production plan.
  // These appear in the FG Stock file but are traded (not produced) or otherwise out of scope.
  if (
    g.includes("TRADING") ||         // e.g. CPVC-TRADING — traded, not manufactured
    g.includes("WATER TANK") ||       // Water tanks — out of scope
    g.includes("COLUMN PIPE") ||      // Column Pipe — separate category
    g.includes("PPR")                 // PPR fittings — separate category
  ) {
    return null;
  }

  // Detect SOLVENT/CEMENT BEFORE the generic Pipe/Fitting check — material is resolved first
  // so that "CPVC-SOLVENT" → "CPVC Solvent" (not "CPVC Pipe") and "SWR CEMENT" → "SWR Solvent".
  const isSolvent = g.includes("SOLVENT") || g.includes("CEMENT");
  if (isSolvent) {
    if (g.includes("CPVC")) return "CPVC Solvent";
    if (g.includes("UPVC")) return "UPVC Solvent";
    if (g.includes("SWR"))  return "SWR Solvent";
    if (g.includes("AGRI") || g.includes("AGRICULTURE")) return "AGRI Solvent";
    return null; // SOLVENT without a known material prefix — skip
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
function applyPendingOrderAlias(code: string, colour: string): { code: string; colour: string } {
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

function extractRows(workbook: XLSX.WorkBook, kind: string): Record<string, unknown>[] {
  if (kind === "pending_orders") {
    // DATA.xlsx — shared across ALL segments (PTMT + Plumbing).
    // Store every row; plan.ts filters by segment when consuming.
    // The alias transform is applied here to all rows; it is a no-op for non-PTMT codes
    // (the suffix patterns -LSBB/-LSTBB/-LSQBB only appear in PTMT codes).
    const sheetName = workbook.SheetNames.find((name) => /pending/i.test(name)) ?? workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = sheetToObjects(sheet);
    return json.map((row) => {
      const rawCode = String(row["Old Item Code"] ?? row["Item No."] ?? "");
      const rawColour = String(row["Color"] ?? row["Colour"] ?? "");
      const { code, colour } = applyPendingOrderAlias(rawCode, rawColour);
      return { ...row, "Old Item Code": code, "Item No.": code, Colour: colour, Color: colour };
    });
  }

  if (kind === "current_stock") {
    // F.G. STOCK factory Excel → "F.G Sheet" tab.
    // Col A = Item Code, Col B = Colour, Col C = C/Stock.
    // Normalize "C/Stock" → "Qty" so sumByKey in plan.ts works unchanged.
    const fgSheetName =
      workbook.SheetNames.find((n) => /f\.g\.?\s*sheet/i.test(n)) ??
      workbook.SheetNames.find((n) => /f\.g/i.test(n)) ??
      workbook.SheetNames.find((n) => /stock/i.test(n)) ??
      workbook.SheetNames[0];
    const fgSheet = workbook.Sheets[fgSheetName];
    const rows = sheetToObjects(fgSheet);
    return rows.map((row) => {
      const normalized: Record<string, unknown> = { ...row };
      // Rename "C/Stock" (and common variants) to "Qty" for downstream aggregation
      const cstockKey = Object.keys(normalized).find((k) => /c[\s/\\]?stock/i.test(k));
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
    const sheetName =
      workbook.SheetNames.find((n) => /^ptmt$/i.test(n)) ??
      workbook.SheetNames.find((n) => /ptmt/i.test(n)) ??
      workbook.SheetNames.find((n) => /last.month.pending/i.test(n)) ??
      workbook.SheetNames.find((n) => /pending/i.test(n)) ??
      workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return sheetToObjects(sheet);
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
    const sheetName =
      workbook.SheetNames.find((n) => /^fg\s*stock$/i.test(n)) ??
      workbook.SheetNames.find((n) => /fg.stock/i.test(n)) ??
      workbook.SheetNames.find((n) => /stock/i.test(n)) ??
      workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
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
    // Resolve column indices from headers — fall back to fixed A/C/R positions if not found
    const iCode = Math.max(0, headers.findIndex((h) => /item\s*code/i.test(h)));
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
      const category = String(row[iCat] ?? "").trim();
      const netStockRaw = row[iNet];
      const netStock =
        typeof netStockRaw === "number"
          ? netStockRaw
          : Number(String(netStockRaw ?? "").replace(/,/g, "")) || 0;
      if (netStock === 0) continue; // skip zero rows
      out.push({ "Item Code": itemCode, Category: category, "Net Stock": netStock });
    }
    return out;
  }

  const sheetName = workbook.SheetNames.find((name) => /^ptmt$/i.test(name)) ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return sheetToObjects(sheet);
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

    // Category column: try direct "Category", "GROUP", "Group", "Material", "Material Type"
    const rawCategory = String(
      row["Category"] ?? row["GROUP"] ?? row["Group"] ?? row["Material"] ??
      row["Material Type"] ?? row["MATERIAL"] ?? row["type"] ?? ""
    ).trim();

    const category = rawCategory ? inferPlumbingCategory(rawCategory) : null;
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
