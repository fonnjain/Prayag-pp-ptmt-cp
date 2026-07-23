import { Router, type IRouter } from "express";
import { db, correctivePlanRunsTable, correctivePlanItemsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { runCorrectiveReplan, type CorrectiveItemResult } from "../lib/corrective-engine";
import ExcelJS from "exceljs";

const router: IRouter = Router();

const STATUS_COLORS: Record<string, string> = {
  "on-plan":     "FF22C55E",
  "carried-over":"FFFBBF24",
  "demand-spike":"FFED8936",
  "deferred":    "FFEF4444",
  "unfulfillable":"FFDC2626",
  "replenished": "FF94A3B8",
  "new-item":    "FF6366F1",
};

// ─── POST /corrective/replan ─────────────────────────────────────────────────
router.post("/corrective/replan", async (req, res): Promise<void> => {
  const { month, weekClosed, asOfDate, segment, dailyCapacity, workingDaysPerWeek } = req.body as {
    month?: string;
    weekClosed?: number;
    asOfDate?: string;
    segment?: string;
    dailyCapacity?: number;
    workingDaysPerWeek?: number;
  };

  if (!month || typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month is required (YYYY-MM)" });
    return;
  }

  if (asOfDate !== undefined) {
    if (typeof asOfDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(asOfDate)) {
      res.status(400).json({ error: "asOfDate must be YYYY-MM-DD" });
      return;
    }
  } else {
    if (weekClosed === undefined || typeof weekClosed !== "number" || weekClosed < 0 || weekClosed > 3) {
      res.status(400).json({ error: "weekClosed is required (0=none, 1=after W1, 2=after W2, 3=after W3) unless asOfDate is provided" });
      return;
    }
  }

  const seg = (typeof segment === "string" && segment.trim()) ? segment.trim() : "PTMT";
  const effectiveWeekClosed = asOfDate !== undefined ? 0 : (weekClosed as number);

  try {
    const result = await runCorrectiveReplan({ month, weekClosed: effectiveWeekClosed, asOfDate, segment: seg, dailyCapacity, workingDaysPerWeek });
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "corrective/replan failed");
    res.status(500).json({ error: "Corrective replan failed", detail: String(err) });
  }
});

// ─── GET /corrective/runs ────────────────────────────────────────────────────
router.get("/corrective/runs", async (req, res): Promise<void> => {
  const month = req.query.month ? String(req.query.month) : undefined;
  const segment = req.query.segment ? String(req.query.segment) : undefined;

  let query = db
    .select()
    .from(correctivePlanRunsTable)
    .orderBy(desc(correctivePlanRunsTable.createdAt))
    .$dynamic();

  if (month && segment) {
    query = query.where(and(eq(correctivePlanRunsTable.month, month), eq(correctivePlanRunsTable.segment, segment)));
  } else if (month) {
    query = query.where(eq(correctivePlanRunsTable.month, month));
  } else if (segment) {
    query = query.where(eq(correctivePlanRunsTable.segment, segment));
  }

  const runs = await query;
  res.json(runs.map(r => ({
    id: r.id,
    segment: r.segment,
    month: r.month,
    weekClosed: r.weekClosed,
    asOfDate: r.asOfDate,
    note: r.note,
    dailyCapacity: r.dailyCapacity,
    producedToDate: r.producedToDate,
    newOrdersQty: r.newOrdersQty,
    originalMonthTotal: r.originalMonthTotal,
    revisedMonthTotal: r.revisedMonthTotal,
    unfulfillableQty: r.unfulfillableQty,
    warnings: r.warningsJson,
    createdAt: r.createdAt,
  })));
});

// ─── GET /corrective/runs/:id ────────────────────────────────────────────────
router.get("/corrective/runs/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [run] = await db.select().from(correctivePlanRunsTable).where(eq(correctivePlanRunsTable.id, id));
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }

  const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, id));

  res.json({
    runId: run.id,
    segment: run.segment,
    month: run.month,
    weekClosed: run.weekClosed,
    asOfDate: run.asOfDate,
    note: run.note,
    dailyCapacity: run.dailyCapacity,
    workingDaysPerWeek: run.workingDaysPerWeek,
    producedToDate: run.producedToDate,
    newOrdersQty: run.newOrdersQty,
    originalMonthTotal: run.originalMonthTotal,
    revisedMonthTotal: run.revisedMonthTotal,
    unfulfillableQty: run.unfulfillableQty,
    weekStats: run.weekStatsJson,
    warnings: run.warningsJson,
    items: items.map(i => ({
      itemCode: i.itemCode,
      colour: i.colour,
      category: i.category,
      avg3MoSale: i.avg3MoSale,
      bufferMultiplier: i.bufferMultiplier,
      stockOpen: i.stockOpen,
      producedToDate: i.producedToDate,
      stockNow: i.stockNow,
      pendingAtPlan: i.pendingAtPlan,
      pendingNow: i.pendingNow,
      pendingLastMonth: i.pendingLastMonth,
      originalPlan: i.originalPlan,
      originalWeek: i.originalWeek,
      bufferReqRev: i.bufferReqRev,
      planRev: i.planRev,
      remainingToProduce: i.remainingToProduce,
      deltaNewOrders: i.deltaNewOrders,
      deltaProduction: i.deltaProduction,
      deltaNet: i.deltaNet,
      coverNow: i.coverNow,
      newWeek: i.newWeek,
      w1Rev: i.w1Rev,
      w2Rev: i.w2Rev,
      w3Rev: i.w3Rev,
      w4Rev: i.w4Rev,
      status: i.status,
      isNewItem: i.isNewItem === 1,
    })),
  });
});

// ─── Shared Excel builder ─────────────────────────────────────────────────────

async function buildCorrectiveExcel(run: typeof correctivePlanRunsTable.$inferSelect, items: (typeof correctivePlanItemsTable.$inferSelect)[]): Promise<Buffer> {
  const segmentLabel = run.segment ?? "PTMT";
  const wb = new ExcelJS.Workbook();
  wb.creator = "PTMT Production Planning";

  // ── Sheet 1: Summary ──
  const sumSh = wb.addWorksheet("Corrective Summary");
  sumSh.columns = [
    { header: "Metric", key: "metric", width: 36 },
    { header: "Value", key: "value", width: 20 },
  ];
  const weekStats = (run.weekStatsJson as Array<{ weekLabel: string; released: number; capacity: number; produced: number; lag: number; loadFactor: number }>) ?? [];
  const summaryRows = [
    ["Segment", segmentLabel],
    ["Month", run.month],
    ["Week Closed", `W${run.weekClosed}`],
    ["Daily Capacity (pcs)", run.dailyCapacity.toLocaleString()],
    ["Produced To Date (pcs)", Math.round(run.producedToDate).toLocaleString()],
    ["New Orders This Month (pcs)", Math.round(run.newOrdersQty).toLocaleString()],
    ["Original Month Total (pcs)", Math.round(run.originalMonthTotal).toLocaleString()],
    ["Revised Month Total (pcs)", Math.round(run.revisedMonthTotal).toLocaleString()],
    ["Unfulfillable This Month (pcs)", Math.round(run.unfulfillableQty).toLocaleString()],
    ["Run Date", new Date(run.createdAt).toLocaleString("en-IN")],
    ...weekStats.map(ws => [
      `${ws.weekLabel}: Load Factor`,
      `${ws.loadFactor.toFixed(2)}× (${Math.round(ws.released).toLocaleString()} vs cap ${Math.round(ws.capacity).toLocaleString()})`,
    ]),
  ];
  summaryRows.forEach(([metric, value]) => sumSh.addRow({ metric, value }));
  sumSh.getRow(1).font = { bold: true };

  // ── Sheet 2: Revised Release ──
  const relSh = wb.addWorksheet("Revised Release");
  relSh.columns = [
    { header: "Category", key: "category", width: 24 },
    { header: "Item Code", key: "itemCode", width: 14 },
    { header: "Colour", key: "colour", width: 12 },
    { header: "Orig Plan", key: "originalPlan", width: 12 },
    { header: "Orig Wk", key: "originalWeek", width: 10 },
    { header: "Produced", key: "producedToDate", width: 12 },
    { header: "New Orders Δ", key: "deltaNewOrders", width: 14 },
    { header: "Revised Plan", key: "planRev", width: 12 },
    { header: "Rev Plan (kg)", key: "kgRev", width: 14 },
    { header: "Remaining", key: "remainingToProduce", width: 12 },
    { header: "Remaining (kg)", key: "remainingKg", width: 14 },
    { header: "Cover Now", key: "coverNow", width: 12 },
    { header: "New Wk", key: "newWeek", width: 10 },
    { header: "W1 Rev", key: "w1Rev", width: 10 },
    { header: "W2 Rev", key: "w2Rev", width: 10 },
    { header: "W3 Rev", key: "w3Rev", width: 10 },
    { header: "W4 Rev", key: "w4Rev", width: 10 },
    { header: "Status", key: "status", width: 16 },
    { header: "Δ Net", key: "deltaNet", width: 12 },
  ];
  relSh.getRow(1).font = { bold: true };
  relSh.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };

  for (const item of items) {
    const row = relSh.addRow({
      category: item.category,
      itemCode: item.itemCode,
      colour: item.colour,
      originalPlan: Math.round(item.originalPlan),
      originalWeek: item.originalWeek ? `W${item.originalWeek}` : "—",
      producedToDate: Math.round(item.producedToDate),
      deltaNewOrders: Math.round(item.deltaNewOrders),
      planRev: Math.round(item.planRev),
      remainingToProduce: Math.round(item.remainingToProduce),
      coverNow: item.coverNow !== null ? item.coverNow.toFixed(2) : "OS",
      newWeek: item.newWeek ? `W${item.newWeek}` : "—",
      w1Rev: Math.round(item.w1Rev) || "",
      w2Rev: Math.round(item.w2Rev) || "",
      w3Rev: Math.round(item.w3Rev) || "",
      w4Rev: Math.round(item.w4Rev) || "",
      status: item.status,
      deltaNet: Math.round(item.deltaNet),
    });

    const statusColor = STATUS_COLORS[item.status] ?? "FFFFFFFF";
    const statusCell = row.getCell("status");
    statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: statusColor } };
    statusCell.font = { color: { argb: "FFFFFFFF" } };

    if (item.deltaNet > 0) {
      row.getCell("deltaNet").font = { color: { argb: "FFEF4444" } };
    } else if (item.deltaNet < 0) {
      row.getCell("deltaNet").font = { color: { argb: "FF22C55E" } };
    }
  }

  // ── Sheet 3: Warnings ──
  const warnSh = wb.addWorksheet("Warnings");
  warnSh.columns = [
    { header: "Code", key: "code", width: 30 },
    { header: "Severity", key: "severity", width: 12 },
    { header: "Message", key: "message", width: 80 },
    { header: "Value", key: "value", width: 16 },
    { header: "Threshold", key: "threshold", width: 16 },
  ];
  warnSh.getRow(1).font = { bold: true };
  const warnings = (run.warningsJson as Array<{ code: string; severity: string; message: string; value?: number; threshold?: number }>) ?? [];
  for (const w of warnings) {
    warnSh.addRow({ code: w.code, severity: w.severity, message: w.message, value: w.value, threshold: w.threshold });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ─── GET /corrective/runs/:id/export/excel ───────────────────────────────────
router.get("/corrective/runs/:id/export/excel", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [run] = await db.select().from(correctivePlanRunsTable).where(eq(correctivePlanRunsTable.id, id));
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }

  const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, id));

  const buffer = await buildCorrectiveExcel(run, items);
  const segLabel = run.segment ?? "PTMT";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${segLabel}_Corrective_Plan_${run.month}_W${run.weekClosed}.xlsx"`);
  res.send(buffer);
});

// ─── GET /corrective/runs/:id/export/pdf ─────────────────────────────────────
router.get("/corrective/runs/:id/export/pdf", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "invalid id" }); return; }

  const [run] = await db.select().from(correctivePlanRunsTable).where(eq(correctivePlanRunsTable.id, id));
  if (!run) { res.status(404).json({ error: "Run not found" }); return; }

  const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, id));

  try {
    const html = buildCorrectivePdfHtml(run, items as unknown as CorrectiveItemResult[]);
    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdfUint8 = await page.pdf({ format: "A4", landscape: true, printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" } });
      const segLabel = run.segment ?? "PTMT";
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${segLabel}_Corrective_Plan_${run.month}_W${run.weekClosed}.pdf"`);
      res.send(Buffer.from(pdfUint8));
    } finally {
      await browser.close();
    }
  } catch (err) {
    req.log.error({ err }, "corrective/export/pdf failed");
    res.status(500).json({ error: "PDF generation failed", detail: String(err) });
  }
});

// ─── GET /corrective/export/excel?month=&segment= ────────────────────────────
router.get("/corrective/export/excel", async (req, res): Promise<void> => {
  const month = req.query.month ? String(req.query.month) : undefined;
  const segment = req.query.segment ? String(req.query.segment) : "PTMT";

  if (!month) { res.status(400).json({ error: "month is required" }); return; }

  const [run] = await db.select()
    .from(correctivePlanRunsTable)
    .where(and(eq(correctivePlanRunsTable.month, month), eq(correctivePlanRunsTable.segment, segment)))
    .orderBy(desc(correctivePlanRunsTable.createdAt))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: `No corrective run found for ${month} / ${segment}. Run the corrective re-plan first.` });
    return;
  }

  const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, run.id));

  const buffer = await buildCorrectiveExcel(run, items);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${segment}_Corrective_Plan_${month}_W${run.weekClosed}.xlsx"`);
  res.send(buffer);
});

// ─── GET /corrective/export/pdf?month=&segment= ───────────────────────────────
router.get("/corrective/export/pdf", async (req, res): Promise<void> => {
  const month = req.query.month ? String(req.query.month) : undefined;
  const segment = req.query.segment ? String(req.query.segment) : "PTMT";

  if (!month) { res.status(400).json({ error: "month is required" }); return; }

  const [run] = await db.select()
    .from(correctivePlanRunsTable)
    .where(and(eq(correctivePlanRunsTable.month, month), eq(correctivePlanRunsTable.segment, segment)))
    .orderBy(desc(correctivePlanRunsTable.createdAt))
    .limit(1);

  if (!run) {
    res.status(404).json({ error: `No corrective run found for ${month} / ${segment}. Run the corrective re-plan first.` });
    return;
  }

  const items = await db.select().from(correctivePlanItemsTable).where(eq(correctivePlanItemsTable.runId, run.id));

  try {
    const html = buildCorrectivePdfHtml(run, items as unknown as CorrectiveItemResult[]);
    const puppeteer = (await import("puppeteer")).default;
    const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setContent(html, { waitUntil: "networkidle0" });
      const pdfUint8 = await page.pdf({ format: "A4", landscape: true, printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" } });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${segment}_Corrective_Plan_${month}_W${run.weekClosed}.pdf"`);
      res.send(Buffer.from(pdfUint8));
    } finally {
      await browser.close();
    }
  } catch (err) {
    req.log.error({ err }, "corrective/export/pdf failed");
    res.status(500).json({ error: "PDF generation failed", detail: String(err) });
  }
});

// ─── PDF HTML builder ─────────────────────────────────────────────────────────

const h = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtN = (n: number) => Math.round(n).toLocaleString("en-IN");

const STATUS_LABEL: Record<string, string> = {
  "on-plan": "On Plan", "carried-over": "Carried Over", "demand-spike": "Demand Spike",
  "deferred": "Deferred", "unfulfillable": "Unfulfillable", "replenished": "Replenished", "new-item": "New Item",
};
const STATUS_BG: Record<string, string> = {
  "on-plan": "#dcfce7", "carried-over": "#fef3c7", "demand-spike": "#ffedd5",
  "deferred": "#fee2e2", "unfulfillable": "#fecaca", "replenished": "#f1f5f9", "new-item": "#e0e7ff",
};
const STATUS_COLOR: Record<string, string> = {
  "on-plan": "#166534", "carried-over": "#92400e", "demand-spike": "#9a3412",
  "deferred": "#b91c1c", "unfulfillable": "#7f1d1d", "replenished": "#374151", "new-item": "#3730a3",
};

function buildCorrectivePdfHtml(
  run: typeof correctivePlanRunsTable.$inferSelect,
  items: CorrectiveItemResult[],
): string {
  const weekStats = (run.weekStatsJson as Array<{ weekLabel: string; released: number; capacity: number; produced: number; lag: number; loadFactor: number }>) ?? [];
  const warnings = (run.warningsJson as Array<{ code: string; severity: string; message: string }>) ?? [];
  const segLabel = run.segment ?? "PTMT";

  // Group items by category, only those needing action
  const byCat = new Map<string, CorrectiveItemResult[]>();
  for (const item of items) {
    if (item.remainingToProduce <= 0 && item.status === "replenished") continue;
    const arr = byCat.get(item.category) ?? [];
    arr.push(item);
    byCat.set(item.category, arr);
  }

  const WEEK_COLORS = ["#f97316", "#eab308", "#22c55e", "#3b82f6"];

  const catSections = [...byCat.entries()].map(([cat, catItems]) => {
    const rows = catItems
      .sort((a, b) => (a.coverNow ?? 999) - (b.coverNow ?? 999))
      .map(item => `
        <tr>
          <td>${h(item.itemCode)}</td>
          <td>${h(item.colour)}</td>
          <td style="text-align:right">${fmtN(item.originalPlan)}</td>
          <td style="text-align:right">${fmtN(item.producedToDate)}</td>
          <td style="text-align:right;color:${item.deltaNewOrders > 0 ? "#c2410c" : "#374151"}">${item.deltaNewOrders !== 0 ? (item.deltaNewOrders > 0 ? "+" : "") + fmtN(item.deltaNewOrders) : "—"}</td>
          <td style="text-align:right;font-weight:bold">${fmtN(item.planRev)}</td>
          <td style="text-align:right;font-weight:bold">${fmtN(item.remainingToProduce)}</td>
          <td style="text-align:right">${item.coverNow !== null ? item.coverNow.toFixed(2) : "OS"}</td>
          <td style="text-align:center">${item.newWeek ? `<span style="background:${WEEK_COLORS[(item.newWeek ?? 1) - 1]};color:#fff;padding:1px 6px;border-radius:3px;font-weight:bold">W${item.newWeek}</span>` : "—"}</td>
          <td><span style="background:${STATUS_BG[item.status] ?? "#f3f4f6"};color:${STATUS_COLOR[item.status] ?? "#374151"};padding:1px 5px;border-radius:3px;font-size:9px">${STATUS_LABEL[item.status] ?? item.status}</span></td>
        </tr>`
      ).join("");
    return `
      <div style="margin-bottom:18px;page-break-inside:avoid">
        <h3 style="font-size:11px;margin:0 0 5px;color:#0f172a;border-bottom:1.5px solid #e2e8f0;padding-bottom:3px">${h(cat)}</h3>
        <table style="width:100%;border-collapse:collapse;font-size:8.5px">
          <thead>
            <tr style="background:#f1f5f9">
              <th style="text-align:left;padding:3px 5px">Code</th>
              <th style="text-align:left;padding:3px 5px">Colour</th>
              <th style="text-align:right;padding:3px 5px">Orig Plan</th>
              <th style="text-align:right;padding:3px 5px">Produced</th>
              <th style="text-align:right;padding:3px 5px">Orders Δ</th>
              <th style="text-align:right;padding:3px 5px">Revised</th>
              <th style="text-align:right;padding:3px 5px">Remaining</th>
              <th style="text-align:right;padding:3px 5px">Cover</th>
              <th style="text-align:center;padding:3px 5px">New Wk</th>
              <th style="text-align:left;padding:3px 5px">Status</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join("");

  const weekRow = weekStats.map((ws, i) => `
    <td style="text-align:right;padding:4px 8px;color:${WEEK_COLORS[i] ?? "#374151"};font-weight:bold">${h(ws.weekLabel)}</td>
    <td style="text-align:right;padding:4px 8px">${fmtN(ws.released)}</td>
    <td style="text-align:right;padding:4px 8px">${fmtN(ws.capacity)}</td>
    <td style="text-align:right;padding:4px 8px;font-weight:bold;color:${ws.loadFactor > 1.05 ? "#b91c1c" : "#166534"}">${ws.loadFactor.toFixed(1)}×</td>
    <td style="text-align:right;padding:4px 8px;color:#16a34a">${ws.produced > 0 ? fmtN(ws.produced) : "—"}</td>
    <td style="text-align:right;padding:4px 8px;color:${ws.lag > 0 ? "#b91c1c" : "#9ca3af"}">${ws.lag > 0 ? fmtN(ws.lag) : "—"}</td>`
  ).join("</tr><tr>");

  const warnRows = warnings.map(w => {
    const sevColor = w.severity === "critical" ? "#fecaca" : w.severity === "high" ? "#ffedd5" : w.severity === "medium" ? "#fef3c7" : "#dbeafe";
    return `<tr><td style="padding:3px 5px;background:${sevColor};font-weight:bold">${h(w.severity)}</td><td style="padding:3px 5px">${h(w.code)}</td><td style="padding:3px 5px">${h(w.message)}</td></tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
  * { box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 9px; color: #1e293b; margin: 0; padding: 8px 12px; }
  h1 { font-size: 15px; font-weight: bold; margin: 0 0 4px; }
  h2 { font-size: 11px; font-weight: bold; margin: 14px 0 5px; color: #0f172a; border-bottom: 1.5px solid #e2e8f0; padding-bottom: 3px; }
  table { border-collapse: collapse; width: 100%; }
  th { background: #f1f5f9; padding: 3px 5px; border: 1px solid #cbd5e1; text-align: left; font-size: 8px; font-weight: bold; }
  td { border: 1px solid #e2e8f0; padding: 2px 5px; }
  .kpi-row { display: flex; gap: 10px; margin-bottom: 12px; flex-wrap: wrap; }
  .kpi { border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 10px; min-width: 130px; }
  .kpi .label { font-size: 8px; color: #6b7280; margin-bottom: 2px; }
  .kpi .val { font-size: 15px; font-weight: bold; }
</style>
</head>
<body>
  <h1>${h(segLabel)} Corrective Re-Plan — ${h(run.month)} — Week ${run.weekClosed} closed</h1>
  <p style="font-size:8px;color:#6b7280;margin:0 0 10px">Generated: ${new Date().toLocaleString("en-IN")} &nbsp;|&nbsp; Run #${run.id}</p>

  <div class="kpi-row">
    <div class="kpi"><div class="label">Original Plan</div><div class="val">${fmtN(run.originalMonthTotal)} pcs</div></div>
    <div class="kpi"><div class="label">Revised Plan</div><div class="val">${fmtN(run.revisedMonthTotal)} pcs</div></div>
    <div class="kpi"><div class="label">Produced To Date</div><div class="val">${fmtN(run.producedToDate)} pcs</div></div>
    <div class="kpi"><div class="label">New Orders</div><div class="val" style="color:#c2410c">+${fmtN(run.newOrdersQty)} pcs</div></div>
    <div class="kpi"><div class="label">Unfulfillable</div><div class="val" style="color:${run.unfulfillableQty > 0 ? "#b91c1c" : "#166534"}">${fmtN(run.unfulfillableQty)} pcs</div></div>
  </div>

  ${weekStats.length > 0 ? `
  <h2>Week-by-Week Summary</h2>
  <table style="margin-bottom:12px">
    <thead><tr>
      <th>Week</th><th style="text-align:right">Original Release</th><th style="text-align:right">Capacity</th>
      <th style="text-align:right">Load Factor</th><th style="text-align:right">Produced</th><th style="text-align:right">Lag</th>
    </tr></thead>
    <tbody><tr>${weekRow}</tr></tbody>
  </table>` : ""}

  ${warnings.length > 0 ? `
  <h2>Warnings (${warnings.length})</h2>
  <table style="margin-bottom:12px">
    <thead><tr><th>Severity</th><th>Code</th><th>Message</th></tr></thead>
    <tbody>${warnRows}</tbody>
  </table>` : ""}

  <h2>Revised Release by Category</h2>
  ${catSections || '<p style="color:#9ca3af;font-size:9px">No actionable items — all items are replenished or unfulfillable.</p>'}
</body>
</html>`;
}

export default router;
