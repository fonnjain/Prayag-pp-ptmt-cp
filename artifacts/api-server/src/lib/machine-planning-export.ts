import type ExcelJS from "exceljs";
import {
  addByMasterGroupSheet,
  addHowToReadThisPlanSheet,
  addWhatNeedsAttentionSheet,
  type FrozenPlanRow,
} from "./excel-export";
import type { MachinePlanningPayload } from "./machine-planning";

// BX.1/BX.2 are kept in a dedicated module, but re-exported here so callers
// of the machine-planning export surface do not need to know that split.
export {
  assertBxConservation,
  buildBxPayload,
  exportMachineFeasibleExcel,
  exportWeeklyReleaseBxExcel,
  BxExportInvariantError,
} from "./bx-exports";
export type { BxItem, BxPayload, BxClassification, BxReason } from "./bx-exports";

const WHOLE_NUMBER_FORMAT = "#,##0";
const RED = "FFFFC7CE";
const AMBER = "FFFFEB9C";

function header(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  row.alignment = { vertical: "middle", wrapText: true };
}
function setup(sheet: ExcelJS.Worksheet, split = 1, lastColumn?: string): void {
  sheet.views = [{ state: "frozen", ySplit: split }];
  sheet.properties.showGridLines = false;
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${split}:${split}` };
  if (lastColumn) sheet.autoFilter = { from: `A${split}`, to: `${lastColumn}${Math.max(split, sheet.rowCount)}` };
}
function wholeNumbers(sheet: ExcelJS.Worksheet): void {
  sheet.eachRow((row) => row.eachCell((cell) => {
    if (typeof cell.value === "number") cell.numFmt = WHOLE_NUMBER_FORMAT;
  }));
}
function addTitle(sheet: ExcelJS.Worksheet, payload: MachinePlanningPayload): void {
  sheet.addRow([`${payload.segment} Production — ${payload.month} — Run ${payload.runId ?? "—"}`]);
  sheet.getRow(1).font = { bold: true, size: 15 };
  sheet.mergeCells("A1:H1");
}

function addCoverageSection(sheet: ExcelJS.Worksheet, payload: MachinePlanningPayload): void {
  sheet.addRow(["Coverage"]);
  header(sheet.lastRow!);
  sheet.addRow(["Code", "Name", "Category", "Requested pieces", "Status", "Covered", "Reason"]);
  header(sheet.lastRow!);
  for (const row of payload.coverage) {
    sheet.addRow([row.code, row.name, row.category, row.requestedPieces, row.status, row.covered ? "Yes" : "No", row.reason]);
  }
  if (!payload.coverage.length) sheet.addRow(["No persisted coverage rows"]);
}

function addGlance(workbook: ExcelJS.Workbook, payload: MachinePlanningPayload): void {
  const sheet = workbook.addWorksheet("Plan at a glance");
  addTitle(sheet, payload);
  sheet.addRow(["Status", payload.draft ? "Draft" : payload.status]);
  sheet.addRow(["Source Temporary run", payload.sourceRunId]);
  sheet.addRow(["Scheduled pieces", payload.headline.scheduledPieces]);
  sheet.addRow(["Not scheduled pieces", payload.headline.notScheduledPieces]);
  sheet.addRow(["Products covered", payload.headline.productsCovered]);
  sheet.addRow(["Routing roster products", payload.headline.routingRosterProducts]);
  sheet.addRow(["Without routing", payload.headline.withoutRouting]);
  sheet.addRow(["Without routing pieces", payload.headline.withoutRoutingPieces]);
  sheet.addRow(["Moulding machines used / total", `${payload.headline.mouldingMachinesUsed} / ${payload.headline.mouldingMachinesTotal}`]);
  sheet.addRow(["Pipe machines used", payload.headline.pipeMachinesUsed]);
  sheet.addRow([]);
  addCoverageSection(sheet, payload);
  sheet.columns.forEach((column) => { column.width = 20; });
  sheet.getColumn(2).width = 30;
  setup(sheet, 1);
  wholeNumbers(sheet);
}

function addMachineLoad(workbook: ExcelJS.Workbook, payload: MachinePlanningPayload): void {
  const sheet = workbook.addWorksheet("Machine load by week");
  addTitle(sheet, payload);
  sheet.addRow(["Machine", "Pool", "Materials", "W1 available", "W1 used", "W1 utilization", "W1 idle", "W2 available", "W2 used", "W2 utilization", "W2 idle", "W3 available", "W3 used", "W3 utilization", "W3 idle", "W4 available", "W4 used", "W4 utilization", "W4 idle", "Month available", "Month used", "Month utilization", "Month idle"]);
  header(sheet.lastRow!);
  for (const machine of payload.machines) {
    const weeks = [1, 2, 3, 4].map((week) => machine.weeks.find((entry) => entry.week === week)!);
    const values: Array<string | number> = [machine.machine, machine.pool, machine.materials];
    for (const week of weeks) values.push(week.available, week.used, week.utilization, week.idle);
    values.push(machine.month.available, machine.month.used, machine.month.utilization, machine.month.idle);
    const row = sheet.addRow(values);
    for (const column of [6, 10, 14, 18, 22]) {
      const cell = row.getCell(column);
      const value = Number(cell.value ?? 0);
      if (value >= 100) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED } };
      else if (value > 90) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AMBER } };
    }
  }
  const total = sheet.addRow(["TOTAL", "", "", ...Array(20).fill(0)]);
  for (let column = 4; column <= 23; column += 1) {
    total.getCell(column).value = payload.machines.reduce((value, machine) => {
      if (column >= 20) {
        const metric = column - 20;
        if (metric === 0) return value + machine.month.available;
        if (metric === 1) return value + machine.month.used;
        if (metric === 3) return value + machine.month.idle;
        return value;
      }
      const offset = (column - 4) % 4;
      const week = Math.floor((column - 4) / 4);
      if (offset === 0) return value + (machine.weeks[week]?.available ?? 0);
      if (offset === 1) return value + (machine.weeks[week]?.used ?? 0);
      if (offset === 3) return value + (machine.weeks[week]?.idle ?? 0);
      return value;
    }, 0);
  }
  for (const [availableColumn, usedColumn, utilizationColumn] of [[4, 5, 6], [8, 9, 10], [12, 13, 14], [16, 17, 18], [20, 21, 22]]) {
    const available = Number(total.getCell(availableColumn!).value ?? 0);
    const used = Number(total.getCell(usedColumn!).value ?? 0);
    total.getCell(utilizationColumn!).value = available > 0 ? used / available * 100 : 0;
  }
  total.font = { bold: true };
  setup(sheet, 2, "W");
  wholeNumbers(sheet);
}

function addAllocations(workbook: ExcelJS.Workbook, payload: MachinePlanningPayload): void {
  const sheet = workbook.addWorksheet("Allocations by machine");
  addTitle(sheet, payload);
  sheet.addRow(["Code", "Name", "Category", "Machine", "Pool", "Week", "Net pieces", "Gross pieces", "Kg", "Hours", "Route method", "Fallback"]);
  header(sheet.lastRow!);
  for (const row of payload.allocations) {
    sheet.addRow([row.code, row.name, row.category, row.machine, row.pool, row.week, row.netPieces, row.grossPieces, row.kg, row.hours, row.isFallback ? `${row.routeMethod} — estimated, not plant-approved` : row.routeMethod, row.isFallback ? "Yes" : "No"]);
  }
  const total = sheet.addRow(["TOTAL", "", "", "", "", "", payload.allocations.reduce((sum, row) => sum + row.netPieces, 0), payload.allocations.reduce((sum, row) => sum + (row.grossPieces ?? 0), 0), payload.allocations.reduce((sum, row) => sum + (row.kg ?? 0), 0), payload.allocations.reduce((sum, row) => sum + row.hours, 0)]);
  total.font = { bold: true };
  setup(sheet, 2, "L");
  wholeNumbers(sheet);
}

function addNotScheduled(workbook: ExcelJS.Workbook, payload: MachinePlanningPayload): void {
  const sheet = workbook.addWorksheet("Not scheduled");
  addTitle(sheet, payload);
  sheet.addRow(["Code", "Name", "Category", "Net pieces", "Gross pieces", "Kg", "Reason"]);
  header(sheet.lastRow!);
  for (const row of payload.unscheduled) sheet.addRow([row.code, row.name, row.category, row.pieces, row.grossPieces, row.kg, row.reason]);
  const total = sheet.addRow(["TOTAL", "", "", payload.unscheduled.reduce((sum, row) => sum + row.pieces, 0), payload.unscheduled.reduce((sum, row) => sum + (row.grossPieces ?? 0), 0), payload.unscheduled.reduce((sum, row) => sum + (row.kg ?? 0), 0)]);
  total.font = { bold: true };
  setup(sheet, 2, "G");
  wholeNumbers(sheet);
}

function addCoverage(workbook: ExcelJS.Workbook, payload: MachinePlanningPayload): void {
  const sheet = workbook.addWorksheet("Coverage");
  addTitle(sheet, payload);
  sheet.addRow(["Code", "Name", "Category", "Requested pieces", "Status", "Route method", "Covered", "Reason"]);
  header(sheet.lastRow!);
  for (const row of payload.coverage) sheet.addRow([row.code, row.name, row.category, row.requestedPieces, row.status, row.routeMethod, row.covered ? "Yes" : "No", row.reason]);
  setup(sheet, 2, "H");
  wholeNumbers(sheet);
}

function addHowToRead(workbook: ExcelJS.Workbook, payload: MachinePlanningPayload): void {
  const sheet = workbook.addWorksheet("How to read this plan");
  sheet.addRow(["How to read this machine plan"]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow(["Net pieces", "Capacity-fitted planning quantity."]);
  sheet.addRow(["Gross pieces", "Persisted machine-app gross quantity; never substitute it for net pieces."]);
  sheet.addRow(["Fallback", "Estimated, not plant-approved."]);
  sheet.addRow(["Idle", "Available machine hours not used by the persisted run."]);
  sheet.addRow(["Utilization", "Used divided by available; red is >=100%, amber is >90%."]);
  sheet.addRow(["Concentration", "Overlap warnings mean machine/product rows are not summable."]);
  sheet.addRow(["Run", `Stored production run ${payload.runId ?? "—"}; no recalculation was performed.`]);
  sheet.addRow([]);
  sheet.addRow(["Concentration by machine", "Pool", "Products", "Net pieces", "Single-machine count", "Overlap warning"]);
  header(sheet.lastRow!);
  for (const row of payload.concentration) {
    sheet.addRow([row.machine, row.pool, row.products, row.pieces, row.singleMachineCount, row.overlapWarning]);
  }
  sheet.columns = [{ width: 30 }, { width: 100 }, { width: 14 }, { width: 16 }, { width: 20 }, { width: 70 }];
  setup(sheet, 1);
}

function addTrace(workbook: ExcelJS.Workbook, payload: MachinePlanningPayload): void {
  const sheet = workbook.addWorksheet("RUN TRACE");
  sheet.addRow(["Field", "Value"]);
  header(sheet.lastRow!);
  for (const [key, value] of Object.entries(payload.trace)) {
    sheet.addRow([key, value && typeof value === "object" ? JSON.stringify(value) : value as string | number | null]);
  }
  sheet.addRow(["generatedAt", payload.generatedAt]);
  sheet.addRow(["status", payload.status]);
  sheet.addRow(["draft", payload.draft ? "Yes" : "No"]);
  sheet.addRow(["superseded", payload.superseded ? `Yes — ${payload.supersedingId ?? "unknown"}` : "No"]);
  sheet.columns = [{ width: 30 }, { width: 90 }];
  setup(sheet, 1);
}

function addConcentration(workbook: ExcelJS.Workbook, payload: MachinePlanningPayload): void {
  const sheet = workbook.addWorksheet("Concentration");
  sheet.addRow(["Machine", "Pool", "Products", "Net pieces", "Single-machine count", "Overlap warning"]);
  header(sheet.lastRow!);
  for (const row of payload.concentration) sheet.addRow([row.machine, row.pool, row.products, row.pieces, row.singleMachineCount, row.overlapWarning]);
  setup(sheet, 1, "F");
  wholeNumbers(sheet);
}

export async function exportMachineWiseExcel(payload: MachinePlanningPayload): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Production Planning";
  addGlance(workbook, payload);
  addMachineLoad(workbook, payload);
  addAllocations(workbook, payload);
  addNotScheduled(workbook, payload);
  addCoverage(workbook, payload);
  addHowToRead(workbook, payload);
  addTrace(workbook, payload);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function planningRows(payload: MachinePlanningPayload): FrozenPlanRow[] {
  if (payload.planningRows.length > 0) return payload.planningRows;
  const rows = new Map<string, FrozenPlanRow>();
  for (const allocation of payload.allocations) {
    const key = `${allocation.code}::${allocation.category}`;
    const row = rows.get(key) ?? {
      itemCode: allocation.code, colour: "", category: allocation.category, itemName: allocation.name,
      avg3MoSale: 0, stock: 0, pendingCurrent: 0, pendingLastMonth: 0, bufferReq: null,
      minProduction: 0, productionPlan: 0, temporaryPlan: 0, cannotBeMade: 0, dummy: 0, orders: 0, buffer: 0,
      material: null, totalKg: null, urgencyRank: null, releaseWeek: null, w1: 0, w2: 0, w3: 0, w4: 0,
    };
    row.productionPlan += allocation.netPieces;
    row.temporaryPlan += allocation.netPieces;
    if (allocation.week && allocation.week >= 1 && allocation.week <= 4) row[`w${allocation.week}` as "w1" | "w2" | "w3" | "w4"] += allocation.netPieces;
    rows.set(key, row);
  }
  return [...rows.values()];
}

/**
 * Keeps the manager-facing frozen plan tabs while making the quantity basis
 * explicit. No source value is rounded; number formats only affect display.
 */
export async function exportPlanningFormatExcel(payload: MachinePlanningPayload): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Production Planning";
  addGlance(workbook, payload);
  addCoverage(workbook, payload);
  const rows = planningRows(payload);
  if (rows.length) {
    addByMasterGroupSheet(workbook, rows, "productionPlan");
    addWhatNeedsAttentionSheet(workbook, rows, "productionPlan");
  } else {
    const sheet = workbook.addWorksheet("Production Plan");
    sheet.addRow(["No persisted allocations"]);
  }
  addHowToReadThisPlanSheet(workbook);
  const basis = workbook.addWorksheet("Quantity basis");
  basis.addRow(["Code", "Category", "Submitted net", "Scheduled net", "Scheduled gross", "Uplift"]);
  header(basis.lastRow!);
  const basisRows = new Map<string, {
    code: string; category: string; submitted: number; scheduled: number; gross: number | null;
  }>();
  for (const row of payload.planningRows) {
    const key = `${row.itemCode}::${row.category}`;
    const current = basisRows.get(key) ?? { code: row.itemCode, category: row.category, submitted: 0, scheduled: 0, gross: 0 };
    current.submitted += Math.max(0, row.temporaryPlan);
    basisRows.set(key, current);
  }
  for (const row of payload.allocations) {
    const key = `${row.code}::${row.category}`;
    const current = basisRows.get(key) ?? { code: row.code, category: row.category, submitted: 0, scheduled: 0, gross: 0 };
    current.scheduled += row.netPieces;
    current.gross = current.gross === null || row.grossPieces === null ? null : current.gross + row.grossPieces;
    basisRows.set(key, current);
  }
  for (const row of basisRows.values()) {
    basis.addRow([row.code, row.category, row.submitted, row.scheduled, row.gross, row.gross === null ? null : row.gross - row.scheduled]);
  }
  setup(basis, 1, "F");
  wholeNumbers(basis);
  addTrace(workbook, payload);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}