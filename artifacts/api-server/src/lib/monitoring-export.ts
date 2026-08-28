import type ExcelJS from "exceljs";
import type { PaceMetrics, Warning, RecommendedAction, MachineQuality } from "./monitoring-calc";
import { launchBrowser } from "./browser";

export interface MonitoringExportData {
  month: string;
  dataAvailable: boolean;
  lastDataDate: string | null;
  plant: PaceMetrics & { ragBand: string | null };
  categories: { category: string; target: number; requiredPerDay: number; ragBand: string | null }[];
  warnings: Warning[];
  actions: RecommendedAction[];
  machines: MachineQuality[];
  stockoutItems: { itemCode: string; colour: string; category: string; stock: number; pendingOrder: number }[];
}

const RED_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4CCCC" } };
const GREEN_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
const AMBER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE5CD" } };

function fillForRag(rag: string | null): ExcelJS.Fill | undefined {
  if (rag === "green") return GREEN_FILL;
  if (rag === "amber") return AMBER_FILL;
  if (rag === "red") return RED_FILL;
  return undefined;
}

function fmt(value: number | null | undefined): number | string {
  return value === null || value === undefined ? "n/a" : Math.round(value * 100) / 100;
}

function addDashboardSheet(workbook: ExcelJS.Workbook, data: MonitoringExportData): void {
  const sheet = workbook.addWorksheet("Dashboard");
  sheet.columns = [
    { header: "Metric", key: "metric", width: 28 },
    { header: "Value", key: "value", width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };
  sheet.addRow({ metric: `PTMT Production Monitoring — ${data.month}` });
  sheet.addRow({ metric: "Data available", value: data.dataAvailable ? "Yes" : "No" });
  sheet.addRow({ metric: "Last data date", value: data.lastDataDate ?? "n/a" });
  sheet.addRow({ metric: "Target (kg)", value: fmt(data.plant.targetKg) });
  sheet.addRow({ metric: "Output to date (kg)", value: fmt(data.plant.outputToDateKg) });
  sheet.addRow({ metric: "Required per day (kg)", value: fmt(data.plant.requiredPerDay) });
  sheet.addRow({ metric: "Actual per day (kg)", value: fmt(data.plant.actualPerDay) });
  sheet.addRow({ metric: "Attainment %", value: fmt(data.plant.attainmentPct) });
  sheet.addRow({ metric: "Projected month-end (kg)", value: fmt(data.plant.projectedMonthEnd) });
  sheet.addRow({ metric: "Projected attainment %", value: fmt(data.plant.projectedAttainmentPct) });
  const ragRow = sheet.addRow({ metric: "RAG band", value: data.plant.ragBand ?? "n/a" });
  const fill = fillForRag(data.plant.ragBand);
  if (fill) ragRow.getCell("value").fill = fill;

  sheet.addRow({});
  const catHeaderRow = sheet.addRow({ metric: "Category", value: "Target (kg) / Required per day / RAG" });
  catHeaderRow.font = { bold: true };
  for (const cat of data.categories) {
    const row = sheet.addRow({
      metric: cat.category,
      value: `${fmt(cat.target)} kg / ${fmt(cat.requiredPerDay)} per day`,
    });
    const catFill = fillForRag(cat.ragBand);
    if (catFill) row.getCell("value").fill = catFill;
  }
}

function addWarningsSheet(workbook: ExcelJS.Workbook, warnings: Warning[]): void {
  const sheet = workbook.addWorksheet("Warnings");
  sheet.columns = [
    { header: "Severity", key: "severity", width: 12 },
    { header: "Scope", key: "scope", width: 20 },
    { header: "Message", key: "message", width: 60 },
    { header: "Value", key: "value", width: 12 },
    { header: "Threshold", key: "threshold", width: 12 },
    { header: "Source", key: "source", width: 12 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const w of warnings) {
    const row = sheet.addRow({
      severity: w.severity,
      scope: w.scope,
      message: w.message,
      value: fmt(w.value),
      threshold: fmt(w.threshold),
      source: w.source,
    });
    if (w.severity === "critical" || w.severity === "high") row.getCell("severity").fill = RED_FILL;
    else if (w.severity === "medium") row.getCell("severity").fill = AMBER_FILL;
  }
}

function addActionsSheet(workbook: ExcelJS.Workbook, actions: RecommendedAction[]): void {
  const sheet = workbook.addWorksheet("Recommended Actions");
  sheet.columns = [
    { header: "Priority", key: "priority", width: 10 },
    { header: "Code", key: "code", width: 16 },
    { header: "Scope", key: "scope", width: 20 },
    { header: "Message", key: "message", width: 60 },
    { header: "Suggested Qty", key: "suggestedQty", width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const a of actions) {
    sheet.addRow({
      priority: a.priority,
      code: a.code,
      scope: a.scope,
      message: a.message,
      suggestedQty: fmt(a.suggestedQty),
    });
  }
}

function addQualitySheet(workbook: ExcelJS.Workbook, machines: MachineQuality[]): void {
  const sheet = workbook.addWorksheet("Machine Quality");
  const rejectionPctLabel = machines[0]?.totalCountBasis === "net"
    ? "Rejection % (rejects / good output)"
    : "Rejection % (rejects / total manufactured)";
  sheet.columns = [
    { header: "Machine", key: "machineId", width: 14 },
    { header: "Grinder", key: "isGrinder", width: 10 },
    { header: "Run Hours", key: "runHours", width: 12 },
    { header: "Ideal Hours", key: "idealHours", width: 12 },
    { header: "Utilisation %", key: "utilisationPct", width: 14 },
    { header: "Output (kg)", key: "outputKg", width: 12 },
    { header: "Rejection (kg)", key: "rejectionKg", width: 14 },
    { header: rejectionPctLabel, key: "rejectionPct", width: 34 },
    { header: "Good Output (kg)", key: "goodOutputKg", width: 16 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const m of machines) {
    sheet.addRow({
      machineId: m.machineId,
      isGrinder: m.isGrinder ? "Yes" : "No",
      runHours: fmt(m.runHours),
      idealHours: fmt(m.idealHours),
      utilisationPct: fmt(m.utilisationPct),
      outputKg: fmt(m.outputKg),
      rejectionKg: fmt(m.rejectionKg),
      rejectionPct: fmt(m.rejectionPct),
      goodOutputKg: fmt(m.goodOutputKg),
    });
  }
}

function addBacklogSheet(workbook: ExcelJS.Workbook, stockoutItems: MonitoringExportData["stockoutItems"]): void {
  const sheet = workbook.addWorksheet("Backlog");
  sheet.columns = [
    { header: "Item Code", key: "itemCode", width: 14 },
    { header: "Colour", key: "colour", width: 14 },
    { header: "Category", key: "category", width: 20 },
    { header: "Stock", key: "stock", width: 12 },
    { header: "Pending Order", key: "pendingOrder", width: 14 },
  ];
  sheet.getRow(1).font = { bold: true };
  for (const item of stockoutItems) {
    const row = sheet.addRow(item);
    row.getCell("stock").fill = RED_FILL;
  }
}

export async function exportMonitoringExcel(data: MonitoringExportData): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require("exceljs") as typeof import("exceljs");
  const workbook = new ExcelJS.Workbook();
  addDashboardSheet(workbook, data);
  addWarningsSheet(workbook, data.warnings);
  addActionsSheet(workbook, data.actions);
  addQualitySheet(workbook, data.machines);
  addBacklogSheet(workbook, data.stockoutItems);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function ragClass(rag: string | null): string {
  if (rag === "green") return "green";
  if (rag === "amber") return "amber";
  if (rag === "red") return "red";
  return "";
}

function fmtHtml(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : (Math.round(value * 100) / 100).toLocaleString();
}

function buildHtml(data: MonitoringExportData): string {
  const rejectionPctLabel = data.machines[0]?.totalCountBasis === "net"
    ? "Rejection % (rejects / good output)"
    : data.machines[0]?.totalCountBasis === "gross"
      ? "Rejection % (rejects / total manufactured)"
      : "Rejection %";
  const catRows = data.categories
    .map(
      (c) =>
        `<tr><td>${escapeHtml(c.category)}</td><td>${fmtHtml(c.target)}</td><td>${fmtHtml(c.requiredPerDay)}</td><td class="${ragClass(c.ragBand)}">${c.ragBand ?? "n/a"}</td></tr>`,
    )
    .join("");

  const warningRows = data.warnings
    .map(
      (w) =>
        `<tr><td class="${w.severity === "critical" || w.severity === "high" ? "red" : w.severity === "medium" ? "amber" : ""}">${escapeHtml(w.severity)}</td><td>${escapeHtml(w.scope)}</td><td style="text-align:left">${escapeHtml(w.message)}</td><td>${fmtHtml(w.value)}</td><td>${fmtHtml(w.threshold)}</td></tr>`,
    )
    .join("");

  const actionRows = data.actions
    .map(
      (a) =>
        `<tr><td>${a.priority}</td><td>${escapeHtml(a.code)}</td><td>${escapeHtml(a.scope)}</td><td style="text-align:left">${escapeHtml(a.message)}</td><td>${fmtHtml(a.suggestedQty)}</td></tr>`,
    )
    .join("");

  const machineRows = data.machines
    .map(
      (m) =>
        `<tr><td>${escapeHtml(m.machineId)}</td><td>${m.isGrinder ? "Yes" : "No"}</td><td>${fmtHtml(m.runHours)}</td><td>${fmtHtml(m.idealHours)}</td><td>${fmtHtml(m.utilisationPct)}</td><td>${fmtHtml(m.outputKg)}</td><td>${fmtHtml(m.rejectionKg)}</td><td>${fmtHtml(m.rejectionPct)}</td></tr>`,
    )
    .join("");

  const backlogRows = data.stockoutItems
    .map(
      (i) =>
        `<tr><td>${escapeHtml(i.itemCode)}</td><td>${escapeHtml(i.colour)}</td><td>${escapeHtml(i.category)}</td><td class="red">${i.stock.toLocaleString()}</td><td>${i.pendingOrder.toLocaleString()}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html>
  <html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { font-family: Arial, sans-serif; font-size: 10px; color: #222; }
      h1 { font-size: 18px; }
      h2 { font-size: 14px; margin-top: 24px; page-break-before: always; }
      table { border-collapse: collapse; width: 100%; margin-top: 8px; }
      th, td { border: 1px solid #ccc; padding: 3px 6px; text-align: right; }
      th:first-child, td:first-child, th:nth-child(2), td:nth-child(2) { text-align: left; }
      .red { background-color: #f4cccc; }
      .green { background-color: #d9ead3; }
      .amber { background-color: #fce5cd; }
    </style>
  </head>
  <body>
    <h1>PTMT Production Monitoring — ${escapeHtml(data.month)}</h1>
    <p>Data available: ${data.dataAvailable ? "Yes" : "No"} | Last data date: ${escapeHtml(data.lastDataDate ?? "n/a")}</p>
    <table>
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>Target (kg)</td><td>${fmtHtml(data.plant.targetKg)}</td></tr>
        <tr><td>Output to date (kg)</td><td>${fmtHtml(data.plant.outputToDateKg)}</td></tr>
        <tr><td>Required per day (kg)</td><td>${fmtHtml(data.plant.requiredPerDay)}</td></tr>
        <tr><td>Actual per day (kg)</td><td>${fmtHtml(data.plant.actualPerDay)}</td></tr>
        <tr><td>Attainment %</td><td>${fmtHtml(data.plant.attainmentPct)}</td></tr>
        <tr><td>Projected month-end (kg)</td><td>${fmtHtml(data.plant.projectedMonthEnd)}</td></tr>
        <tr><td>Projected attainment %</td><td>${fmtHtml(data.plant.projectedAttainmentPct)}</td></tr>
        <tr><td>RAG band</td><td class="${ragClass(data.plant.ragBand)}">${data.plant.ragBand ?? "n/a"}</td></tr>
      </tbody>
    </table>

    <h2>Categories</h2>
    <table>
      <thead><tr><th>Category</th><th>Target (kg)</th><th>Required per day</th><th>RAG</th></tr></thead>
      <tbody>${catRows}</tbody>
    </table>

    <h2>Warnings</h2>
    <table>
      <thead><tr><th>Severity</th><th>Scope</th><th>Message</th><th>Value</th><th>Threshold</th></tr></thead>
      <tbody>${warningRows || `<tr><td colspan="5">No warnings</td></tr>`}</tbody>
    </table>

    <h2>Recommended Actions</h2>
    <table>
      <thead><tr><th>Priority</th><th>Code</th><th>Scope</th><th>Message</th><th>Suggested Qty</th></tr></thead>
      <tbody>${actionRows || `<tr><td colspan="5">No actions</td></tr>`}</tbody>
    </table>

    <h2>Machine Quality</h2>
    <table>
      <thead><tr><th>Machine</th><th>Grinder</th><th>Run Hours</th><th>Ideal Hours</th><th>Utilisation %</th><th>Output (kg)</th><th>Rejection (kg)</th><th>${rejectionPctLabel}</th></tr></thead>
      <tbody>${machineRows || `<tr><td colspan="8">No data</td></tr>`}</tbody>
    </table>

    <h2>Backlog</h2>
    <table>
      <thead><tr><th>Item Code</th><th>Colour</th><th>Category</th><th>Stock</th><th>Pending Order</th></tr></thead>
      <tbody>${backlogRows || `<tr><td colspan="5">No stockout items</td></tr>`}</tbody>
    </table>
  </body>
  </html>`;
}

export async function exportMonitoringPdf(data: MonitoringExportData): Promise<Buffer> {
  const html = buildHtml(data);
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });
    const pdfUint8 = await page.pdf({
      format: "A4",
      landscape: true,
      printBackground: true,
      margin: { top: "10mm", bottom: "10mm", left: "8mm", right: "8mm" },
    });
    return Buffer.from(pdfUint8);
  } finally {
    await browser.close();
  }
}
