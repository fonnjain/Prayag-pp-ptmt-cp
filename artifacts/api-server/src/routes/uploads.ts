import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db, uploadedFilesTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const VALID_KINDS = new Set(["pending_orders", "last_month_pending", "current_stock"]);

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

  let rows: Record<string, unknown>[];
  try {
    const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
    rows = extractRows(workbook, raw);
  } catch (err) {
    req.log.warn({ err }, "Failed to parse uploaded workbook");
    res.status(400).json({ error: "Could not parse the uploaded Excel file" });
    return;
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

  res.status(201).json(record);
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
    const sheetName = workbook.SheetNames.find((name) => /stock/i.test(name)) ?? workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return sheetToObjects(sheet);
  }

  const sheetName = workbook.SheetNames.find((name) => /^ptmt$/i.test(name)) ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return sheetToObjects(sheet);
}

export default router;
