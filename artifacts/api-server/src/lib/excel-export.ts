import { ITEM_MAPPING } from "./item-mapping";
import type ExcelJS from "exceljs";
import type { CalcPlanItem, PlanSummaryResult } from "./calc";
import {
  SEPTEMBER_PTMT_PRAYAG_MULTIPLIERS,
  SEPTEMBER_PTMT_SOURCE_TARGETS,
  SEPTEMBER_PTMT_TARGET_SNAPSHOT,
  type PtmtPrayagMultiplierEvidence,
} from "./plumbing-golden";
import {
  deriveEffectiveMultiplier,
  factorStatus,
  type PlanRunProvenance,
} from "./plan-run-provenance";

export const RED_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4CCCC" } };
export const GREY_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFEFEFEF" } };
export const GREEN_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9EAD3" } };
export const BLUE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFCFE2F3" } };

export const ITEM_COLUMNS: Partial<ExcelJS.Column>[] = [
  { header: "Item Code", key: "itemCode", width: 14 },
  { header: "Colour", key: "colour", width: 14 },
  { header: "Item Name", key: "itemName", width: 28 },
  { header: "3-month average sale", key: "avg3MoSale", width: 14 },
  { header: "Live orders", key: "pendingOrder", width: 14 },
  { header: "Already sold, undelivered", key: "pendingOrderLastMonth", width: 16 },
  { header: "Buffer target", key: "bufferReq", width: 12 },
  { header: "Stock in hand", key: "stock", width: 10 },
  { header: "Minimum", key: "minProduction", width: 14 },
  { header: "MAKE THIS MONTH", key: "maxProduction", width: 14 },
  { header: "Order", key: "order", width: 10 },
  { header: "Source Role", key: "sourceRole", width: 24 },
  { header: "Unmapped Reason", key: "unmappedReason", width: 24 },
  { header: "Master Category", key: "masterCategory", width: 20 },
  { header: "Sub-category", key: "subCategory", width: 20 },
];

function addCategorySheet(workbook: ExcelJS.Workbook, category: string, items: CalcPlanItem[]): void {
  const sheet = workbook.addWorksheet(category.slice(0, 31));
  sheet.columns = ITEM_COLUMNS;

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };
  headerRow.alignment = { wrapText: true, vertical: "middle" };

  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `O${items.length + 1}` };
  sheet.pageSetup = { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" };

  // AGRI: header note explaining the intentional divergence from the source sheet.
  let rowOffset = 1;
  if (category.startsWith("AGRI")) {
    const noteRow = sheet.insertRow(2, ["AGRI is computed from the STOCK and BUFFER columns by header name; the source sheet's AGRI formula transposes these two, so AGRI figures intentionally differ from the source sheet."]);
    noteRow.font = { italic: true, color: { argb: "FF7F7F7F" } };
    noteRow.getCell(1).alignment = { wrapText: true };
    sheet.mergeCells("A2:O2");
    rowOffset = 2;
    sheet.views = [{ state: "frozen", ySplit: 2 }];
    sheet.autoFilter = { from: "A2", to: `O${items.length + 2}` };
  }

  let totals = {
    avg3MoSale: 0, pendingOrder: 0, pendingOrderLastMonth: 0,
    bufferReq: 0, stock: 0, minProduction: 0, maxProduction: 0, order: 0
  };

  for (const item of items) {
    const mapEntry = ITEM_MAPPING[item.itemCode];
    let itemName = item.itemName ?? "";
    let masterCategory = "not in grouping master";
    let subCategory = "not in grouping master";

    if (mapEntry) {
      if (!itemName && mapEntry.d) itemName = mapEntry.d;
      if (mapEntry.m) masterCategory = mapEntry.m;
      if (mapEntry.s) subCategory = mapEntry.s;
    }

    const row = sheet.addRow({
      itemCode: item.itemCode,
      colour: item.colour,
      itemName,
      avg3MoSale: item.avg3MoSale,
      pendingOrder: item.pendingOrder,
      pendingOrderLastMonth: item.pendingOrderLastMonth,
      bufferReq: item.bufferReq,
      stock: item.stock,
      minProduction: item.minProduction,
      maxProduction: item.maxProduction,
      order: item.order,
      sourceRole: category === "Unclassified" ? (item.sourceRole ?? "") : "",
      unmappedReason: category === "Unclassified" ? (item.unmappedReason ?? "") : "",
      masterCategory,
      subCategory
    });

    if (category !== "Unclassified") {
      row.getCell("sourceRole").value = item.sourceRole ?? "";
      row.getCell("unmappedReason").value = item.unmappedReason ?? "";
    }

    const planCell = row.getCell("maxProduction");
    planCell.fill = item.maxProduction > 0 ? GREEN_FILL : GREY_FILL;
    const soldCell = row.getCell("pendingOrderLastMonth");
    if (item.pendingOrderLastMonth > 0) soldCell.fill = RED_FILL;

    const numericCols = ["avg3MoSale", "pendingOrder", "pendingOrderLastMonth", "bufferReq", "stock", "minProduction", "maxProduction", "order"];
    for (const col of numericCols) {
      const cell = row.getCell(col);
      if (typeof cell.value === "number") {
        cell.numFmt = "#,##0";
      }
    }

    totals.avg3MoSale += item.avg3MoSale;
    totals.pendingOrder += item.pendingOrder;
    totals.pendingOrderLastMonth += item.pendingOrderLastMonth;
    totals.bufferReq += (item.bufferReq || 0);
    totals.stock += item.stock;
    totals.minProduction += item.minProduction;
    totals.maxProduction += item.maxProduction;
    totals.order += item.order;
  }

  const totalRow = sheet.addRow({
    itemCode: "TOTAL",
    avg3MoSale: totals.avg3MoSale,
    pendingOrder: totals.pendingOrder,
    pendingOrderLastMonth: totals.pendingOrderLastMonth,
    bufferReq: totals.bufferReq,
    stock: totals.stock,
    minProduction: totals.minProduction,
    maxProduction: totals.maxProduction,
    order: totals.order
  });

  totalRow.font = { bold: true, color: { argb: "FFB45F06" } };
  totalRow.eachCell(cell => {
    cell.border = { top: { style: "medium" } };
  });

  const numericCols = ["avg3MoSale", "pendingOrder", "pendingOrderLastMonth", "bufferReq", "stock", "minProduction", "maxProduction", "order"];
  for (const col of numericCols) {
    const cell = totalRow.getCell(col);
    if (typeof cell.value === "number") {
      cell.numFmt = "#,##0";
    }
  }
}

function addSummarySheet(workbook: ExcelJS.Workbook, month: string, summary: PlanSummaryResult, segment: string, planType: string, runId?: number): void {
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
  sheet.getRow(1).values = [`${segment} ${planType.charAt(0).toUpperCase() + planType.slice(1)} Plan — ${month}${runId ? ' (Run ' + runId + ')' : ''}`];

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
  demandPlan?: number;
  productionPlan: number;
  temporaryPlan: number;
  cannotBeMade: number;
  feasibilityStatus?: string;
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

export type PtmtTargetDecomposition = {
  report: string;
  category: string;
  runRows: number;
  appDemand: number;
  prayagTarget: number | null;
  difference: number | null;
  appMultiplier: number | null;
  recordedMultiplier: number | null;
  factorStatus: "PASS" | "DISCREPANCY" | "UNAVAILABLE";
  prayagMultiplier: number | null;
  prayagMultiplierSource: string | null;
  prayagMultiplierReadDate: string | null;
  multiplierEffect: number | null;
  residual: number | null;
  note: string;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

function demandAtMultiplier(rows: FrozenPlanRow[], multiplier: number): number {
  return round2(rows.reduce((sum, row) => {
    const bufferReq = round2(row.avg3MoSale * multiplier);
    return sum + Math.max(
      bufferReq - row.stock + row.pendingLastMonth + row.pendingCurrent,
      0,
    );
  }, 0));
}

function recordedMultiplierForCategory(
  multipliers: Record<string, number>,
  category: string,
): number | null {
  const multiplier = multipliers[category];
  return typeof multiplier === "number" && Number.isFinite(multiplier) ? multiplier : null;
}

export function buildPtmtTargetDecomposition(
  month: string,
  rows: FrozenPlanRow[],
  multipliers: Record<string, number> = {},
): PtmtTargetDecomposition[] {
  if (month !== "2026-09") return [];

  return SEPTEMBER_PTMT_SOURCE_TARGETS.map((target) => {
    const categoryRows = rows.filter((row) => row.category === target.category);
    const appDemand = categoryRows.reduce(
      (sum, row) => sum + Math.round(Math.max(0, row.temporaryPlan)),
      0,
    );
    const evidence: PtmtPrayagMultiplierEvidence | undefined =
      SEPTEMBER_PTMT_PRAYAG_MULTIPLIERS[target.category];
    const difference = target.target == null ? null : appDemand - target.target;
    const appMultiplier = deriveEffectiveMultiplier(categoryRows, target.category);
    const recordedMultiplier = recordedMultiplierForCategory(multipliers, target.category);
    const currentFactorStatus = factorStatus(appMultiplier, recordedMultiplier);
    const prayagMultiplier = evidence?.value ?? null;
    const canDecompose = target.target != null && prayagMultiplier != null;
    const prayagDemand = canDecompose
      ? demandAtMultiplier(categoryRows, prayagMultiplier)
      : null;
    // Keep the effect in the same app-minus-Prayag direction as Difference.
    // The Prayag-basis demand is recomputed from row inputs; it is never
    // derived by subtracting the residual.
    const multiplierEffect = prayagDemand == null ? null : round2(
      demandAtMultiplier(categoryRows, appMultiplier ?? evidence.value!) - prayagDemand,
    );
    const residual = difference == null || multiplierEffect == null
      ? (evidence?.note ? difference : null)
      : round2(difference - multiplierEffect);

    const baseNote = evidence?.note
      ?? (target.target == null ? "No Prayag comparison" : "Decomposed from frozen row inputs");
    const note = currentFactorStatus === "DISCREPANCY"
      ? `${baseNote}; recorded factor ${recordedMultiplier!.toFixed(2)}x disagrees with effective frozen-row factor ${appMultiplier!.toFixed(2)}x`
      : baseNote;

    return {
      report: target.report,
      category: target.category,
      runRows: categoryRows.length,
      appDemand,
      prayagTarget: target.target,
      difference,
      appMultiplier,
      recordedMultiplier,
      factorStatus: currentFactorStatus,
      prayagMultiplier: evidence?.value ?? null,
      prayagMultiplierSource: evidence?.source ?? null,
      prayagMultiplierReadDate: evidence?.readDate ?? null,
      multiplierEffect,
      residual,
      note,
    };
  });
}

/**
 * Adds the PTMT Temporary Plan's source-comparison context without changing
 * any frozen plan values. Prayag's September comparison is reporting evidence,
 * not an executable planning input.
 */
export function addPtmtTemporaryTargetSheet(
  workbook: ExcelJS.Workbook,
  month: string,
  rows: FrozenPlanRow[],
  multipliers: Record<string, number> = {},
): void {
  const sheet = workbook.addWorksheet("PTMT TARGETS");
  sheet.addRow([`PTMT Temporary Plan — Prayag comparison — ${month}`]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow(["Frozen source", "Temporary Plan run snapshot; values are not recalculated from live workbooks"]);
  sheet.addRow(["App multiplier basis", "July 2026 business values"]);
  sheet.addRow(["Prayag snapshot", `${SEPTEMBER_PTMT_TARGET_SNAPSHOT.readDate}; ${SEPTEMBER_PTMT_TARGET_SNAPSHOT.multiplierSet}`]);
  sheet.addRow(["Decomposition", "Difference = app demand − Prayag target; multiplier effect = app-basis recomputation − Prayag-basis recomputation; residual = difference − multiplier effect"]);
  sheet.addRow([]);
  sheet.addRow([
    "Report", "Category", "Run rows", "Temporary Plan demand",
     "Prayag target", "Difference", "Effective app multiplier",
     "Recorded factor", "Factor check",
    "Prayag multiplier", "Prayag source", "Prayag read date",
    "Multiplier effect", "Residual", "Comparison",
  ]);
  sheet.getRow(7).font = { bold: true };

  const targetRows = buildPtmtTargetDecomposition(month, rows, multipliers);

  for (const target of targetRows) {
    sheet.addRow([
      target.report,
      target.category,
      target.runRows,
      target.appDemand,
      target.prayagTarget,
      target.difference,
      target.appMultiplier,
       target.recordedMultiplier,
       target.factorStatus,
      target.prayagMultiplier ?? target.note,
       target.prayagMultiplierSource,
       target.prayagMultiplierReadDate,
      target.multiplierEffect,
      target.residual,
      target.prayagTarget == null ? "No Prayag comparison" : target.note,
    ]);
  }

  const unclassifiedDemand = rows
    .filter((row) => row.category === "Unclassified")
    .reduce((sum, row) => sum + Math.round(Math.max(0, row.temporaryPlan)), 0);
  if (unclassifiedDemand > 0 || rows.some((row) => row.category === "Unclassified")) {
    sheet.addRow([
      "—",
      "Unclassified",
      rows.filter((row) => row.category === "Unclassified").length,
      unclassifiedDemand,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      "No Prayag comparison; holding state",
    ]);
  }

  const availableTargets = targetRows.filter((target) => target.prayagTarget != null);
  const availableTargetTotal = availableTargets.reduce((sum, target) => sum + (target.prayagTarget ?? 0), 0);
  const availableDemandTotal = availableTargets.reduce((sum, target) => sum + target.appDemand, 0);
  const availableDifferenceTotal = availableTargets.reduce((sum, target) => sum + (target.difference ?? 0), 0);
  const availableMultiplierEffectTotal = availableTargets.reduce((sum, target) => sum + (target.multiplierEffect ?? 0), 0);
  const availableResidualTotal = availableTargets.reduce((sum, target) => sum + (target.residual ?? 0), 0);
  sheet.addRow([]);
  sheet.addRow([
    "Reports 1–7 total",
    "Available Prayag comparison",
    availableTargets.reduce((sum, target) => sum + target.runRows, 0),
    availableDemandTotal,
    availableTargetTotal,
    availableDifferenceTotal,
    null,
    null,
    null,
    null,
      null,
      null,
    availableMultiplierEffectTotal,
    availableResidualTotal,
    "Reported comparison with independent multiplier decomposition",
  ]);
  sheet.getRow(sheet.rowCount).font = { bold: true };

  sheet.addRow([]);
  sheet.addRow(["Multiplier detail", "Category", "App value", "Prayag value", "Prayag source", "Prayag read date", "Note"]);
  sheet.getRow(sheet.rowCount).font = { bold: true };
    for (const [category, multiplier] of Object.entries(multipliers)) {
    const evidence = SEPTEMBER_PTMT_PRAYAG_MULTIPLIERS[category];
    sheet.addRow([
      "Multiplier lookup",
      category,
      multiplier,
      evidence?.value ?? null,
      evidence?.source ?? null,
      evidence?.readDate ?? null,
      evidence?.note ?? null,
    ]);
  }

  sheet.mergeCells("A1:O1");
  sheet.getRow(4).alignment = { wrapText: true };
  sheet.getRow(5).alignment = { wrapText: true };
  sheet.getRow(7).alignment = { wrapText: true, vertical: "middle" };
  sheet.views = [{ state: "frozen", ySplit: 7 }];
  sheet.autoFilter = { from: "A7", to: `O${Math.max(7, sheet.rowCount)}` };
  [14, 32, 12, 22, 18, 16, 18, 14, 18, 34, 16, 18, 16, 16, 44].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  for (let row = 8; row <= sheet.rowCount; row++) {
    for (const column of [4, 5, 6, 13, 14]) sheet.getCell(row, column).numFmt = "#,##0.00";
    for (const column of [7, 8, 10]) sheet.getCell(row, column).numFmt = "0.0x";
  }
}

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
  fgColor: { argb: "FFFCE5CD" },
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
  lastCol = "J",
): void {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.properties.showGridLines = false;
  sheet.autoFilter = { from: "A1", to: `${lastCol}${Math.max(1, lastRow)}` };
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
    { header: "Item Code", key: "itemCode", width: 14 },
    { header: "Colour", key: "colour", width: 14 },
    { header: "Item Name", key: "itemName", width: 28 },
    { header: "3-month average sale", key: "avg3MoSale", width: 14 },
    { header: "Live orders", key: "pendingOrder", width: 14 },
    { header: "Already sold, undelivered", key: "pendingLastMonth", width: 16 },
    { header: "Buffer target", key: "bufferReq", width: 12 },
    { header: "Stock in hand", key: "stock", width: 10 },
    { header: "Minimum", key: "minProduction", width: 14 },
    { header: "MAKE THIS MONTH", key: "productionPlan", width: 14 },
    { header: "Order", key: "order", width: 10 },
    { header: "Source Role", key: "sourceRole", width: 24 },
    { header: "Unmapped Reason", key: "unmappedReason", width: 24 },
    { header: "Master Category", key: "masterCategory", width: 20 },
    { header: "Sub-category", key: "subCategory", width: 20 },
  ];
  const hasDataLimited = rows.some((row) => row.dataLimited);
  if (hasDataLimited) {
    columns.push(
      { header: "Data Status", key: "dataStatus", width: 18 },
      { header: "Data-Limited Reason", key: "dataLimitedReason", width: 36 },
    );
  }
  sheet.columns = columns;
  styleCompactHeader(sheet.getRow(1));
  sheet.getRow(1).alignment = { wrapText: true, vertical: "middle" };

  const totals = {
    avg3MoSale: 0, pendingOrder: 0, pendingLastMonth: 0,
    bufferReq: 0, stock: 0, minProduction: 0, productionPlan: 0, order: 0
  };

  for (const sourceRow of rows) {
    const productionPlan = compactPlanValue(sourceRow, value);

    let itemName = sourceRow.itemName ?? "";
    let masterCategory = "not in grouping master";
    let subCategory = "not in grouping master";

    const mapping = ITEM_MAPPING[sourceRow.itemCode];
    if (mapping) {
      if (!itemName && mapping.d) itemName = mapping.d;
      if (mapping.m) masterCategory = mapping.m;
      if (mapping.s) subCategory = mapping.s;
    }

    const row = sheet.addRow({
      itemCode: sourceRow.itemCode,
      colour: sourceRow.colour,
      itemName,
      avg3MoSale: sourceRow.avg3MoSale,
      pendingOrder: sourceRow.pendingCurrent,
      pendingLastMonth: sourceRow.pendingLastMonth,
      bufferReq: sourceRow.bufferReq,
      stock: sourceRow.stock,
      minProduction: Math.max(0, sourceRow.minProduction),
      productionPlan,
      order: sourceRow.orders,
      sourceRole: sourceRow.sourceRole ?? "",
      unmappedReason: sourceRow.unmappedReason ?? "",
      masterCategory,
      subCategory,
      dataStatus: sourceRow.dataLimited ? "DATA-LIMITED" : "",
      dataLimitedReason: sourceRow.dataLimitedReason ?? "",
    });

    row.eachCell((cell, columnNumber) => {
      cell.border = COMPACT_BORDER;
      if (typeof cell.value === "number") cell.numFmt = "#,##0";
    });

    row.getCell("productionPlan").fill = productionPlan > 0 ? GREEN_FILL : GREY_FILL;
    if (sourceRow.pendingLastMonth > 0) row.getCell("pendingLastMonth").fill = RED_FILL;
    if (sourceRow.orders > 0) row.getCell("order").fill = BLUE_FILL;

    totals.avg3MoSale += sourceRow.avg3MoSale;
    totals.pendingOrder += sourceRow.pendingCurrent;
    totals.pendingLastMonth += sourceRow.pendingLastMonth;
    totals.bufferReq += (sourceRow.bufferReq || 0);
    totals.stock += sourceRow.stock;
    totals.minProduction += Math.max(0, sourceRow.minProduction);
    totals.productionPlan += productionPlan;
    totals.order += sourceRow.orders;
  }

  const totalRow = sheet.addRow({
    itemCode: "TOTAL",
    avg3MoSale: totals.avg3MoSale,
    pendingOrder: totals.pendingOrder,
    pendingLastMonth: totals.pendingLastMonth,
    bufferReq: totals.bufferReq,
    stock: totals.stock,
    minProduction: totals.minProduction,
    productionPlan: totals.productionPlan,
    order: totals.order
  });

  totalRow.font = { bold: true, color: { argb: "FFB45F06" } };
  totalRow.eachCell((cell) => {
    cell.border = { top: { style: "medium" } };
    if (typeof cell.value === "number") cell.numFmt = "#,##0";
  });

  configureCompactSheet(sheet, sheet.rowCount, true, hasDataLimited ? "Q" : "O");
}

export function addRunTraceSheet(
  workbook: ExcelJS.Workbook,
  provenanceJson: Record<string, unknown> | null | undefined,
): void {
  const sheet = workbook.addWorksheet("RUN TRACE");
  sheet.addRow(["Temporary Plan run provenance"]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow(["Purpose", "Frozen source identities and effective-factor evidence captured when the run was created"]);
  sheet.addRow([]);
  sheet.addRow(["Field", "Value"]);
  sheet.getRow(4).font = { bold: true };

  const provenance = provenanceJson as PlanRunProvenance | null | undefined;
  if (!provenance) {
    sheet.addRow(["Status", "Legacy run — provenance was not captured when this run was created"]);
    sheet.getColumn(1).width = 28;
    sheet.getColumn(2).width = 72;
    return;
  }

  sheet.addRow(["Captured at", provenance.capturedAt]);
  sheet.addRow(["Roster source", provenance.roster.source]);
  sheet.addRow(["Roster workbook ID", provenance.roster.workbookId]);
  sheet.addRow(["Roster row count", provenance.roster.rowCount]);
  sheet.addRow(["Roster fallback reason", provenance.roster.fallbackReason]);
  sheet.addRow(["Sales-history workbook ID", provenance.salesHistory.workbookId]);
  sheet.addRow(["Sales-history workbook label", provenance.salesHistory.label]);

  sheet.addRow([]);
  sheet.addRow(["Upload role", "Source kind", "Upload ID", "Filename", "Row count", "Uploaded at", "Used for planning"]);
  sheet.getRow(sheet.rowCount).font = { bold: true };
  for (const [role, upload] of Object.entries(provenance.uploads)) {
    sheet.addRow([
      role,
      upload.sourceKind,
      upload.sourceUploadId,
      upload.sourceFilename,
      upload.rowCount,
      upload.uploadedAt,
      upload.usedForPlanning ? "Yes" : "No",
    ]);
  }

  sheet.addRow([]);
  sheet.addRow(["Category", "Effective multiplier", "Recorded factor", "Factor check"]);
  sheet.getRow(sheet.rowCount).font = { bold: true };
  for (const [category, factor] of Object.entries(provenance.factors)) {
    sheet.addRow([
      category,
      factor.effectiveMultiplier,
      factor.recordedMultiplier,
      factor.status,
    ]);
  }

  sheet.mergeCells("A1:G1");
  sheet.views = [{ state: "frozen", ySplit: 4 }];
  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 30;
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 42;
  sheet.getColumn(5).width = 14;
  sheet.getColumn(6).width = 24;
  sheet.getColumn(7).width = 18;
  for (let row = 1; row <= sheet.rowCount; row++) {
    for (const column of [2, 3]) sheet.getCell(row, column).numFmt = "0.00x";
  }
}


function addCompactSummarySheet(
  workbook: ExcelJS.Workbook,
  month: string,
  planType: "temporary" | "production",
  rows: FrozenPlanRow[],
  value: PrayagPlanValue,
  segmentLabel: string,
  runId?: number,
): void {
  const sheet = workbook.addWorksheet("Summary");
  sheet.columns = [
    { header: "Category", key: "category", width: 34 },
    { header: "Minimum", key: "minTotal", width: 24 },
    { header: "MAKE THIS MONTH", key: "maxTotal", width: 24 },
  ];

  const title = `${segmentLabel} ${planType === "temporary" ? "Temporary" : "Production"} Plan — ${month}${runId ? ' (Run ' + runId + ')' : ''}`;
  sheet.mergeCells("A1:C1");
  sheet.getCell("A1").value = title;
  sheet.getCell("A1").font = { bold: true, color: { argb: "FFFFFFFF" }, size: 14 };
  sheet.getCell("A1").fill = COMPACT_TITLE_FILL;
  sheet.getCell("A1").alignment = { horizontal: "left", vertical: "middle" };
  sheet.getRow(1).height = 28;

  sheet.getRow(2).values = ["Category", "Minimum", "MAKE THIS MONTH"];
  styleCompactHeader(sheet.getRow(2));

  const categories = new Map<string, FrozenPlanRow[]>();
  for (const row of rows) {
    let cat = row.category;
    if (segmentLabel === "Production") {
      const parts = cat.split(" ");
      if (parts[0] && ["CPVC", "UPVC", "SWR", "AGRI", "HDPE"].includes(parts[0])) {
        cat = parts[0];
      }
    }
    const categoryRows = categories.get(cat) ?? [];
    categoryRows.push(row);
    categories.set(cat, categoryRows);
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
      if (columnNumber > 1) cell.numFmt = "#,##0";
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
    if (columnNumber > 1) cell.numFmt = "#,##0";
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
    { header: "Color Swatches", key: "color", width: 16 },
    { header: "Meaning", key: "meaning", width: 58 },
    { header: "Column", key: "col", width: 25 },
    { header: "Meaning / Formula", key: "formula", width: 70 },
  ];
  styleCompactHeader(sheet.getRow(1));
  sheet.getRow(1).getCell(1).value = "";

  const rows: Array<[string, ExcelJS.Fill]> = [
    ["MAKE THIS MONTH > 0 (must produce this month)", GREEN_FILL],
    ["MAKE THIS MONTH = 0 (stock covers demand)", GREY_FILL],
    ["Already sold, undelivered > 0 (urgent backlog)", RED_FILL],
  ];

  const formulas = [
    { col: "MAKE THIS MONTH", formula: "Final production quantity required this month to meet buffer, pending orders, and minimums." },
    { col: "Minimum", formula: "Absolute minimum production forced by user." },
    { col: "Already sold, undelivered", formula: "Pending orders from the previous month." },
    { col: "Live orders", formula: "Current pending orders." },
    { col: "Stock in hand", formula: "Current inventory." },
    { col: "3-month average sale", formula: "Average monthly sales based on recent history." },
    { col: "Buffer target", formula: "Desired safety stock level." },
  ];

  const maxRows = Math.max(rows.length, formulas.length);
  for (let i = 0; i < maxRows; i++) {
    const r = sheet.addRow({});
    if (i < rows.length) {
      r.getCell(1).fill = rows[i][1];
      r.getCell(2).value = rows[i][0];
      r.getCell(2).border = COMPACT_BORDER;
    }
    if (i < formulas.length) {
      r.getCell(3).value = formulas[i].col;
      r.getCell(4).value = formulas[i].formula;
      r.getCell(3).border = COMPACT_BORDER;
      r.getCell(4).border = COMPACT_BORDER;
    }
  }

  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: "1:1"
  };
}

function exportCompactPlanWorkbook(
  workbook: ExcelJS.Workbook,
  month: string,
  planType: "temporary" | "production",
  rows: FrozenPlanRow[],
  segment?: string,
  runId?: number,
  capacityFittedPieces?: number | null,
): void {
  const value: PrayagPlanValue = planType === "temporary" ? "temporaryPlan" : "productionPlan";
  const segmentLabel = segment === "Plumbing" || segment === "PTMT"
    ? segment
    : rows.some((row) => COMPACT_CATEGORY_ORDER.includes(row.category))
      ? "PTMT"
      : "Production";

  addPlanAtAGlanceSheet(workbook, month, rows, value, segmentLabel, planType, runId, capacityFittedPieces);
  addByMasterGroupSheet(workbook, rows, value);
  addWhatNeedsAttentionSheet(workbook, rows, value);
  addHowToReadThisPlanSheet(workbook);

  addCompactSummarySheet(workbook, month, planType, rows, value, segmentLabel, runId);

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
  segment?: string,
  runId?: number,
  capacityFittedPieces?: number | null,
): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PTMT Production Planning";
  void multipliers;
  exportCompactPlanWorkbook(workbook, month, planType, rows, segment, runId, capacityFittedPieces);
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


// Dummy types to make TS compile in standalone script, we'll strip imports when appending.


export function addPlanAtAGlanceSheet(workbook: ExcelJS.Workbook, month: string, rows: FrozenPlanRow[], value: PrayagPlanValue, segmentLabel = "PTMT", planType = "Production", runId?: number, capacityFittedPieces?: number | null): void {
  const sheet = workbook.addWorksheet("Plan at a glance");
  sheet.columns = [
    { header: "", key: "empty", width: 4 },
    { header: "Metric", key: "metric", width: 40 },
    { header: "Value", key: "val", width: 20 },
  ];
  sheet.properties.showGridLines = false;

  const title = `${segmentLabel} ${planType === "temporary" ? "Temporary" : "Production"} Plan at a glance — ${month}${runId ? ' (Run ' + runId + ')' : ''}`;
  sheet.insertRow(1, [title]);
  sheet.getCell("A1").font = { bold: true, size: 14 };
  sheet.mergeCells("A1:C1");
  const itemsToMake = rows.filter(r => Math.max(0, r[value]) > 0).length;
  const totalItems = rows.length;
  const piecesToMake = rows.reduce((sum, r) => sum + Math.max(0, r[value]), 0);
  const minimumPieces = rows.reduce((sum, r) => sum + Math.max(0, r.minProduction), 0);
  const alreadySold = rows.reduce((sum, r) => sum + Math.max(0, r.pendingLastMonth), 0);

  sheet.addRow({ metric: "Items to make", val: `${itemsToMake} / ${totalItems}` });
  const piecesRow = sheet.addRow({ metric: "Pieces to make", val: piecesToMake });
  const fittedRows: ExcelJS.Row[] = [];
  if (planType === "temporary") {
    if (typeof capacityFittedPieces === "number") {
      fittedRows.push(sheet.addRow({ metric: "Capacity-fitted quantity", val: capacityFittedPieces }));
      fittedRows.push(sheet.addRow({ metric: "Capacity shortfall", val: Math.max(0, piecesToMake - capacityFittedPieces) }));
    } else {
      sheet.addRow({ metric: "Capacity-fitted quantity", val: "not yet fitted" });
    }
  }
  const minimumRow = sheet.addRow({ metric: "Minimum", val: minimumPieces });
  const soldRow = sheet.addRow({ metric: "Already sold, undelivered", val: alreadySold });

  let unmappedRows = 0;
  const unmappedCodes = new Set<string>();
  for (const r of rows) {
    const map = ITEM_MAPPING[r.itemCode];
    if (!map || !map.m || !map.s) {
      unmappedRows++;
      unmappedCodes.add(r.itemCode);
    }
  }
  const unmappedRow = sheet.addRow({
    metric: `Unmapped rows ${unmappedRows} (${unmappedCodes.size} distinct codes)`,
    val: unmappedRows,
  });

  for (const row of [piecesRow, ...fittedRows, minimumRow, soldRow, unmappedRow]) {
    row.font = { bold: true, size: 14 };
    row.getCell("val").numFmt = "#,##0";
  }

  sheet.addRow([]);

  const headerRow = sheet.addRow(["Category", "Products/items", "Pieces to make", "Minimum", "Already sold"]);
  styleCompactHeader(headerRow);

  const byCat = new Map<string, { items: number, pieces: number, min: number, sold: number }>();
  for (const r of rows) {
    if (!byCat.has(r.category)) byCat.set(r.category, { items: 0, pieces: 0, min: 0, sold: 0 });
    const c = byCat.get(r.category)!;
    c.items += 1;
    c.pieces += Math.max(0, r[value]);
    c.min += Math.max(0, r.minProduction);
    c.sold += Math.max(0, r.pendingLastMonth);
  }

  for (const [cat, data] of Array.from(byCat.entries()).sort((a, b) => b[1].pieces - a[1].pieces)) {
    const r = sheet.addRow([cat, data.items, data.pieces, data.min, data.sold]);
    r.eachCell((cell, colNum) => {
      cell.border = COMPACT_BORDER;
      if (colNum > 1) cell.numFmt = "#,##0";
    });
    if (data.pieces > 0) r.getCell(3).font = { bold: true };
    if (data.sold > 0) {
      r.getCell(5).font = { color: { argb: "FF9C0006" } };
    }
  }

  const totals = { items: 0, pieces: 0, min: 0, sold: 0 };
  byCat.forEach(data => {
    totals.items += data.items;
    totals.pieces += data.pieces;
    totals.min += data.min;
    totals.sold += data.sold;
  });

  const tRow = sheet.addRow(["TOTAL", totals.items, totals.pieces, totals.min, totals.sold]);
  tRow.font = { bold: true, color: { argb: "FFB45F06" } };
  tRow.eachCell((cell, colNum) => {
    cell.border = { top: { style: "medium", color: { argb: "FFB45F06" } } };
    if (colNum > 1) cell.numFmt = "#,##0";
  });

  sheet.getColumn(1).width = 30;
  sheet.getColumn(2).width = 20;
  sheet.getColumn(3).width = 20;
  sheet.getColumn(4).width = 20;
  sheet.getColumn(5).width = 20;

  sheet.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "7:7" };
}

export function addByMasterGroupSheet(workbook: ExcelJS.Workbook, rows: FrozenPlanRow[], value: PrayagPlanValue): void {
  const sheet = workbook.addWorksheet("By master group");
  sheet.columns = [
    { header: "Planning Category", key: "planCat", width: 25 },
    { header: "Master Category", key: "masterCat", width: 25 },
    { header: "Sub-category", key: "subCat", width: 25 },
    { header: "Plan Quantity", key: "qty", width: 15 },
  ];
  styleCompactHeader(sheet.getRow(1));

  const grouped = new Map<string, number>();
  const reverseGrouped = new Map<string, number>();

  for (const r of rows) {
    const map = ITEM_MAPPING[r.itemCode];
    const m = map?.m || "not in grouping master";
    const s = map?.s || "not in grouping master";

    const key = JSON.stringify([r.category, m, s]);
    grouped.set(key, (grouped.get(key) || 0) + Math.max(0, r[value]));

    const rKey = JSON.stringify([m, s, r.category]);
    reverseGrouped.set(rKey, (reverseGrouped.get(rKey) || 0) + Math.max(0, r[value]));
  }

  for (const [k, qty] of grouped.entries()) {
    const [c, m, s] = JSON.parse(k);
    const row = sheet.addRow({ planCat: c, masterCat: m, subCat: s, qty });
    row.getCell("qty").numFmt = "#,##0";
    row.eachCell(c => c.border = COMPACT_BORDER);
  }

  sheet.addRow([]);
  const revHeader = sheet.addRow({ planCat: "Master Category", masterCat: "Sub-category", subCat: "Planning Category", qty: "Plan Quantity" });
  styleCompactHeader(revHeader);

  for (const [k, qty] of reverseGrouped.entries()) {
    const [m, s, c] = JSON.parse(k);
    const row = sheet.addRow({ planCat: m, masterCat: s, subCat: c, qty });
    row.getCell("qty").numFmt = "#,##0";
    row.eachCell(c => c.border = COMPACT_BORDER);
  }

  sheet.properties.showGridLines = false;
  sheet.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" };
}

export function addWhatNeedsAttentionSheet(workbook: ExcelJS.Workbook, rows: FrozenPlanRow[], value: PrayagPlanValue): void {
  const sheet = workbook.addWorksheet("What needs attention");
  sheet.columns = [
    { header: "Item Code", key: "code", width: 16 },
    { header: "Colour", key: "colour", width: 14 },
    { header: "Item Name", key: "name", width: 30 },
    { header: "Category", key: "cat", width: 20 },
    { header: "Reason(s)", key: "reasons", width: 40 },
    { header: "Plan", key: "plan", width: 12 },
    { header: "Stock", key: "stock", width: 12 },
    { header: "Live Orders", key: "orders", width: 12 },
    { header: "Sold Undelivered", key: "sold", width: 16 },
  ];
  styleCompactHeader(sheet.getRow(1));

  type AttentionRow = FrozenPlanRow & { reasons: Set<string> };
  const attentionMap = new Map<string, AttentionRow>();

  const getRowKey = (r: FrozenPlanRow) => JSON.stringify([r.itemCode, r.colour, r.category]);

  const addReason = (r: FrozenPlanRow, reason: string) => {
    const k = getRowKey(r);
    if (!attentionMap.has(k)) {
      attentionMap.set(k, { ...r, reasons: new Set() });
    }
    attentionMap.get(k)!.reasons.add(reason);
  };

  for (const r of rows) {
    const planQty = Math.max(0, r[value]);
    if (r.pendingLastMonth > 0) addReason(r, "sold-undelivered");
    if (planQty > 0 && r.minProduction === planQty) addReason(r, "minimum=plan");
    if (r.stock === 0 && r.orders > 0) addReason(r, "zero-stock+live-orders");
  }

  const largest20 = [...rows].sort((a, b) => Math.max(0, b[value]) - Math.max(0, a[value])).slice(0, 20);
  for (const l of largest20) {
    if (Math.max(0, l[value]) > 0) addReason(l, "largest 20");
  }

  let finalRows = Array.from(attentionMap.values());
  const topRows: AttentionRow[] = [];
  const covered = new Set<string>();

  for (const group of ["sold-undelivered", "minimum=plan", "zero-stock+live-orders", "largest 20"]) {
    const rep = finalRows.find(r => r.reasons.has(group) && !topRows.includes(r));
    if (rep) {
      topRows.push(rep);
      covered.add(getRowKey(rep));
    }
  }

  for (const r of finalRows) {
    if (topRows.length >= 59) break;
    if (!covered.has(getRowKey(r))) {
      topRows.push(r);
    }
  }

  for (const r of topRows) {
    const map = ITEM_MAPPING[r.itemCode];
    const name = map?.d || r.itemName || "";
    const plan = Math.max(0, r[value]);
    const row = sheet.addRow({
      code: r.itemCode,
      colour: r.colour,
      name: name,
      cat: r.category,
      reasons: Array.from(r.reasons).join(", "),
      plan,
      stock: r.stock,
      orders: r.orders,
      sold: r.pendingLastMonth
    });
    ["plan", "stock", "orders", "sold"].forEach(c => {
      row.getCell(c).numFmt = "#,##0";
    });
    row.eachCell(c => c.border = COMPACT_BORDER);
  }

  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: `I${Math.max(1, sheet.rowCount)}` };
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" };
}

export function addHowToReadThisPlanSheet(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.addWorksheet("How to read this plan");
  sheet.columns = [
    { header: "Column", key: "col", width: 25 },
    { header: "Meaning / Formula", key: "meaning", width: 70 }
  ];
  styleCompactHeader(sheet.getRow(1));

  const formulas = [
    { col: "MAKE THIS MONTH", meaning: "Final production quantity required this month to meet buffer, pending orders, and minimums." },
    { col: "Minimum", meaning: "Absolute minimum production forced by user." },
    { col: "Already sold, undelivered", meaning: "Pending orders from the previous month." },
    { col: "Live orders", meaning: "Current pending orders." },
    { col: "Stock in hand", meaning: "Current inventory." },
    { col: "3-month average sale", meaning: "Average monthly sales based on recent history." },
    { col: "Buffer target", meaning: "Desired safety stock level." },
  ];

  for (const f of formulas) {
    const r = sheet.addRow(f);
    r.eachCell(c => c.border = COMPACT_BORDER);
  }

  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: "1:1" };
}

export async function exportFrozenPlanExcel(
  month: string,
  planType: "temporary" | "production",
  rows: FrozenPlanRow[],
  temporaryRows: FrozenPlanRow[] = [],
  multipliers: Record<string, number> = {},
  appendSheets?: ExcelWorkbookAppender,
  segment?: string,
  runId?: number,
  capacityFittedPieces?: number | null,
): Promise<Buffer> {
  void temporaryRows;
  return exportPrayagPlanExcel(month, planType, rows, multipliers, appendSheets, segment, runId, capacityFittedPieces);
}

export async function exportPlanExcel(
  month: string,
  items: CalcPlanItem[],
  summary: PlanSummaryResult,
  requiredCategories?: string[],
): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  addSummarySheet(workbook, month, summary, "PTMT", "production");

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
