import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db, uploadedFilesTable } from "@workspace/db";
import { desc } from "drizzle-orm";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

const VALID_KINDS = new Set(["pending_orders", "last_month_pending"]);

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

function extractRows(workbook: XLSX.WorkBook, kind: string): Record<string, unknown>[] {
  if (kind === "pending_orders") {
    const sheetName = workbook.SheetNames.find((name) => /pending/i.test(name)) ?? workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    return json.filter((row) => {
      const segment = String(row["Segment"] ?? "").trim().toUpperCase();
      return segment === "PTMT" || segment === "PT";
    });
  }

  const sheetName = workbook.SheetNames.find((name) => /ptmt/i.test(name)) ?? workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
}

export default router;
