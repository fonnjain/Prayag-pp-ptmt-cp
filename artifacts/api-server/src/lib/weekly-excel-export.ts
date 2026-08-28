import type ExcelJS from "exceljs";
import type { FrozenPlanRow } from "./excel-export";

const W1_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE5CD" } };
const W2_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
const W3_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
const W4_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFE2F3" } };
const UNSCHEDULED_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F3F3" } };
const HEADER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF434343" } };

const WEEK_FILLS: Record<number, ExcelJS.Fill> = { 1: W1_FILL, 2: W2_FILL, 3: W3_FILL, 4: W4_FILL };

export class WeeklyExportInvariantError extends Error {
  readonly code = "WEEKLY_EXPORT_CONSERVATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "WeeklyExportInvariantError";
  }
}

function sumWeeks(row: Pick<FrozenPlanRow, "w1" | "w2" | "w3" | "w4">): number {
  return row.w1 + row.w2 + row.w3 + row.w4;
}

export function assertWeeklyProductionConservation(rows: FrozenPlanRow[]): void {
  const weeklyTotal = rows.reduce((sum, row) => sum + sumWeeks(row), 0);
  const productionTotal = rows.reduce((sum, row) => sum + Math.max(0, row.productionPlan), 0);
  const difference = Math.abs(weeklyTotal - productionTotal);
  if (difference > 0.001) {
    throw new WeeklyExportInvariantError(
      `Weekly release conservation failed: Σ W1..W4=${weeklyTotal} ` +
      `but Production Plan total=${productionTotal} (difference=${difference}).`,
    );
  }
}

function weekLabel(week: number | null): string {
  if (week === null || ![1, 2, 3, 4].includes(week)) return "-";
  return `W${week}`;
}

function addCategorySheet(workbook: ExcelJS.Workbook, category: string, items: FrozenPlanRow[]): void {
  const sheet = workbook.addWorksheet(category.slice(0, 31));
  sheet.columns = [
    { header: "Item Code", key: "itemCode", width: 14 },
    { header: "Colour", key: "colour", width: 14 },
    { header: "Production Plan", key: "productionPlan", width: 17 },
    { header: "Cannot Be Made", key: "cannotBeMade", width: 16 },
    { header: "W1", key: "w1", width: 10 },
    { header: "W2", key: "w2", width: 10 },
    { header: "W3", key: "w3", width: 10 },
    { header: "W4", key: "w4", width: 10 },
    { header: "Assigned Week", key: "assignedWeek", width: 14 },
    { header: "Material", key: "material", width: 12 },
  ];

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { horizontal: "center" };

  const scheduled = items.filter((item) => item.productionPlan > 0);
  const unfinished = items.filter((item) => item.cannotBeMade > 0);
  const ordered = [...scheduled, ...items.filter((item) => !scheduled.includes(item) && unfinished.includes(item)),
    ...items.filter((item) => !scheduled.includes(item) && !unfinished.includes(item))];

  for (const item of ordered) {
    const row = sheet.addRow({
      itemCode: item.itemCode,
      colour: item.colour,
      productionPlan: item.productionPlan,
      cannotBeMade: item.cannotBeMade,
      w1: item.w1,
      w2: item.w2,
      w3: item.w3,
      w4: item.w4,
      assignedWeek: weekLabel(item.releaseWeek),
      material: item.material ?? "",
    });
    if (item.productionPlan > 0) {
      const week = item.releaseWeek;
      row.fill = week && WEEK_FILLS[week] ? WEEK_FILLS[week] : UNSCHEDULED_FILL;
    } else if (item.cannotBeMade > 0) {
      row.fill = UNSCHEDULED_FILL;
    }
    if (item.cannotBeMade > 0) {
      row.getCell("cannotBeMade").font = { bold: true, color: { argb: "FF9C0006" } };
    }
  }

  const totalRow = sheet.addRow({
    itemCode: "TOTAL",
    colour: "",
    productionPlan: items.reduce((sum, item) => sum + Math.max(0, item.productionPlan), 0),
    cannotBeMade: items.reduce((sum, item) => sum + Math.max(0, item.cannotBeMade), 0),
    w1: items.reduce((sum, item) => sum + item.w1, 0),
    w2: items.reduce((sum, item) => sum + item.w2, 0),
    w3: items.reduce((sum, item) => sum + item.w3, 0),
    w4: items.reduce((sum, item) => sum + item.w4, 0),
    assignedWeek: "",
    material: "",
  });
  totalRow.font = { bold: true };
  totalRow.fill = HEADER_FILL;
  totalRow.eachCell((cell) => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; });
}

interface WeeklyTotalsRow {
  category: string;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  productionPlan: number;
  cannotBeMade: number;
}

function addSummarySheet(
  workbook: ExcelJS.Workbook,
  month: string,
  sourceDescription: string,
  totalsRows: WeeklyTotalsRow[],
): void {
  const sheet = workbook.addWorksheet("Summary");
  sheet.insertRow(1, [`Weekly Release Plan — ${month}`]);
  sheet.getCell("A1").font = { bold: true, size: 13 };
  sheet.addRow([`Source: ${sourceDescription}`]);
  sheet.addRow(["Invariant: Σ W1..W4 = Production Plan total"]);
  sheet.addRow([]);

  sheet.columns = [
    { width: 30 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 18 },
    { width: 16 },
    { width: 16 },
  ];

  const headerRow = sheet.addRow(["Category", "W1", "W2", "W3", "W4", "Production Plan", "Cannot Be Made", "Weekly Check"]);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.eachCell((cell) => { cell.alignment = { horizontal: "center" }; });

  for (const t of totalsRows) {
    const weeklyTotal = t.w1 + t.w2 + t.w3 + t.w4;
    const row = sheet.addRow([
      t.category,
      t.w1,
      t.w2,
      t.w3,
      t.w4,
      t.productionPlan,
      t.cannotBeMade,
      Math.abs(weeklyTotal - t.productionPlan) <= 0.001 ? "PASS" : "FAIL",
    ]);
    if (t.w1 > 0) row.getCell(2).fill = W1_FILL;
    if (t.w2 > 0) row.getCell(3).fill = W2_FILL;
    if (t.w3 > 0) row.getCell(4).fill = W3_FILL;
    if (t.w4 > 0) row.getCell(5).fill = W4_FILL;
  }

  const grandRow = sheet.addRow([
    "GRAND TOTAL",
    totalsRows.reduce((sum, t) => sum + t.w1, 0),
    totalsRows.reduce((sum, t) => sum + t.w2, 0),
    totalsRows.reduce((sum, t) => sum + t.w3, 0),
    totalsRows.reduce((sum, t) => sum + t.w4, 0),
    totalsRows.reduce((sum, t) => sum + t.productionPlan, 0),
    totalsRows.reduce((sum, t) => sum + t.cannotBeMade, 0),
    "PASS",
  ]);
  grandRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  grandRow.fill = HEADER_FILL;

  sheet.addRow([]);
  sheet.addRow(["Legend:"]);
  const l1 = sheet.addRow(["", "W1"]);
  l1.getCell(1).fill = W1_FILL;
  const l2 = sheet.addRow(["", "W2"]);
  l2.getCell(1).fill = W2_FILL;
  const l3 = sheet.addRow(["", "W3"]);
  l3.getCell(1).fill = W3_FILL;
  const l4 = sheet.addRow(["", "W4"]);
  l4.getCell(1).fill = W4_FILL;
  const lu = sheet.addRow(["", "Unscheduled / cannot be made"]);
  lu.getCell(1).fill = UNSCHEDULED_FILL;
}

export async function exportWeeklyReleaseExcel(
  month: string,
  rows: FrozenPlanRow[],
  sourceDescription = "capacity-fitted finalized plan",
): Promise<Buffer> {
  assertWeeklyProductionConservation(rows);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();

  const byCategory = new Map<string, FrozenPlanRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }

  const totalsRows: WeeklyTotalsRow[] = [];
  for (const [category, categoryRows] of byCategory) {
    addCategorySheet(workbook, category, categoryRows);
    totalsRows.push({
      category,
      w1: categoryRows.reduce((sum, row) => sum + row.w1, 0),
      w2: categoryRows.reduce((sum, row) => sum + row.w2, 0),
      w3: categoryRows.reduce((sum, row) => sum + row.w3, 0),
      w4: categoryRows.reduce((sum, row) => sum + row.w4, 0),
      productionPlan: categoryRows.reduce((sum, row) => sum + Math.max(0, row.productionPlan), 0),
      cannotBeMade: categoryRows.reduce((sum, row) => sum + Math.max(0, row.cannotBeMade), 0),
    });
  }

  addSummarySheet(workbook, month, sourceDescription, totalsRows);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}