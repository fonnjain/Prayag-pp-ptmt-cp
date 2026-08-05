import type ExcelJS from "exceljs";
import type { CalcPlanItem } from "./calc";

const W1_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE5CD" } };
const W2_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
const W3_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
const W4_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFE2F3" } };
const UNSCHEDULED_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F3" } };
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF434343" } };

const WEEK_FILLS: Record<number, ExcelJS.Fill> = { 1: W1_FILL, 2: W2_FILL, 3: W3_FILL, 4: W4_FILL };

function coverLabel(cover: number | "OS"): string {
  return cover === "OS" ? "OS" : cover.toFixed(2);
}

function weekLabel(week: 1 | 2 | 3 | 4 | null): string {
  if (week === null) return "-";
  return `W${week}`;
}

function addCategorySheet(workbook: ExcelJS.Workbook, category: string, items: CalcPlanItem[]): void {
  const sheet = workbook.addWorksheet(category.slice(0, 31));

  sheet.columns = [
    { header: "Item Code", key: "itemCode", width: 14 },
    { header: "Colour", key: "colour", width: 14 },
    { header: "Cover (mo)", key: "cover", width: 12 },
    { header: "Production Plan", key: "plan", width: 15 },
    { header: "W1", key: "w1", width: 10 },
    { header: "W2", key: "w2", width: 10 },
    { header: "W3", key: "w3", width: 10 },
    { header: "W4", key: "w4", width: 10 },
    { header: "Assigned Week", key: "assignedWeek", width: 14 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { horizontal: "center" };

  const scheduled = items.filter((i) => i.maxProduction > 0 && i.week !== null);
  const unscheduled = items.filter((i) => i.maxProduction > 0 && i.week === null && i.cover !== "OS");
  const os = items.filter((i) => i.cover === "OS" && i.maxProduction > 0);
  const noProduction = items.filter((i) => i.maxProduction <= 0);

  for (const item of [...scheduled, ...unscheduled, ...os, ...noProduction]) {
    const row = sheet.addRow({
      itemCode: item.itemCode,
      colour: item.colour,
      cover: coverLabel(item.cover),
      plan: item.maxProduction > 0 ? item.maxProduction : 0,
      w1: item.w1 || undefined,
      w2: item.w2 || undefined,
      w3: item.w3 || undefined,
      w4: item.w4 || undefined,
      assignedWeek: weekLabel(item.week),
    });

    const rowFill = item.week ? WEEK_FILLS[item.week] : UNSCHEDULED_FILL;
    if (item.maxProduction > 0) {
      row.fill = rowFill;
    }

    if (item.week && item.maxProduction > 0) {
      const wCells: Record<number, string> = { 1: "w1", 2: "w2", 3: "w3", 4: "w4" };
      row.getCell(wCells[item.week]).font = { bold: true };
    }
  }

  if (scheduled.length > 0 || unscheduled.length > 0) {
    const totalsRow = sheet.addRow({
      itemCode: "TOTAL",
      colour: "",
      cover: "",
      plan: items.reduce((s, i) => s + Math.max(i.maxProduction, 0), 0),
      w1: items.reduce((s, i) => s + i.w1, 0),
      w2: items.reduce((s, i) => s + i.w2, 0),
      w3: items.reduce((s, i) => s + i.w3, 0),
      w4: items.reduce((s, i) => s + i.w4, 0),
      assignedWeek: "",
    });
    totalsRow.font = { bold: true };
    totalsRow.fill = HEADER_FILL;
    totalsRow.getCell("itemCode").font = { bold: true, color: { argb: "FFFFFFFF" } };
  }
}

interface WeeklyTotalsRow {
  category: string;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  totalScheduled: number;
  unscheduledPlan: number;
  osPlan: number;
}

function addSummarySheet(workbook: ExcelJS.Workbook, month: string, totalsRows: WeeklyTotalsRow[]): void {
  const sheet = workbook.addWorksheet("Summary");
  sheet.insertRow(1, [`PTMT Weekly Release Plan — ${month}`]);
  sheet.getCell("A1").font = { bold: true, size: 13 };
  sheet.addRow([]);

  sheet.columns = [
    { width: 30 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 16 },
    { width: 16 },
    { width: 12 },
  ];

  const headerRow = sheet.addRow(["Category", "W1", "W2", "W3", "W4", "Total Scheduled", "Unscheduled", "OS / Review"]);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.eachCell((cell) => { cell.alignment = { horizontal: "center" }; });

  for (const t of totalsRows) {
    const row = sheet.addRow([t.category, t.w1, t.w2, t.w3, t.w4, t.totalScheduled, t.unscheduledPlan, t.osPlan]);
    if (t.w1 > 0) row.getCell(2).fill = W1_FILL;
    if (t.w2 > 0) row.getCell(3).fill = W2_FILL;
    if (t.w3 > 0) row.getCell(4).fill = W3_FILL;
    if (t.w4 > 0) row.getCell(5).fill = W4_FILL;
  }

  const grandRow = sheet.addRow([
    "GRAND TOTAL",
    totalsRows.reduce((s, t) => s + t.w1, 0),
    totalsRows.reduce((s, t) => s + t.w2, 0),
    totalsRows.reduce((s, t) => s + t.w3, 0),
    totalsRows.reduce((s, t) => s + t.w4, 0),
    totalsRows.reduce((s, t) => s + t.totalScheduled, 0),
    totalsRows.reduce((s, t) => s + t.unscheduledPlan, 0),
    totalsRows.reduce((s, t) => s + t.osPlan, 0),
  ]);
  grandRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  grandRow.fill = HEADER_FILL;

  sheet.addRow([]);
  sheet.addRow(["Legend:"]);
  const l1 = sheet.addRow(["", "W1 — most urgent (lowest cover)"]);
  l1.getCell(1).fill = W1_FILL;
  const l2 = sheet.addRow(["", "W2"]);
  l2.getCell(1).fill = W2_FILL;
  const l3 = sheet.addRow(["", "W3"]);
  l3.getCell(1).fill = W3_FILL;
  const l4 = sheet.addRow(["", "W4 — least urgent (highest cover)"]);
  l4.getCell(1).fill = W4_FILL;
  const lu = sheet.addRow(["", "Unscheduled — cover above top band"]);
  lu.getCell(1).fill = UNSCHEDULED_FILL;
}

export async function exportWeeklyReleaseExcel(month: string, items: CalcPlanItem[]): Promise<Buffer> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ExcelJS = require("exceljs") as typeof import("exceljs");
  const workbook = new ExcelJS.Workbook();

  const byCategory = new Map<string, CalcPlanItem[]>();
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }

  const totalsRows: WeeklyTotalsRow[] = [];
  for (const [category, catItems] of byCategory) {
    addCategorySheet(workbook, category, catItems);
    totalsRows.push({
      category,
      w1: catItems.reduce((s, i) => s + i.w1, 0),
      w2: catItems.reduce((s, i) => s + i.w2, 0),
      w3: catItems.reduce((s, i) => s + i.w3, 0),
      w4: catItems.reduce((s, i) => s + i.w4, 0),
      totalScheduled: catItems.filter((i) => i.week !== null && i.maxProduction > 0)
        .reduce((s, i) => s + i.maxProduction, 0),
      unscheduledPlan: catItems.filter((i) => i.week === null && i.maxProduction > 0 && i.cover !== "OS")
        .reduce((s, i) => s + i.maxProduction, 0),
      osPlan: catItems.filter((i) => i.cover === "OS" && i.maxProduction > 0)
        .reduce((s, i) => s + i.maxProduction, 0),
    });
  }

  addSummarySheet(workbook, month, totalsRows);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
