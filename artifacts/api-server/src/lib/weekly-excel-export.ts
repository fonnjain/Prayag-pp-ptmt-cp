import { ITEM_MAPPING } from "./item-mapping";
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

function currentWeekForExport(month: string): number | undefined {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const currentMonth = `${value("year")}-${String(value("month")).padStart(2, "0")}`;
  if (currentMonth !== month) return undefined;

  const day = value("day");
  if (month === "2026-09") {
    if (day <= 7) return 1;
    if (day <= 13) return 2;
    if (day <= 19) return 3;
    return 4;
  }
  return undefined;
}

function formatRowNumber(cell: ExcelJS.Cell) {
  if (typeof cell.value === "number") {
    cell.numFmt = "#,##0";
  }
}

function addCalendarHeader(sheet: ExcelJS.Worksheet, workingBasis: string) {
  sheet.spliceRows(1, 0, []);
  const cell = sheet.getCell("A1");
  cell.value = workingBasis;
  cell.font = { italic: true };
}

function addCategorySheet(workbook: ExcelJS.Workbook, category: string, items: FrozenPlanRow[], workingBasis: string): void {
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

  addCalendarHeader(sheet, workingBasis);

  const headerRow = sheet.getRow(2);
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
    ["productionPlan", "cannotBeMade", "w1", "w2", "w3", "w4"].forEach(c => {
      row.getCell(c).numFmt = "#,##0";
    });
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
  ["productionPlan", "cannotBeMade", "w1", "w2", "w3", "w4"].forEach(c => {
    totalRow.getCell(c).numFmt = "#,##0";
  });

  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  sheet.autoFilter = { from: "A2", to: `J${Math.max(2, sheet.rowCount)}` };
  sheet.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "2:2" };
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
  workingBasis: string,
  segment: string,
  planType: string,
  runId?: number,
): void {
  const sheet = workbook.addWorksheet("Summary");
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

  sheet.addRow([`${segment} ${planType.charAt(0).toUpperCase() + planType.slice(1)} Weekly Release Plan — ${month}${runId ? ' (Run ' + runId + ')' : ''}`]);
  sheet.getCell("A1").font = { bold: true, size: 13 };

  addCalendarHeader(sheet, workingBasis);
  // Now A1 is calendar, A2 is title

  sheet.addRow([`Source: ${sourceDescription}`]);
  sheet.addRow(["Invariant: Σ W1..W4 = Production Plan total"]);
  sheet.addRow([]);

  const headerRow = sheet.addRow(["Category", "W1", "W2", "W3", "W4", "Production Plan", "Cannot Be Made", "Weekly Check"]);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.eachCell((cell) => { cell.alignment = { horizontal: "center", wrapText: true, vertical: "middle" }; });

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
    [2,3,4,5,6,7].forEach(c => row.getCell(c).numFmt = "#,##0");
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
  [2,3,4,5,6,7].forEach(c => grandRow.getCell(c).numFmt = "#,##0");

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

  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", ySplit: 6 }];
  sheet.autoFilter = { from: "A6", to: `H${Math.max(6, sheet.rowCount)}` };
  sheet.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "6:6" };
}

function addWeekSheet(workbook: ExcelJS.Workbook, week: 1|2|3|4, rows: FrozenPlanRow[], workingBasis: string): void {
  const sheet = workbook.addWorksheet(`Week ${week}`);
  sheet.columns = [
    { header: "Item Code", key: "code", width: 15 },
    { header: "Item Name", key: "name", width: 30 },
    { header: "Category", key: "cat", width: 25 },
    { header: "Pieces This Week", key: "pieces", width: 20 },
    { header: "Running Total", key: "running", width: 20 }
  ];

  addCalendarHeader(sheet, workingBasis);

  const headerRow = sheet.getRow(2);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { horizontal: "center", wrapText: true, vertical: "middle" };

  const weekProp = `w${week}` as const;
  const filtered = rows.filter((r) => r[weekProp] > 0).map((r) => ({...r, qty: r[weekProp]}));

  filtered.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return b.qty - a.qty;
  });

  let running = 0;
  for (const r of filtered) {
    running += r.qty;
    const map = ITEM_MAPPING[r.itemCode];
    const row = sheet.addRow({
      code: r.itemCode,
      name: map?.d || r.itemName || "",
      cat: r.category,
      pieces: r.qty,
      running
    });
    row.getCell("pieces").numFmt = "#,##0";
    row.getCell("running").numFmt = "#,##0";
  }

  const totalRow = sheet.addRow({
    code: "TOTAL",
    name: "",
    cat: "",
    pieces: running,
    running: running
  });
  totalRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  totalRow.fill = HEADER_FILL;
  totalRow.getCell("pieces").numFmt = "#,##0";
  totalRow.getCell("running").numFmt = "#,##0";

  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  sheet.autoFilter = { from: "A2", to: `E${Math.max(2, sheet.rowCount)}` };
  sheet.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "2:2" };
}

function addWeekSummarySheet(workbook: ExcelJS.Workbook, totalsRows: WeeklyTotalsRow[], workingBasis: string): void {
  const sheet = workbook.addWorksheet("Week Summary");

  sheet.columns = [
    { header: "Category", key: "cat", width: 30 },
    { header: "Week 1", key: "w1", width: 15 },
    { header: "Week 2", key: "w2", width: 15 },
    { header: "Week 3", key: "w3", width: 15 },
    { header: "Week 4", key: "w4", width: 15 },
    { header: "Total", key: "total", width: 15 },
  ];

  addCalendarHeader(sheet, workingBasis);

  const headerRow = sheet.getRow(2);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { horizontal: "center", wrapText: true, vertical: "middle" };

  for (const r of totalsRows) {
    const total = r.w1 + r.w2 + r.w3 + r.w4;
    const row = sheet.addRow({
      cat: r.category,
      w1: r.w1, w2: r.w2, w3: r.w3, w4: r.w4,
      total
    });
    ["w1", "w2", "w3", "w4", "total"].forEach(c => row.getCell(c).numFmt = "#,##0");
  }

  const grandRow = sheet.addRow({
    cat: "TOTAL",
    w1: totalsRows.reduce((s, r) => s + r.w1, 0),
    w2: totalsRows.reduce((s, r) => s + r.w2, 0),
    w3: totalsRows.reduce((s, r) => s + r.w3, 0),
    w4: totalsRows.reduce((s, r) => s + r.w4, 0),
    total: totalsRows.reduce((s, r) => s + r.w1 + r.w2 + r.w3 + r.w4, 0)
  });
  grandRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  grandRow.fill = HEADER_FILL;
  ["w1", "w2", "w3", "w4", "total"].forEach(c => grandRow.getCell(c).numFmt = "#,##0");

  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  sheet.autoFilter = { from: "A2", to: `F${Math.max(2, sheet.rowCount)}` };
  sheet.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "2:2" };
}

function addMasterWeekSummarySheet(workbook: ExcelJS.Workbook, rows: FrozenPlanRow[], workingBasis: string): void {
  const sheet = workbook.addWorksheet("Master Week Summary");

  sheet.columns = [
    { header: "Master Category", key: "master", width: 25 },
    { header: "Sub-category", key: "sub", width: 25 },
    { header: "Week 1", key: "w1", width: 15 },
    { header: "Week 2", key: "w2", width: 15 },
    { header: "Week 3", key: "w3", width: 15 },
    { header: "Week 4", key: "w4", width: 15 },
    { header: "Total", key: "total", width: 15 },
  ];

  addCalendarHeader(sheet, workingBasis);

  const headerRow = sheet.getRow(2);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { horizontal: "center", wrapText: true, vertical: "middle" };

  const groups = new Map<string, { w1: number, w2: number, w3: number, w4: number }>();
  for (const r of rows) {
    const map = ITEM_MAPPING[r.itemCode];
    const m = map?.m || "not in grouping master";
    const s = map?.s || "not in grouping master";
    const key = JSON.stringify([m, s]);

    if (!groups.has(key)) groups.set(key, { w1: 0, w2: 0, w3: 0, w4: 0 });
    const g = groups.get(key)!;
    g.w1 += r.w1;
    g.w2 += r.w2;
    g.w3 += r.w3;
    g.w4 += r.w4;
  }

  const totals = { w1: 0, w2: 0, w3: 0, w4: 0 };
  for (const [key, g] of groups.entries()) {
    const [m, s] = JSON.parse(key);
    const total = g.w1 + g.w2 + g.w3 + g.w4;
    const row = sheet.addRow({ master: m, sub: s, w1: g.w1, w2: g.w2, w3: g.w3, w4: g.w4, total });
    ["w1", "w2", "w3", "w4", "total"].forEach(c => row.getCell(c).numFmt = "#,##0");
    totals.w1 += g.w1; totals.w2 += g.w2; totals.w3 += g.w3; totals.w4 += g.w4;
  }

  const grandRow = sheet.addRow({
    master: "TOTAL",
    sub: "",
    w1: totals.w1,
    w2: totals.w2,
    w3: totals.w3,
    w4: totals.w4,
    total: totals.w1 + totals.w2 + totals.w3 + totals.w4
  });
  grandRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  grandRow.fill = HEADER_FILL;
  ["w1", "w2", "w3", "w4", "total"].forEach(c => grandRow.getCell(c).numFmt = "#,##0");

  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  sheet.autoFilter = { from: "A2", to: `G${Math.max(2, sheet.rowCount)}` };
  sheet.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "2:2" };
}

function addPlanAtAGlanceSheet(
  workbook: ExcelJS.Workbook,
  month: string,
  segment: string,
  planType: string,
  runId: number | undefined,
  rows: FrozenPlanRow[],
  workingBasis: string
): void {
  const sheet = workbook.addWorksheet("Plan at a glance");
  const title = `${segment} ${planType.charAt(0).toUpperCase() + planType.slice(1)} Plan at a glance — ${month}${runId ? ' (Run ' + runId + ')' : ''}`;

  sheet.columns = [
    { header: "Metric", key: "metric", width: 45 },
    { header: "Week 1", key: "w1", width: 15 },
    { header: "Week 2", key: "w2", width: 15 },
    { header: "Week 3", key: "w3", width: 15 },
    { header: "Week 4", key: "w4", width: 15 },
    { header: "Month Total", key: "total", width: 20 },
  ];

  addCalendarHeader(sheet, workingBasis);
  sheet.insertRow(2, [title]);
  sheet.getCell("A2").font = { bold: true, size: 14 };
  sheet.mergeCells("A2:F2");

  const headerRow = sheet.getRow(3);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { horizontal: "center", wrapText: true, vertical: "middle" };

  let itemsW1 = 0, itemsW2 = 0, itemsW3 = 0, itemsW4 = 0;
  let pcsW1 = 0, pcsW2 = 0, pcsW3 = 0, pcsW4 = 0;
  let pendW1 = 0, pendW2 = 0, pendW3 = 0, pendW4 = 0;
  let totalCannot = 0;

  let totalItemsScheduled = 0;

  for (const r of rows) {
    if (r.w1 > 0) itemsW1++;
    if (r.w2 > 0) itemsW2++;
    if (r.w3 > 0) itemsW3++;
    if (r.w4 > 0) itemsW4++;
    if (r.w1 > 0 || r.w2 > 0 || r.w3 > 0 || r.w4 > 0) totalItemsScheduled++;

    pcsW1 += r.w1;
    pcsW2 += r.w2;
    pcsW3 += r.w3;
    pcsW4 += r.w4;

    let rem = r.pendingLastMonth || 0;
    const p1 = Math.min(rem, r.w1); rem -= p1;
    const p2 = Math.min(rem, r.w2); rem -= p2;
    const p3 = Math.min(rem, r.w3); rem -= p3;
    const p4 = Math.min(rem, r.w4); rem -= p4;
    pendW1 += p1;
    pendW2 += p2;
    pendW3 += p3;
    pendW4 += p4;

    totalCannot += Math.max(0, r.cannotBeMade || 0);
  }

  const m1 = sheet.addRow({
    metric: "Items Scheduled (count)",
    w1: itemsW1, w2: itemsW2, w3: itemsW3, w4: itemsW4, total: totalItemsScheduled
  });
  const m2 = sheet.addRow({
    metric: "Pieces Scheduled",
    w1: pcsW1, w2: pcsW2, w3: pcsW3, w4: pcsW4, total: pcsW1 + pcsW2 + pcsW3 + pcsW4
  });
  const m3 = sheet.addRow({
    metric: "Already-Sold Pending Scheduled",
    w1: pendW1, w2: pendW2, w3: pendW3, w4: pendW4, total: pendW1 + pendW2 + pendW3 + pendW4
  });
  const m4 = sheet.addRow({
    metric: "Unscheduled / Cannot Be Made",
    w1: 0, w2: 0, w3: 0, w4: 0, total: totalCannot
  });
  const days = workingBasis.includes("[7,6,6,8]") ? [7, 6, 6, 8] : [6, 6, 6, 8];
  const m5 = sheet.addRow({
    metric: "Pieces per working day",
    w1: pcsW1 / days[0], w2: pcsW2 / days[1], w3: pcsW3 / days[2], w4: pcsW4 / days[3],
    total: (pcsW1 + pcsW2 + pcsW3 + pcsW4) / days.reduce((sum, value) => sum + value, 0),
  });
  const unmappedRows = rows.filter((row) => {
    const mapping = ITEM_MAPPING[row.itemCode];
    return !mapping || !mapping.m || !mapping.s;
  });
  const distinctUnmappedCodes = new Set(unmappedRows.map((row) => row.itemCode)).size;
  const m6 = sheet.addRow({
    metric: `Unmapped rows ${unmappedRows.length} (${distinctUnmappedCodes} distinct codes)`,
    w1: 0, w2: 0, w3: 0, w4: 0, total: unmappedRows.length,
  });

  [m1, m2, m3, m4, m5, m6].forEach(row => {
    row.font = { bold: true };
    ["w1", "w2", "w3", "w4", "total"].forEach(c => row.getCell(c).numFmt = "#,##0");
  });

  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", ySplit: 3 }];
}

function addCannotBeMadeSheet(workbook: ExcelJS.Workbook, rows: FrozenPlanRow[], workingBasis: string): void {
  const sheet = workbook.addWorksheet("Cannot be made");
  sheet.columns = [
    { header: "", key: "spacer", width: 3 },
    { header: "Item code", key: "itemCode", width: 18 },
    { header: "Product group", key: "category", width: 24 },
    { header: "Item name", key: "itemName", width: 46 },
    { header: "Cannot be made", key: "cannot", width: 18 },
    { header: "Demand", key: "demand", width: 18 },
  ];
  addCalendarHeader(sheet, workingBasis);
  sheet.insertRow(2, ["", "CANNOT BE MADE — no carry-over"]);
  sheet.mergeCells("B2:F2");
  sheet.getCell("B2").font = { bold: true, size: 14, color: { argb: "FFC65911" } };
  sheet.insertRow(3, ["", "These quantities are not moved into another week or month. They remain the explicit capacity shortfall."]);
  sheet.mergeCells("B3:F3");
  const header = sheet.getRow(4);
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.fill = HEADER_FILL;
  const limited = rows
    .filter((row) => Math.max(0, row.cannotBeMade || 0) > 0)
    .sort((a, b) => Math.max(0, b.cannotBeMade || 0) - Math.max(0, a.cannotBeMade || 0));
  for (const row of limited) {
    const added = sheet.addRow({
      itemCode: row.itemCode,
      category: row.category,
      itemName: row.itemName ?? "",
      cannot: Math.max(0, row.cannotBeMade || 0),
      demand: Math.max(0, row.demandPlan ?? row.productionPlan),
    });
    added.getCell("cannot").numFmt = "#,##0";
    added.getCell("demand").numFmt = "#,##0";
  }
  const total = sheet.addRow({
    category: "TOTAL",
    cannot: limited.reduce((sum, row) => sum + Math.max(0, row.cannotBeMade || 0), 0),
  });
  total.font = { bold: true };
  total.getCell("cannot").numFmt = "#,##0";
  total.eachCell((cell) => {
    cell.border = { top: { style: "medium", color: { argb: "FFC65911" } } };
  });
  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", ySplit: 4 }];
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "4:4" };
}

function addByMasterGroupSheet(workbook: ExcelJS.Workbook, rows: FrozenPlanRow[], workingBasis: string): void {
  const sheet = workbook.addWorksheet("By master group");
  sheet.columns = [
    { header: "Planning Category", key: "plan", width: 25 },
    { header: "Master Category", key: "master", width: 25 },
    { header: "Sub-category", key: "sub", width: 25 },
    { header: "Week 1", key: "w1", width: 12 },
    { header: "Week 2", key: "w2", width: 12 },
    { header: "Week 3", key: "w3", width: 12 },
    { header: "Week 4", key: "w4", width: 12 },
    { header: "Total", key: "total", width: 15 },
  ];

  addCalendarHeader(sheet, workingBasis);

  const headerRow = sheet.getRow(2);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { horizontal: "center", wrapText: true, vertical: "middle" };

  const grouped = new Map<string, { w1: number, w2: number, w3: number, w4: number }>();
  const reverseGrouped = new Map<string, { w1: number, w2: number, w3: number, w4: number }>();

  for (const r of rows) {
    const map = ITEM_MAPPING[r.itemCode];
    const m = map?.m || "not in grouping master";
    const s = map?.s || "not in grouping master";
    const p = r.category;

    const key = JSON.stringify([p, m, s]);
    if (!grouped.has(key)) grouped.set(key, { w1: 0, w2: 0, w3: 0, w4: 0 });
    const g = grouped.get(key)!;
    g.w1 += r.w1; g.w2 += r.w2; g.w3 += r.w3; g.w4 += r.w4;

    const rKey = JSON.stringify([m, s, p]);
    if (!reverseGrouped.has(rKey)) reverseGrouped.set(rKey, { w1: 0, w2: 0, w3: 0, w4: 0 });
    const rg = reverseGrouped.get(rKey)!;
    rg.w1 += r.w1; rg.w2 += r.w2; rg.w3 += r.w3; rg.w4 += r.w4;
  }

  for (const [key, g] of grouped.entries()) {
    const [p, m, s] = JSON.parse(key);
    const total = g.w1 + g.w2 + g.w3 + g.w4;
    const row = sheet.addRow({ plan: p, master: m, sub: s, w1: g.w1, w2: g.w2, w3: g.w3, w4: g.w4, total });
    ["w1", "w2", "w3", "w4", "total"].forEach(c => row.getCell(c).numFmt = "#,##0");
  }

  sheet.addRow([]);
  const revHeader = sheet.addRow({ plan: "Master Category", master: "Sub-category", sub: "Planning Category", w1: "Week 1", w2: "Week 2", w3: "Week 3", w4: "Week 4", total: "Total" });
  revHeader.font = { bold: true, color: { argb: "FFFFFFFF" } };
  revHeader.fill = HEADER_FILL;
  revHeader.alignment = { horizontal: "center", wrapText: true, vertical: "middle" };

  for (const [key, g] of reverseGrouped.entries()) {
    const [m, s, p] = JSON.parse(key);
    const total = g.w1 + g.w2 + g.w3 + g.w4;
    const row = sheet.addRow({ plan: m, master: s, sub: p, w1: g.w1, w2: g.w2, w3: g.w3, w4: g.w4, total });
    ["w1", "w2", "w3", "w4", "total"].forEach(c => row.getCell(c).numFmt = "#,##0");
  }

  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  sheet.autoFilter = { from: "A2", to: `H${Math.max(2, sheet.rowCount)}` };
  sheet.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "2:2" };
}

function addWhatNeedsAttentionSheet(workbook: ExcelJS.Workbook, rows: FrozenPlanRow[], workingBasis: string, currentWeek?: number): void {
  const sheet = workbook.addWorksheet("What needs attention");
  sheet.columns = [
    { header: "Attention Reason", key: "reason", width: 35 },
    { header: "Item Code", key: "itemCode", width: 15 },
    { header: "Colour", key: "colour", width: 15 },
    { header: "Category", key: "category", width: 25 },
    { header: "Production Plan", key: "plan", width: 18 },
    { header: "W1", key: "w1", width: 12 },
    { header: "W2", key: "w2", width: 12 },
    { header: "W3", key: "w3", width: 12 },
    { header: "W4", key: "w4", width: 12 },
  ];

  addCalendarHeader(sheet, workingBasis);

  const headerRow = sheet.getRow(2);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = HEADER_FILL;
  headerRow.alignment = { horizontal: "center", wrapText: true, vertical: "middle" };

  const attentionItems: Array<{ row: FrozenPlanRow, reason: string, sortKey: number }> = [];
  const seen = new Set<string>();

  const add = (r: FrozenPlanRow, reason: string, sortKey: number) => {
    const key = `${r.itemCode}_${r.colour}_${r.category}`;
    if (!seen.has(key)) {
      seen.add(key);
      attentionItems.push({ row: r, reason, sortKey });
    }
  };

  // 1. largest 20 in current week
  if (currentWeek && [1, 2, 3, 4].includes(currentWeek)) {
    const weekProp = `w${currentWeek}` as keyof FrozenPlanRow;
    const currentWeekItems = [...rows]
      .filter(r => (r[weekProp] as number) > 0)
      .sort((a, b) => (b[weekProp] as number) - (a[weekProp] as number))
      .slice(0, 20);

    for (const r of currentWeekItems) {
      add(r, `Top 20 volume in Week ${currentWeek}`, 1);
    }
  }

  // 2. already-sold goods still unscheduled
  for (const r of rows) {
    if (r.pendingLastMonth > 0 && r.productionPlan === 0 && r.cannotBeMade > 0) {
      add(r, "Already sold but unscheduled", 2);
    }
  }

  // 3. whole month in one week
  for (const r of rows) {
    const total = sumWeeks(r);
    if (total > 0 && (r.w1 === total || r.w2 === total || r.w3 === total) && r.w4 === 0) {
      add(r, "Whole month scheduled in single week", 3);
    }
  }

  // 4. W4-only
  for (const r of rows) {
    if (r.w4 > 0 && r.w1 === 0 && r.w2 === 0 && r.w3 === 0) {
      add(r, "Scheduled exclusively in W4", 4);
    }
  }

  attentionItems.sort((a, b) => a.sortKey - b.sortKey);
  const limitedItems = attentionItems.slice(0, 59);

  for (const item of limitedItems) {
    const { row: r, reason } = item;
    const sheetRow = sheet.addRow({
      reason,
      itemCode: r.itemCode,
      colour: r.colour,
      category: r.category,
      plan: r.productionPlan,
      w1: r.w1,
      w2: r.w2,
      w3: r.w3,
      w4: r.w4,
    });
    ["plan", "w1", "w2", "w3", "w4"].forEach(c => sheetRow.getCell(c).numFmt = "#,##0");
  }

  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", ySplit: 2 }];
  sheet.autoFilter = { from: "A2", to: `I${Math.max(2, sheet.rowCount)}` };
  sheet.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "2:2" };
}

function addHowToReadSheet(workbook: ExcelJS.Workbook, workingBasis: string): void {
  const sheet = workbook.addWorksheet("How to read this plan");
  sheet.columns = [ { width: 100 } ];

  sheet.addRow(["How to read this plan"]);
  sheet.getCell("A1").font = { bold: true, size: 14 };

  addCalendarHeader(sheet, workingBasis);
  // Now A1 is calendar, A2 is "How to read this plan"

  sheet.addRow([]);

  sheet.addRow(["Calendar & Working Basis"]);
  sheet.getCell("A4").font = { bold: true };
  sheet.addRow([workingBasis]);
  sheet.addRow([]);

  sheet.addRow(["Weekly Schedule (W1 - W4)"]);
  sheet.getCell("A7").font = { bold: true };
  sheet.addRow(["The weekly layout divides the month's production into four consecutive segments. " +
    "Check the calendar above for the exact days mapped to each week."]);

  sheet.addRow([]);
  sheet.addRow(["Unscheduled & Cannot Be Made"]);
  sheet.getCell("A10").font = { bold: true };
  sheet.addRow(["Items that are highlighted in red and listed as 'Cannot Be Made' do not have capacity " +
    "assigned in this month's plan."]);
}

export async function exportWeeklyReleaseExcel(
  month: string,
  rows: FrozenPlanRow[],
  sourceDescription = "capacity-fitted finalized plan",
  segment = "PTMT",
  options?: {
    planType?: "temporary" | "production";
    runId?: number;
    currentWeek?: number;
  }
): Promise<Buffer> {
  assertWeeklyProductionConservation(rows);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PTMT Production Planning";

  let workingBasis = `Working-day basis: not recorded for ${segment} ${month}.`;
  if (month === "2026-09") {
    if (segment === "Plumbing") {
      workingBasis = "Working-day basis: September 2026 Plumbing [7,6,6,8]. Plumbing counts worked Sunday 2026-09-06 because its production evidence includes it; PTMT excludes the same Sunday.";
    } else {
      workingBasis = "Working-day basis: September 2026 PTMT [6,6,6,8]. PTMT excludes Sunday 2026-09-06 because its calendar does not infer Sunday evidence; Plumbing counts the same Sunday as worked.";
    }
  }

  const currentWeek = options?.currentWeek ?? currentWeekForExport(month);
  addPlanAtAGlanceSheet(workbook, month, segment, options?.planType || "production", options?.runId, rows, workingBasis);
  addByMasterGroupSheet(workbook, rows, workingBasis);
  addWhatNeedsAttentionSheet(workbook, rows, workingBasis, currentWeek);
  if (segment === "PTMT") addCannotBeMadeSheet(workbook, rows, workingBasis);
  addHowToReadSheet(workbook, workingBasis);

  const byCategory = new Map<string, FrozenPlanRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }

  const totalsRows: WeeklyTotalsRow[] = [];
  for (const [category, categoryRows] of byCategory) {
    addCategorySheet(workbook, category, categoryRows, workingBasis);
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

  addSummarySheet(workbook, month, sourceDescription, totalsRows, workingBasis, segment, options?.planType || "production", options?.runId);

  for (let week = 1; week <= 4; week++) {
    addWeekSheet(workbook, week as 1|2|3|4, rows, workingBasis);
  }

  addWeekSummarySheet(workbook, totalsRows, workingBasis);
  addMasterWeekSummarySheet(workbook, rows, workingBasis);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
