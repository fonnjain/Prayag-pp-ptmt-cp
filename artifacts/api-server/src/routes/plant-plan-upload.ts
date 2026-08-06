/**
 * Plant Production Plan Upload
 *
 * POST /monitoring/plant-plan  — multipart, parses the capacity-feasible Excel from the plant
 * GET  /monitoring/plant-plan  — list uploads for a month+segment
 * GET  /monitoring/plant-plan/:id/items — full item list for one upload
 * DELETE /monitoring/plant-plan/:id — remove an upload (cascade deletes items)
 *
 * Excel format expected (capacity_feasible_plan xlsx from the machine scheduler):
 *   Sheet "Pipe Plan"    — header row 3, cols: Item Code | Material | Requested pcs | Feasible pcs |
 *                          Shortfall pcs | Requested kg | Feasible kg | Shortfall kg | Machine(s) | Note
 *   Sheet "Fitting Plan" — same columns
 *   Sheet "Summary"     — header row 4, cols: Type | Material | Requested pcs | Feasible pcs |
 *                          Shortfall pcs | Shortfall % | Requested kg | Feasible kg | Shortfall kg
 */
import { Router, type IRouter } from "express";
import multer from "multer";
import * as XLSX from "xlsx";
import { db, plantPlanUploadsTable, plantPlanItemsTable } from "@workspace/db";
import { desc, eq, and } from "drizzle-orm";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ─── helpers ─────────────────────────────────────────────────────────────────

function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

interface SummaryRow {
  type: string;
  material: string;
  requestedPcs: number;
  feasiblePcs: number;
  shortfallPcs: number;
  shortfallPct: string;
  requestedKg: number;
  feasibleKg: number;
  shortfallKg: number;
}

interface ItemRow {
  itemType: string;
  itemCode: string;
  material: string;
  requestedPcs: number;
  feasiblePcs: number;
  shortfallPcs: number;
  requestedKg: number;
  feasibleKg: number;
  shortfallKg: number;
  machines: string;
  note: string;
}

function parseItemSheet(ws: XLSX.WorkSheet, itemType: "PIPE" | "FITTING"): ItemRow[] {
  const rows: ItemRow[] = [];
  // Header is on row 3 (0-indexed: row index 2). Data starts row 4.
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1:A1");
  for (let r = 3; r <= range.e.r; r++) {
    const cell = (col: number) => ws[XLSX.utils.encode_cell({ r, c: col })]?.v;
    const code = str(cell(0));
    if (!code || code.startsWith("Item Code")) continue; // skip blank / re-header rows
    rows.push({
      itemType,
      itemCode: code,
      material:     str(cell(1)),
      requestedPcs: num(cell(2)),
      feasiblePcs:  num(cell(3)),
      shortfallPcs: num(cell(4)),
      requestedKg:  num(cell(5)),
      feasibleKg:   num(cell(6)),
      shortfallKg:  num(cell(7)),
      machines:     str(cell(8)),
      note:         str(cell(9)),
    });
  }
  return rows;
}

function parseSummarySheet(ws: XLSX.WorkSheet): SummaryRow[] {
  const rows: SummaryRow[] = [];
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1:A1");
  for (let r = 3; r <= range.e.r; r++) {
    const cell = (col: number) => ws[XLSX.utils.encode_cell({ r, c: col })]?.v;
    const type = str(cell(0));
    if (!type || type === "Type") continue;
    rows.push({
      type,
      material:     str(cell(1)),
      requestedPcs: num(cell(2)),
      feasiblePcs:  num(cell(3)),
      shortfallPcs: num(cell(4)),
      shortfallPct: str(cell(5)),
      requestedKg:  num(cell(6)),
      feasibleKg:   num(cell(7)),
      shortfallKg:  num(cell(8)),
    });
  }
  return rows;
}

// ─── POST /monitoring/plant-plan ─────────────────────────────────────────────

router.post("/plant-plan", upload.single("file"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "No file provided" });
    return;
  }

  const month   = str(req.body?.month);
  const segment = str(req.body?.segment) || "Plumbing";

  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month is required and must be YYYY-MM" });
    return;
  }

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(req.file.buffer, { type: "buffer" });
  } catch {
    res.status(400).json({ error: "Could not parse the uploaded Excel file" });
    return;
  }

  // Parse item sheets — tolerate missing sheet names gracefully
  const allItems: ItemRow[] = [];
  const pipeSheet    = wb.Sheets["Pipe Plan"];
  const fittingSheet = wb.Sheets["Fitting Plan"];
  if (pipeSheet)    allItems.push(...parseItemSheet(pipeSheet,    "PIPE"));
  if (fittingSheet) allItems.push(...parseItemSheet(fittingSheet, "FITTING"));

  // Parse summary
  const summarySheet = wb.Sheets["Summary"];
  const summary = summarySheet ? parseSummarySheet(summarySheet) : [];

  if (allItems.length === 0) {
    res.status(400).json({
      error: `No items found. Expected sheets named "Pipe Plan" and/or "Fitting Plan". Found: ${wb.SheetNames.join(", ")}`,
    });
    return;
  }

  // Persist in a transaction
  const [uploadRecord] = await db.insert(plantPlanUploadsTable).values({
    month,
    segment,
    filename:    req.file.originalname,
    itemCount:   allItems.length,
    summaryJson: summary.length > 0 ? summary : null,
  }).returning();

  if (!uploadRecord) {
    res.status(500).json({ error: "Failed to create upload record" });
    return;
  }

  // Insert items in batches of 500
  const BATCH = 500;
  for (let i = 0; i < allItems.length; i += BATCH) {
    await db.insert(plantPlanItemsTable).values(
      allItems.slice(i, i + BATCH).map((it) => ({ ...it, uploadId: uploadRecord.id }))
    );
  }

  req.log?.info({ uploadId: uploadRecord.id, month, segment, itemCount: allItems.length }, "plant-plan uploaded");

  res.status(201).json({
    id:        uploadRecord.id,
    month,
    segment,
    filename:  req.file.originalname,
    itemCount: allItems.length,
    summary,
  });
});

// ─── GET /monitoring/plant-plan ──────────────────────────────────────────────

router.get("/plant-plan", async (req, res): Promise<void> => {
  const month   = str(req.query["month"]);
  const segment = str(req.query["segment"]) || undefined;

  const conditions = [];
  if (month) conditions.push(eq(plantPlanUploadsTable.month, month));
  if (segment) conditions.push(eq(plantPlanUploadsTable.segment, segment));

  const rows = await db
    .select()
    .from(plantPlanUploadsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(plantPlanUploadsTable.uploadedAt));

  res.json(rows);
});

// ─── GET /monitoring/plant-plan/:id/items ────────────────────────────────────

router.get("/plant-plan/:id/items", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [upload] = await db.select().from(plantPlanUploadsTable).where(eq(plantPlanUploadsTable.id, id));
  if (!upload) { res.status(404).json({ error: "Upload not found" }); return; }

  const items = await db.select().from(plantPlanItemsTable).where(eq(plantPlanItemsTable.uploadId, id));
  res.json({ upload, items });
});

// ─── DELETE /monitoring/plant-plan/:id ───────────────────────────────────────

router.delete("/plant-plan/:id", async (req, res): Promise<void> => {
  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.select({ id: plantPlanUploadsTable.id })
    .from(plantPlanUploadsTable).where(eq(plantPlanUploadsTable.id, id));
  if (!row) { res.status(404).json({ error: "Upload not found" }); return; }

  await db.delete(plantPlanUploadsTable).where(eq(plantPlanUploadsTable.id, id));
  res.status(204).end();
});

export default router;
