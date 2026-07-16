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
  "plumbing_current_stock",
  "plumbing_pending_orders",
  "plumbing_last_month_pending",
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
  if (raw === "plumbing_current_stock") {
    try {
      itemMasterUpsert = await upsertPlumbingItemMaster(rows);
      req.log.info(itemMasterUpsert, "Plumbing item_master upserted from stock upload");
    } catch (err) {
      req.log.warn({ err }, "Plumbing item_master upsert failed — stock stored, item_master unchanged");
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
 * Map a raw material/group/category string from the Plumbing stock file to
 * one of the 8 canonical Plumbing categories used in item_master.
 * Mirrors the mapGroupToCategory logic in seasonality-engine.ts.
 * Returns null for strings that cannot be mapped (row is skipped for item_master).
 */
function inferPlumbingCategory(raw: string): string | null {
  const g = raw.trim().toUpperCase();
  const isFitting = g.includes("FITTING") || g.includes("FTG");
  if (g.includes("CPVC")) return isFitting ? "CPVC Fitting" : "CPVC Pipe";
  if (g.includes("UPVC")) return isFitting ? "UPVC Fitting" : "UPVC Pipe";
  if (g.includes("SWR")) return isFitting ? "SWR Fitting" : "SWR Pipe";
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
    const sheetName = workbook.SheetNames.find((name) => /pending/i.test(name)) ?? workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = sheetToObjects(sheet);
    return json
      .filter((row) => {
        const segment = String(row["Segment"] ?? "").trim().toUpperCase();
        return segment === "PTMT" || segment === "PT";
      })
      .map((row) => {
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

  if (kind === "plumbing_pending_orders") {
    // Plumbing pending orders: DATA.xlsx or similar; filter for PLUMBING segment rows.
    const sheetName =
      workbook.SheetNames.find((n) => /pending/i.test(n)) ?? workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = sheetToObjects(sheet);
    return json.filter((row) => {
      const seg = String(row["Segment"] ?? "").trim().toUpperCase();
      // Accept rows that are explicitly PLUMBING, or have no Segment filter (Plumbing-only files)
      return !seg || seg === "PLUMBING" || seg === "P";
    });
  }

  if (kind === "plumbing_last_month_pending") {
    // Plumbing last-month pending: look for a Plumbing or first tab.
    const sheetName =
      workbook.SheetNames.find((n) => /plumbing/i.test(n)) ??
      workbook.SheetNames.find((n) => /pending/i.test(n)) ??
      workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return sheetToObjects(sheet);
  }

  if (kind === "plumbing_current_stock") {
    // Plumbing stock file: look for a Plumbing or F.G. sheet tab.
    // Normalizes C/Stock → Qty. Category info is extracted separately for item_master.
    const sheetName =
      workbook.SheetNames.find((n) => /plumbing/i.test(n)) ??
      workbook.SheetNames.find((n) => /f\.g\.?\s*sheet/i.test(n)) ??
      workbook.SheetNames.find((n) => /f\.g/i.test(n)) ??
      workbook.SheetNames.find((n) => /stock/i.test(n)) ??
      workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = sheetToObjects(sheet);
    return rows.map((row) => {
      const normalized: Record<string, unknown> = { ...row };
      const cstockKey = Object.keys(normalized).find((k) => /c[\s/\\]?stock|stock\s*qty/i.test(k));
      if (cstockKey && cstockKey !== "Qty") {
        normalized["Qty"] = normalized[cstockKey];
        delete normalized[cstockKey];
      }
      return normalized;
    });
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
