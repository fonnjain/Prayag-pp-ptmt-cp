import type ExcelJS from "exceljs";
import type { CalcPlanItem, PlanSummaryResult } from "./calc";

export const RED_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4CCCC" } };
export const GREEN_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
export const BLUE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFE2F3" } };

export const ITEM_COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "Item Code", key: "itemCode", width: 14 },
  { header: "Colour", key: "colour", width: 14 },
  { header: "Item Name", key: "itemName", width: 28 },
  { header: "Source Role", key: "sourceRole", width: 24 },
  { header: "Unmapped Reason", key: "unmappedReason", width: 24 },
  { header: "Avg 3-Mo Sale", key: "avg3MoSale", width: 14 },
  { header: "Pending Order", key: "pendingOrder", width: 14 },
  { header: "Pending Last Mo", key: "pendingOrderLastMonth", width: 16 },
  { header: "Buffer Req", key: "bufferReq", width: 12 },
  { header: "Stock", key: "stock", width: 10 },
  { header: "Min Production", key: "minProduction", width: 14 },
  { header: "Production Plan", key: "maxProduction", width: 14 },
  { header: "Order", key: "order", width: 10 },
];

function addCategorySheet(workbook: ExcelJS.Workbook, category: string, items: CalcPlanItem[]): void {
  const sheet = workbook.addWorksheet(category.slice(0, 31));
  sheet.columns = ITEM_COLUMNS;
  sheet.getRow(1).font = { bold: true };

  // AGRI: header note explaining the intentional divergence from the source sheet.
  if (category.startsWith("AGRI")) {
    const noteRow = sheet.addRow(["AGRI is computed from the STOCK and BUFFER columns by header name; the source sheet's AGRI formula transposes these two, so AGRI figures intentionally differ from the source sheet."]);
    noteRow.font = { italic: true, color: { argb: "FF7F7F7F" } };
    noteRow.getCell(1).alignment = { wrapText: true };
  }

  for (const item of items) {
    const row = sheet.addRow({
      itemCode: item.itemCode,
      colour: item.colour,
      itemName: item.itemName ?? "",
      sourceRole: item.sourceRole ?? "",
      unmappedReason: item.unmappedReason ?? "",
      avg3MoSale: item.avg3MoSale,
      pendingOrder: item.pendingOrder,
      pendingOrderLastMonth: item.pendingOrderLastMonth,
      bufferReq: item.bufferReq,
      stock: item.stock,
      minProduction: item.minProduction,
      maxProduction: item.maxProduction,
      order: item.order,
    });

    const planCell = row.getCell("maxProduction");
    planCell.fill = item.maxProduction > 0 ? RED_FILL : GREEN_FILL;
    const minCell = row.getCell("minProduction");
    minCell.fill = item.minProduction > 0 ? RED_FILL : GREEN_FILL;
    const orderCell = row.getCell("order");
    if (item.order > 0) orderCell.fill = BLUE_FILL;
  }
}

function addSummarySheet(workbook: ExcelJS.Workbook, month: string, summary: PlanSummaryResult): void {
  const sheet = workbook.addWorksheet("Summary");
  sheet.columns = [
    { header: "Category", key: "category", width: 32 },
    { header: "Min Production Required", key: "minTotal", width: 22 },
    { header: "Max Production Required", key: "maxTotal", width: 22 },
  ];
  sheet.getRow(1).font = { bold: true };
  // spliceRows inserts a blank at position 1, shifting the auto-created column-header
  // row (Category / Min / Max) from row 1 → row 2, then we write the title into row 1.
  // Do NOT addRow(title) before this — that pattern creates a duplicate ghost row at row 3.
  sheet.spliceRows(1, 0, []);
  sheet.getRow(1).values = [`PTMT Production Plan — ${month}`];

  for (const cat of summary.categories) {
    sheet.addRow({ category: cat.category, minTotal: cat.minTotal, maxTotal: cat.maxTotal });
  }
  const totalRow = sheet.addRow({
    category: "TOTAL",
    minTotal: summary.grandMinTotal,
    maxTotal: summary.grandMaxTotal,
  });
  totalRow.font = { bold: true };
}

export function addLegendSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet("Legend");
  sheet.columns = [{ header: "", width: 4 }, { header: "Meaning", width: 50 }];
  const rows: [string, ExcelJS.Fill | undefined][] = [
    ["Production Plan > 0 (must produce this month)", RED_FILL],
    ["Production Plan ≤ 0 (stock covers demand)", GREEN_FILL],
    ["Min Production > 0 (minimum to make)", RED_FILL],
    ["Order > 0 (live order backlog)", BLUE_FILL],
  ];
  rows.forEach(([label, fill], idx) => {
    const row = sheet.addRow(["", label]);
    if (fill) row.getCell(1).fill = fill;
    void idx;
  });
}

export type FrozenPlanRow = {
  itemCode: string;
  colour: string;
  category: string;
  itemName?: string | null;
  sourceRole?: string | null;
  unmappedReason?: string | null;
  dataLimited?: boolean;
  dataLimitedReason?: string | null;
  avg3MoSale: number;
  stock: number;
  pendingCurrent: number;
  pendingLastMonth: number;
  bufferReq: number | null;
  minProduction: number;
  productionPlan: number;
  temporaryPlan: number;
  cannotBeMade: number;
  dummy: number;
  orders: number;
  buffer: number;
  material: string | null;
  totalKg: number | null;
  urgencyRank: number | null;
  releaseWeek: number | null;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
};

export type ExcelWorkbookAppender = (workbook: ExcelJS.Workbook) => void;

type PrayagCategoryTab = {
  sheetName: string;
  category: string;
};

/**
 * These tab names are the plant workbook's external interface. Keep the
 * spelling/casing here even where it differs from the internal category name.
 */
const PRAYAG_CATEGORY_TABS: PrayagCategoryTab[] = [
  { sheetName: "Cocks Standrad", category: "Cocks Standard" },
  { sheetName: "Cocks Premium", category: "Cocks Premium" },
  { sheetName: "Faucets & Jetsprays&shower", category: "Faucets & Jetsprays & Shower" },
  { sheetName: "Accessorise", category: "Accessorise" },
  { sheetName: "CISTERN & SEAT COVER", category: "Cistern & Seat Cover" },
  { sheetName: "CABINET", category: "Cabinet" },
  { sheetName: "BALL COCK", category: "Ball Cock" },
  { sheetName: "CONNECTION", category: "P.V.C. Connections" },
  { sheetName: "WASTE PIPE", category: "Waste Pipes" },
];

export const PRAYAG_PLAN_HEADERS = [
  "S.NO",
  "MRP",
  "GROUP",
  "ITEM CODE",
  "AVG SALE 25-26",
  "6 MONTH SALE Apr'25 - Sep'25",
  "6 MONTH SALE Oct'25 - Mar'26",
  "LAST 3 MONTH AVG SALE",
  "LAST MONTH SALE (Aug)",
  "PENDING ORDER",
  "PENDING ORDER LAST MONTH",
  "BUFFER STOCK REQ",
  "STOCK",
  "PRODUCTION REQUIRED",
  "Of Which Dummy",
  "Of Which Orders",
  "Of Which Buffer",
];

const PRAYAG_PLAN_COLUMN_WIDTHS = [
  9, 10, 18, 14, 15, 20, 20, 18, 18, 15, 20, 18, 14, 20, 16, 16, 16,
];

function prayagCategoryRows(rows: FrozenPlanRow[], category: string): FrozenPlanRow[] {
  return rows.filter((row) => row.category === category);
}

type PrayagPlanValue = "temporaryPlan" | "productionPlan";

function prayagPlanValue(row: FrozenPlanRow, value: PrayagPlanValue): number {
  return Math.round(Math.max(0, row[value]));
}

function prayagSubtotalValues(
  rows: FrozenPlanRow[],
  value: PrayagPlanValue,
): Array<number | null> {
  const total = (selector: (row: FrozenPlanRow) => number): number =>
    rows.reduce((sum, row) => sum + selector(row), 0);

  // The frozen run does not capture MRP, the two six-month sales bands, or
  // last-month sale. Leave those cells empty instead of querying mutable live
  // sources during export.
  return [
    null,
    null,
    null,
    null,
    total((row) => row.avg3MoSale),
    null,
    total((row) => row.pendingCurrent),
    total((row) => row.pendingLastMonth),
    total((row) => row.bufferReq ?? 0),
    total((row) => row.stock),
    total((row) => prayagPlanValue(row, value)),
    total((row) => row.dummy),
    total((row) => row.orders),
    total((row) => row.buffer),
  ];
}

function setPrayagSubtotalRow(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  label: string,
  rows: FrozenPlanRow[],
  value: PrayagPlanValue,
): void {
  const row = sheet.getRow(rowNumber);
  row.getCell(4).value = label;
  const values = prayagSubtotalValues(rows, value);
  values.forEach((value, index) => {
    row.getCell(index + 5).value = value;
  });
  row.font = { bold: true };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEDEDED" } };
}

function addPrayagTemporaryCategorySheet(
  workbook: ExcelJS.Workbook,
  tab: PrayagCategoryTab,
  rows: FrozenPlanRow[],
  multiplier: number | undefined,
  value: PrayagPlanValue,
  note: string,
): void {
  const sheet = workbook.addWorksheet(tab.sheetName);
  sheet.columns = PRAYAG_PLAN_HEADERS.map((header, index) => ({
    header,
    key: `prayagCol${index + 1}`,
    width: PRAYAG_PLAN_COLUMN_WIDTHS[index],
  }));

  // The source workbook reserves rows 1–2 for its title/link area, then uses
  // rows 3–6 for the multiplier and category totals. Keep that row contract.
  sheet.getRow(1).values = [];
  sheet.getRow(2).values = [];
  sheet.getCell("A2").value = note;
  sheet.getCell("A2").font = { italic: true, color: { argb: "FF7F7F7F" } };
  sheet.mergeCells("A2:Q2");

  sheet.getCell("C3").value = multiplier ?? null;
  sheet.getCell("C3").numFmt = "0.0";
  const metricHeaders = PRAYAG_PLAN_HEADERS.slice(4, 14);
  metricHeaders.forEach((header, index) => {
    sheet.getCell(3, index + 5).value = header;
  });
  sheet.getRow(3).font = { bold: true };
  sheet.getRow(3).alignment = { wrapText: true, vertical: "middle" };
  sheet.getRow(3).height = 32;

  const categoryRows = prayagCategoryRows(rows, tab.category);
  setPrayagSubtotalRow(sheet, 4, tab.category, categoryRows, value);
  setPrayagSubtotalRow(sheet, 6, "TOTAL", categoryRows, value);
  sheet.getRow(5).values = [];

  PRAYAG_PLAN_HEADERS.forEach((header, index) => {
    sheet.getCell(7, index + 1).value = header;
  });
  sheet.getRow(7).font = { bold: true };
  sheet.getRow(7).alignment = { wrapText: true, vertical: "middle" };
  sheet.getRow(7).height = 32;

  categoryRows.forEach((row, index) => {
    const values: Array<string | number | null> = [
      index + 1,
      null,
      null,
      row.itemCode,
      null,
      null,
      null,
      row.avg3MoSale,
      null,
      row.pendingCurrent,
      row.pendingLastMonth,
      row.bufferReq,
      row.stock,
      prayagPlanValue(row, value),
      row.dummy,
      row.orders,
      row.buffer,
    ];
    const worksheetRow = sheet.getRow(8 + index);
    values.forEach((value, valueIndex) => {
      worksheetRow.getCell(valueIndex + 1).value = value;
    });
  });

  for (let rowNumber = 3; rowNumber <= sheet.rowCount; rowNumber += 1) {
    for (let columnNumber = 5; columnNumber <= 17; columnNumber += 1) {
      sheet.getCell(rowNumber, columnNumber).numFmt = "#,##0.##";
    }
  }
  sheet.views = [{ state: "frozen", ySplit: 7 }];
  sheet.autoFilter = { from: "A7", to: `Q${Math.max(7, sheet.rowCount)}` };
}

function addPrayagCategorySheets(
  workbook: ExcelJS.Workbook,
  rows: FrozenPlanRow[],
  multipliers: Record<string, number> = {},
  value: PrayagPlanValue,
  note: string,
): void {
  for (const tab of PRAYAG_CATEGORY_TABS) {
    addPrayagTemporaryCategorySheet(workbook, tab, rows, multipliers[tab.category], value, note);
  }
}

function addPrayagReportSheet(
  workbook: ExcelJS.Workbook,
  reportNumber: number,
  category: PrayagCategoryTab,
  rows: FrozenPlanRow[],
  value: PrayagPlanValue,
  multiplier: number | undefined,
): void {
  const sheet = workbook.addWorksheet(`REPORT ${reportNumber}`);
  sheet.getCell("A1").value = "Frozen plan report";
  sheet.getCell("G1").value = multiplier ?? null;
  sheet.getCell("A1").font = { italic: true, color: { argb: "FF64748B" } };
  sheet.getCell("G1").numFmt = "0.0";

  const headers = [
    "S.NO", "ITEM CODE", "", "", "COLOR CODE", "COLOR", "", "COLOR",
    "LAST 3 MONTH AVG SALE", "LAST MONTH SALE (Aug)", "PENDING ORDER",
    "PENDING ORDER LAST MONTH", "BUFFER STOCK REQ FOR Sep MONTH", "STOCK",
    "%", "PRODUCTION PLAN", "ORDER", "TOTAL STOCK IN HAND",
  ];
  headers.forEach((header, index) => {
    sheet.getCell(16, index + 1).value = header;
  });
  sheet.getRow(16).font = { bold: true };
  sheet.getRow(16).alignment = { wrapText: true, vertical: "middle" };
  sheet.getRow(16).height = 34;

  const categoryRows = prayagCategoryRows(rows, category.category);
  categoryRows.forEach((row, index) => {
    const production = prayagPlanValue(row, value);
    const previous = row.temporaryPlan > 0 ? Math.round(row.temporaryPlan) : production;
    const values: Array<string | number | null> = [
      index + 1,
      row.itemCode,
      null,
      null,
      row.colour,
      row.colour,
      null,
      row.colour,
      row.avg3MoSale,
      null,
      Math.round(row.pendingCurrent),
      Math.round(row.pendingLastMonth),
      row.bufferReq == null ? null : Math.round(row.bufferReq),
      Math.round(row.stock),
      previous > 0 ? production / previous : null,
      production,
      Math.round(row.orders),
      Math.round(row.stock),
    ];
    values.forEach((cellValue, column) => {
      sheet.getCell(17 + index, column + 1).value = cellValue;
    });
  });

  const totalRow = 17 + categoryRows.length;
  sheet.getCell(totalRow, 1).value = "TOTAL";
  sheet.getCell(totalRow, 9).value = categoryRows.reduce((sum, row) => sum + row.avg3MoSale, 0);
  sheet.getCell(totalRow, 11).value = categoryRows.reduce((sum, row) => sum + row.pendingCurrent, 0);
  sheet.getCell(totalRow, 12).value = categoryRows.reduce((sum, row) => sum + row.pendingLastMonth, 0);
  sheet.getCell(totalRow, 13).value = categoryRows.reduce((sum, row) => sum + (row.bufferReq ?? 0), 0);
  sheet.getCell(totalRow, 14).value = categoryRows.reduce((sum, row) => sum + row.stock, 0);
  sheet.getCell(totalRow, 16).value = categoryRows.reduce((sum, row) => sum + prayagPlanValue(row, value), 0);
  sheet.getCell(totalRow, 17).value = categoryRows.reduce((sum, row) => sum + row.orders, 0);
  sheet.getCell(totalRow, 18).value = sheet.getCell(totalRow, 14).value;
  sheet.getRow(totalRow).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 16 }];
  sheet.autoFilter = { from: "A16", to: `R${Math.max(16, totalRow)}` };
  for (let column = 1; column <= 18; column++) sheet.getColumn(column).width = column === 13 ? 24 : 15;
}

function addPrayagSummarySheet(
  workbook: ExcelJS.Workbook,
  month: string,
  rows: FrozenPlanRow[],
  value: PrayagPlanValue,
  tabs: PrayagCategoryTab[],
): void {
  const sheet = workbook.addWorksheet("SUMMARY");
  const headers = [
    "REPORT", "DAYS", "MINIMUM PRODUCTION REQUIRED", "ORDER  AS ON",
    "MAXIMUM PRODUCTION REQUIRED", "MINIMUM PRODUCTION REQUIRED PER DAY",
    "MINIMUM PRODUCTION  ACHIEVEMENT %", "MAXIMUM PRODUCTION REQUIRED PER DAY",
    "MAXIMUM PRODUCTION  ACHIEVEMENT %", "AVERAGE PRODUCTION PER DAY",
    "PRODUCTION  AS ON", "STOCK AS ON 01-Sep-2026",
    "MINIMUM STOCK  UTILIZATION FROM Aug-26", "MAXIMUM STOCK  UTILIZATION FROM Aug-26",
  ];
  headers.forEach((header, index) => { sheet.getCell(2, index + 1).value = header; });
  sheet.getRow(2).font = { bold: true };
  sheet.getRow(2).alignment = { wrapText: true, vertical: "middle" };
  sheet.getRow(2).height = 36;
  sheet.getCell("A1").value = `Frozen ${value === "temporaryPlan" ? "Temporary" : "Production"} Plan — ${month}`;
  sheet.getCell("A1").font = { bold: true };
  sheet.getCell("D3").value = "Live actuals are intentionally blank in frozen exports.";
  sheet.getCell("D3").font = { italic: true, color: { argb: "FF64748B" } };

  tabs.forEach((tab, index) => {
    const categoryRows = prayagCategoryRows(rows, tab.category);
    const outputRow = 4 + index;
    const production = categoryRows.reduce((sum, row) => sum + prayagPlanValue(row, value), 0);
    const baseline = categoryRows.reduce((sum, row) => sum + Math.round(Math.max(0, row.minProduction)), 0);
    sheet.getCell(outputRow, 1).value = `REPORT ${index + 1}`;
    sheet.getCell(outputRow, 2).value = null;
    sheet.getCell(outputRow, 3).value = baseline;
    sheet.getCell(outputRow, 4).value = categoryRows.reduce((sum, row) => sum + row.orders, 0);
    sheet.getCell(outputRow, 5).value = production;
    sheet.getCell(outputRow, 12).value = categoryRows.reduce((sum, row) => sum + row.stock, 0);
  });

  const totalRow = 4 + tabs.length;
  sheet.getCell(totalRow, 1).value = "Total";
  for (const column of [3, 4, 5, 12]) {
    sheet.getCell(totalRow, column).value = tabs.reduce((sum, tab) => {
      const categoryRows = prayagCategoryRows(rows, tab.category);
      if (column === 3) return sum + categoryRows.reduce((s, row) => s + Math.round(Math.max(0, row.minProduction)), 0);
      if (column === 4) return sum + categoryRows.reduce((s, row) => s + row.orders, 0);
      if (column === 5) return sum + categoryRows.reduce((s, row) => s + prayagPlanValue(row, value), 0);
      return sum + categoryRows.reduce((s, row) => s + row.stock, 0);
    }, 0);
  }
  sheet.getRow(totalRow).font = { bold: true };
  for (let column = 1; column <= 14; column++) sheet.getColumn(column).width = column === 1 ? 16 : 20;
}

function addPrayagSupportingSheets(
  workbook: ExcelJS.Workbook,
  rows: FrozenPlanRow[],
  value: PrayagPlanValue,
  addSummary: () => void,
): void {
  const sourceNote = "Frozen run fields only. Uncaptured source fields are intentionally blank; this workbook does not query mutable live Sheets.";

  const sheet12 = workbook.addWorksheet("Sheet12");
  sheet12.getCell("A1").value = sourceNote;
  sheet12.getCell("A1").font = { italic: true, color: { argb: "FF64748B" } };
  ["Item Code", "Colour", "Dummy Qty", "Pending Order"].forEach((header, index) => {
    sheet12.getCell(3, index + 1).value = header;
  });
  rows.forEach((row, index) => {
    sheet12.getCell(4 + index, 1).value = row.itemCode;
    sheet12.getCell(4 + index, 2).value = row.colour;
    sheet12.getCell(4 + index, 3).value = Math.round(row.dummy);
    sheet12.getCell(4 + index, 4).value = Math.round(row.orders);
  });

  const pdata = workbook.addWorksheet("P-DATA");
  pdata.getCell("A1").value = sourceNote;
  pdata.getCell("A1").font = { italic: true, color: { argb: "FF64748B" } };
  ["Date", "Code", "Color", "Qty", "Group", "Avg 3-Mo Sale", "Stock", "Pending Current", "Pending Last Month", "Plan"].forEach((header, index) => {
    pdata.getCell(2, index + 1).value = header;
  });
  rows.forEach((row, index) => {
    const values = [
      null, row.itemCode, row.colour, prayagPlanValue(row, value), row.category,
      row.avg3MoSale, row.stock, row.pendingCurrent, row.pendingLastMonth,
      prayagPlanValue(row, value),
    ];
    values.forEach((cellValue, column) => { pdata.getCell(3 + index, column + 1).value = cellValue; });
  });

  const colors = workbook.addWorksheet("Color summary");
  colors.getCell("A1").value = sourceNote;
  colors.getCell("A1").font = { italic: true, color: { argb: "FF64748B" } };
  [["Stock to Order", "Stock to Order"], ["Red", ""], ["Yellow", ""], ["Green", ""], ["Blue", ""], ["Purple", ""],
    ["Order to Production", "Order to Production"], ["Red", ""], ["Yellow", ""], ["Green", ""], ["Blue", ""], ["Purple", ""],
    ["Production Required", "Production Required"]].forEach((values, index) => {
    colors.getCell(2 + index, 2).value = values[0];
    colors.getCell(2 + index, 3).value = values[1];
  });

  addSummary();

  const top = workbook.addWorksheet("TOP ITEM");
  top.getCell("A1").value = sourceNote;
  top.getCell("A1").font = { italic: true, color: { argb: "FF64748B" } };
  [
    "S.NO", "Item Code", "Color", "Sale Qty 2026-27", "LAST 3 MONTH SALE",
    "LAST 3 MONTH AVG SALE", "LAST MONTH SALE", "Pending Order",
    "BUFFER STOCK REQ", "LAST Month Pending Order", "STOCK", "PRODUCTION PLAN",
    "ORDER", "ORDER %", "Production", "Stock Balance",
  ].forEach((header, index) => { top.getCell(3, index + 1).value = header; });
  top.getRow(3).font = { bold: true };
  [...rows]
    .sort((a, b) => prayagPlanValue(b, value) - prayagPlanValue(a, value))
    .slice(0, 100)
    .forEach((row, index) => {
      const plan = prayagPlanValue(row, value);
      const values = [index + 1, row.itemCode, row.colour, null, null, row.avg3MoSale, null,
        row.pendingCurrent, row.bufferReq, row.pendingLastMonth, row.stock, plan, row.orders,
        plan > 0 ? row.orders / plan : null, plan, row.stock];
      values.forEach((cellValue, column) => { top.getCell(4 + index, column + 1).value = cellValue; });
    });

  const govt = workbook.addWorksheet("GOVT.");
  govt.getCell("A1").value = "Government-specific classification is not persisted in the frozen plan run.";
  govt.getCell("A1").font = { italic: true, color: { argb: "FF64748B" } };
  ["S.NO", "Item Code", "Colour", "Category", "Production Required", "Orders", "Stock"].forEach((header, index) => {
    govt.getCell(3, index + 1).value = header;
  });
  govt.getRow(3).font = { bold: true };
}

function addGenericPlanTabs(
  workbook: ExcelJS.Workbook,
  rows: FrozenPlanRow[],
  value: PrayagPlanValue,
): void {
  const byCategory = new Map<string, FrozenPlanRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }

  for (const [category, categoryRows] of byCategory) {
    const sheet = workbook.addWorksheet(category.slice(0, 31));
    sheet.columns = PRAYAG_PLAN_HEADERS.map((header, index) => ({
      header,
      key: `planColumn${index + 1}`,
      width: PRAYAG_PLAN_COLUMN_WIDTHS[index],
    }));
    sheet.getRow(1).font = { bold: true };
    sheet.getCell("A2").value = "Frozen plan snapshot; live actual columns are intentionally blank.";
    sheet.mergeCells("A2:Q2");
    categoryRows.forEach((row, index) => {
      const values: Array<string | number | null> = [
        index + 1, null, row.category, row.itemCode, null, null, null,
        row.avg3MoSale, null, row.pendingCurrent, row.pendingLastMonth,
        row.bufferReq, row.stock, prayagPlanValue(row, value), row.dummy,
        row.orders, row.buffer,
      ];
      values.forEach((cellValue, column) => { sheet.getCell(8 + index, column + 1).value = cellValue; });
    });
    PRAYAG_PLAN_HEADERS.forEach((header, index) => { sheet.getCell(7, index + 1).value = header; });
    sheet.getRow(7).font = { bold: true };
    sheet.getRow(7).alignment = { wrapText: true, vertical: "middle" };
    sheet.getRow(7).height = 32;
    sheet.views = [{ state: "frozen", ySplit: 7 }];
    sheet.autoFilter = { from: "A7", to: `Q${Math.max(7, sheet.rowCount)}` };
  }
}

const COMPACT_CATEGORY_ORDER = [
  "Cocks Standard",
  "Cocks Premium",
  "Faucets & Jetsprays & Shower",
  "Accessorise",
  "Cistern & Seat Cover",
  "Cabinet",
  "Ball Cock",
  "P.V.C. Connections",
  "Waste Pipes",
];

const COMPACT_HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F4E78" },
};
const COMPACT_TITLE_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF17365D" },
};
const COMPACT_TOTAL_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFD9EAD3" },
};
const COMPACT_BORDER: Partial<ExcelJS.Borders> = {
  bottom: { style: "thin", color: { argb: "FFD9E2F3" } },
};

function styleCompactHeader(row: ExcelJS.Row): void {
  row.height = 30;
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = COMPACT_HEADER_FILL;
  row.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
}

function configureCompactSheet(
  sheet: ExcelJS.Worksheet,
  lastRow: number,
  repeatHeader = true,
): void {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.properties.showGridLines = false;
  sheet.autoFilter = { from: "A1", to: `J${Math.max(1, lastRow)}` };
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    horizontalCentered: false,
    verticalCentered: false,
    ...(repeatHeader ? { printTitlesRow: "1:1" } : {}),
  };
}

function compactPlanValue(row: FrozenPlanRow, value: PrayagPlanValue): number {
  return Math.max(0, row[value]);
}

function addCompactCategorySheet(
  workbook: ExcelJS.Workbook,
  category: string,
  rows: FrozenPlanRow[],
  value: PrayagPlanValue,
): void {
  const sheet = workbook.addWorksheet(category.slice(0, 31));
  const columns: Partial<ExcelJS.Column>[] = [
    { header: "Item Code", key: "itemCode", width: 16 },
    { header: "Colour", key: "colour", width: 16 },
    { header: "Item Name", key: "itemName", width: 28 },
    { header: "Source Role", key: "sourceRole", width: 24 },
    { header: "Unmapped Reason", key: "unmappedReason", width: 24 },
    { header: "Avg 3-Mo Sale", key: "avg3MoSale", width: 15 },
    { header: "Pending Order", key: "pendingOrder", width: 15 },
    { header: "Pending Last Mo", key: "pendingLastMonth", width: 17 },
    { header: "Buffer Req", key: "bufferReq", width: 14 },
    { header: "Stock", key: "stock", width: 12 },
    { header: "Min Production", key: "minProduction", width: 16 },
    { header: "Production Plan", key: "productionPlan", width: 17 },
    { header: "Order", key: "order", width: 12 },
  ];
  if (rows.some((row) => row.dataLimited)) {
    columns.push(
      { header: "Data Status", key: "dataStatus", width: 18 },
      { header: "Data-Limited Reason", key: "dataLimitedReason", width: 36 },
    );
  }
  sheet.columns = columns;
  styleCompactHeader(sheet.getRow(1));

  for (const sourceRow of rows) {
    const productionPlan = compactPlanValue(sourceRow, value);
    const row = sheet.addRow({
      itemCode: sourceRow.itemCode,
      colour: sourceRow.colour,
      itemName: sourceRow.itemName ?? "",
      sourceRole: sourceRow.sourceRole ?? "",
      unmappedReason: sourceRow.unmappedReason ?? "",
      avg3MoSale: sourceRow.avg3MoSale,
      pendingOrder: sourceRow.pendingCurrent,
      pendingLastMonth: sourceRow.pendingLastMonth,
      bufferReq: sourceRow.bufferReq,
      stock: sourceRow.stock,
      minProduction: Math.max(0, sourceRow.minProduction),
      productionPlan,
      order: sourceRow.orders,
      dataStatus: sourceRow.dataLimited ? "DATA-LIMITED" : "",
      dataLimitedReason: sourceRow.dataLimitedReason ?? "",
    });

    row.eachCell((cell, columnNumber) => {
      cell.border = COMPACT_BORDER;
      if (columnNumber >= 3) cell.numFmt = "#,##0.##";
    });
    row.getCell("minProduction").fill = sourceRow.minProduction > 0 ? RED_FILL : GREEN_FILL;
    row.getCell("productionPlan").fill = productionPlan > 0 ? RED_FILL : GREEN_FILL;
    if (sourceRow.orders > 0) row.getCell("order").fill = BLUE_FILL;
  }

  configureCompactSheet(sheet, sheet.rowCount);
}

function addCompactSummarySheet(
  workbook: ExcelJS.Workbook,
  month: string,
  planType: "temporary" | "production",
  rows: FrozenPlanRow[],
  value: PrayagPlanValue,
  segmentLabel: string,
): void {
  const sheet = workbook.addWorksheet("Summary");
  sheet.columns = [
    { header: "Category", key: "category", width: 34 },
    { header: "Min Production Required", key: "minTotal", width: 24 },
    { header: "Max Production Required", key: "maxTotal", width: 24 },
  ];

  const title = `${segmentLabel} ${planType === "temporary" ? "Temporary" : "Production"} Plan — ${month}`;
  sheet.mergeCells("A1:C1");
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
  sheet.getCell("A1").fill = COMPACT_TITLE_FILL;
  sheet.getCell("A1").alignment = { horizontal: "left", vertical: "middle" };
  sheet.getRow(1).height = 28;

  sheet.getRow(2).values = ["Category", "Min Production Required", "Max Production Required"];
  styleCompactHeader(sheet.getRow(2));

  const categories = new Map<string, FrozenPlanRow[]>();
  for (const row of rows) {
    const categoryRows = categories.get(row.category) ?? [];
    categoryRows.push(row);
    categories.set(row.category, categoryRows);
  }
  const orderedCategories = [
    ...COMPACT_CATEGORY_ORDER.filter((category) => categories.has(category)),
    ...[...categories.keys()].filter((category) => !COMPACT_CATEGORY_ORDER.includes(category)),
  ];

  for (const category of orderedCategories) {
    const categoryRows = categories.get(category) ?? [];
    const summaryRow = sheet.addRow({
      category,
      minTotal: categoryRows.reduce((sum, row) => sum + Math.max(0, row.minProduction), 0),
      maxTotal: categoryRows.reduce((sum, row) => sum + compactPlanValue(row, value), 0),
    });
    summaryRow.eachCell((cell, columnNumber) => {
      cell.border = COMPACT_BORDER;
      if (columnNumber > 1) cell.numFmt = "#,##0.##";
    });
  }

  const totalRow = sheet.addRow({
    category: "TOTAL",
    minTotal: rows.reduce((sum, row) => sum + Math.max(0, row.minProduction), 0),
    maxTotal: rows.reduce((sum, row) => sum + compactPlanValue(row, value), 0),
  });
  totalRow.font = { bold: true };
  totalRow.fill = COMPACT_TOTAL_FILL;
  totalRow.eachCell((cell, columnNumber) => {
    cell.border = { top: { style: "medium", color: { argb: "FF548235" } } };
    if (columnNumber > 1) cell.numFmt = "#,##0.##";
  });

  sheet.views = [{ state: "frozen", ySplit: 2 }];
  sheet.properties.showGridLines = false;
  sheet.pageSetup = {
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    horizontalCentered: true,
    verticalCentered: false,
    printTitlesRow: "2:2",
  };
}

function addCompactLegendSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet("Legend");
  sheet.columns = [
    { header: "", width: 8 },
    { header: "Meaning", width: 58 },
  ];
  styleCompactHeader(sheet.getRow(1));
  sheet.getRow(1).getCell(1).value = "";

  const rows: Array<[string, ExcelJS.Fill]> = [
    ["Production Plan > 0 (must produce this month)", RED_FILL],
    ["Production Plan = 0 (stock covers demand)", GREEN_FILL],
    ["Min Production > 0 (minimum to make)", RED_FILL],
    ["Order > 0 (live order backlog)", BLUE_FILL],
  ];
  for (const [meaning, fill] of rows) {
    const row = sheet.addRow(["", meaning]);
    row.getCell(1).fill = fill;
    row.getCell(2).border = COMPACT_BORDER;
  }
  sheet.properties.showGridLines = false;
  sheet.pageSetup = {
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
  };
}

function exportCompactPlanWorkbook(
  workbook: ExcelJS.Workbook,
  month: string,
  planType: "temporary" | "production",
  rows: FrozenPlanRow[],
): void {
  const value: PrayagPlanValue = planType === "temporary" ? "temporaryPlan" : "productionPlan";
  const segmentLabel = rows.some((row) => COMPACT_CATEGORY_ORDER.includes(row.category))
    ? "PTMT"
    : "Production";
  addCompactSummarySheet(workbook, month, planType, rows, value, segmentLabel);

  const categories = new Map<string, FrozenPlanRow[]>();
  for (const row of rows) {
    const categoryRows = categories.get(row.category) ?? [];
    categoryRows.push(row);
    categories.set(row.category, categoryRows);
  }
  const orderedCategories = [
    ...COMPACT_CATEGORY_ORDER.filter((category) => categories.has(category)),
    ...[...categories.keys()].filter((category) => !COMPACT_CATEGORY_ORDER.includes(category)),
  ];
  for (const category of orderedCategories) {
    addCompactCategorySheet(workbook, category, categories.get(category) ?? [], value);
  }
  addCompactLegendSheet(workbook);
}

/**
 * Build the compact plant-facing workbook shape used by the supplied PTMT
 * production-plan reference.
 *
 * The frozen run is the only source of plan values. Fields which the run does
 * not persist are not reconstructed from mutable workbooks during export.
 */
export async function exportPrayagPlanExcel(
  month: string,
  planType: "temporary" | "production",
  rows: FrozenPlanRow[],
  multipliers: Record<string, number> = {},
  appendSheets?: (workbook: ExcelJS.Workbook) => void,
): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PTMT Production Planning";
  void multipliers;
  exportCompactPlanWorkbook(workbook, month, planType, rows);
  appendSheets?.(workbook);
  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

export function addTemporaryPlanSheet(
  workbook: ExcelJS.Workbook,
  month: string,
  rows: FrozenPlanRow[],
): void {
  const sheet = workbook.addWorksheet("Temporary Plan");
  const columns: Partial<ExcelJS.Column>[] = [
    { header: "Item Code", key: "itemCode", width: 14 },
    { header: "Colour", key: "colour", width: 14 },
    { header: "Category", key: "category", width: 28 },
    { header: "Item Name", key: "itemName", width: 28 },
    { header: "Source Role", key: "sourceRole", width: 24 },
    { header: "Unmapped Reason", key: "unmappedReason", width: 24 },
    { header: "Demand Quantity", key: "demand", width: 18 },
    { header: "Of Which Dummy", key: "dummy", width: 16 },
    { header: "Of Which Orders", key: "orders", width: 16 },
    { header: "Of Which Buffer", key: "buffer", width: 16 },
  ];
  if (rows.some((row) => row.dataLimited)) {
    columns.push(
      { header: "Data Status", key: "dataStatus", width: 18 },
      { header: "Data-Limited Reason", key: "dataLimitedReason", width: 36 },
    );
  }
  sheet.columns = columns;
  sheet.getRow(1).font = { bold: true };
  const note = sheet.addRow([`Temporary Plan — ${month}. Demand-true snapshot; not issued to the floor and not capacity-fitted.`]);
  note.font = { italic: true, color: { argb: "FF7F7F7F" } };
  note.getCell(1).alignment = { wrapText: true };
  for (const row of rows) {
    sheet.addRow({
      itemCode: row.itemCode,
      colour: row.colour,
      category: row.category,
      itemName: row.itemName ?? "",
      sourceRole: row.sourceRole ?? "",
      unmappedReason: row.unmappedReason ?? "",
      demand: Math.round(row.temporaryPlan),
      dummy: Math.round(row.dummy),
      orders: Math.round(row.orders),
      buffer: Math.round(row.buffer),
      dataStatus: row.dataLimited ? "DATA-LIMITED" : "",
      dataLimitedReason: row.dataLimitedReason ?? "",
    });
  }
}

function addFrozenProductionSheets(
  workbook: ExcelJS.Workbook,
  rows: FrozenPlanRow[],
): void {
  const byCategory = new Map<string, FrozenPlanRow[]>();
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? [];
    list.push(row);
    byCategory.set(row.category, list);
  }
  for (const [category, categoryRows] of byCategory) {
    const sheet = workbook.addWorksheet(category.slice(0, 31));
    const columns: Partial<ExcelJS.Column>[] = [
      { header: "Item Code", key: "itemCode", width: 14 },
      { header: "Colour", key: "colour", width: 14 },
      { header: "Temporary Demand", key: "temporaryPlan", width: 18 },
      { header: "Production Plan", key: "productionPlan", width: 18 },
      { header: "Cannot Be Made", key: "cannotBeMade", width: 16 },
      { header: "W1", key: "w1", width: 10 },
      { header: "W2", key: "w2", width: 10 },
      { header: "W3", key: "w3", width: 10 },
      { header: "W4", key: "w4", width: 10 },
      { header: "Material", key: "material", width: 12 },
      { header: "Total kg", key: "totalKg", width: 12 },
      { header: "Urgency rank", key: "urgencyRank", width: 14 },
    ];
    if (categoryRows.some((row) => row.dataLimited)) {
      columns.push(
        { header: "Data Status", key: "dataStatus", width: 18 },
        { header: "Data-Limited Reason", key: "dataLimitedReason", width: 36 },
      );
    }
    sheet.columns = columns;
    sheet.getRow(1).font = { bold: true };
    for (const row of categoryRows) {
      sheet.addRow({
        ...row,
        dataStatus: row.dataLimited ? "DATA-LIMITED" : "",
        dataLimitedReason: row.dataLimitedReason ?? "",
      });
    }
  }
}

export async function exportFrozenPlanExcel(
  month: string,
  planType: "temporary" | "production",
  rows: FrozenPlanRow[],
  temporaryRows: FrozenPlanRow[] = [],
  multipliers: Record<string, number> = {},
  appendSheets?: ExcelWorkbookAppender,
): Promise<Buffer> {
  void temporaryRows;
  return exportPrayagPlanExcel(month, planType, rows, multipliers, appendSheets);
}

export async function exportPlanExcel(
  month: string,
  items: CalcPlanItem[],
  summary: PlanSummaryResult,
  requiredCategories?: string[],
): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  addSummarySheet(workbook, month, summary);

  // Pre-seed with required categories so tabs always exist (e.g. SWR Solvent even when 0 pcs,
  // AGRI Solvent when all items are ≤ 0 under the swragri formula).
  const byCategory = new Map<string, CalcPlanItem[]>();
  if (requiredCategories) {
    for (const cat of requiredCategories) {
      byCategory.set(cat, []);
    }
  }
  for (const item of items) {
    const list = byCategory.get(item.category) ?? [];
    list.push(item);
    byCategory.set(item.category, list);
  }
  for (const [category, categoryItems] of byCategory) {
    addCategorySheet(workbook, category, categoryItems);
  }
  addLegendSheet(workbook);

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}
