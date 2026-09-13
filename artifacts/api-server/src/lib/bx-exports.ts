import type ExcelJS from "exceljs";
import type { FrozenPlanRow } from "./excel-export";
import type { MachinePlanningAllocation, MachinePlanningPayload } from "./machine-planning";

/**
 * BX is deliberately an export-only projection.  It consumes the stored
 * machine-planning payload and never calls the scheduler or rebuilds a plan.
 */
export type BxClassification =
  | "MACHINE SCHEDULED"
  | "PART SCHEDULED"
  | "NOT SCHEDULED — assumed"
  | "NOT SENT — assumed";

export type BxReason =
  | "unfinished due to capacity"
  | "material unknown"
  | "data limited"
  | "allocation shortfall";

export type BxItem = {
  itemCode: string;
  itemName: string;
  category: string;
  material: string;
  demand: number;
  machineScheduled: number;
  assumed: number;
  status: BxClassification;
  reason: BxReason | null;
  machine: string;
  scheduledWeek: number | null;
  machineWeeks: [number, number, number, number];
  assumedWeeks: [number, number, number, number];
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  alreadySold: number;
  liveOrders: number;
};

export type BxPayload = {
  source: MachinePlanningPayload;
  temporaryRunId: number | null;
  productionRunId: number;
  month: string;
  segment: string;
  calendar: string;
  items: BxItem[];
  totals: {
    demand: number;
    machineScheduled: number;
    assumed: number;
    w1: number;
    w2: number;
    w3: number;
    w4: number;
    reasons: Record<BxReason, number>;
    reasonRows: Record<BxReason, number>;
  };
};

export class BxExportInvariantError extends Error {
  readonly code = "BX_EXPORT_CONSERVATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "BxExportInvariantError";
  }
}

const WEEK_DAYS = [7, 6, 6, 8] as const;
const TOLERANCE = 1e-7;
const REASONS: readonly BxReason[] = [
  "unfinished due to capacity",
  "material unknown",
  "data limited",
  "allocation shortfall",
];

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

function positive(value: unknown): number {
  const result = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(result) ? Math.max(0, result) : 0;
}

function closeEnough(left: number, right: number): boolean {
  return Math.abs(left - right) <= TOLERANCE;
}

function allocationCode(allocation: MachinePlanningAllocation): string {
  return allocation.code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function rowCode(row: FrozenPlanRow): string {
  return row.itemCode.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function allocationMatches(allocation: MachinePlanningAllocation, row: FrozenPlanRow): boolean {
  if (allocationCode(allocation) !== rowCode(row)) return false;
  // Category is part of the source-row identity when it is available. Older
  // stored scheduler rows can omit it, so retain the code-only fallback.
  return !allocation.category || !row.category || allocation.category === row.category;
}

function demandFor(row: FrozenPlanRow): number {
  // TemporaryPlan is the submitted demand basis. The fallbacks support older
  // frozen rows without changing the value of newer evidence.
  const candidates = [row.temporaryPlan, row.demandPlan, row.productionPlan];
  const selected = candidates.find((value) => typeof value === "number" && value > 0);
  // The fit summary rounds each frozen row at the scheduler boundary. Reuse
  // that same demand basis so export totals reconcile to the persisted summary.
  return Math.max(0, Math.round(positive(selected ?? 0)));
}

function reasonFor(
  row: FrozenPlanRow,
  machineScheduled: number,
  demand: number,
  sent: boolean,
  unfinished: number,
): BxReason | null {
  if (machineScheduled >= demand - TOLERANCE) return null;
  if (/MATERIAL_UNKNOWN/i.test(clean(row.dataLimitedReason))) return "material unknown";
  if (unfinished > TOLERANCE) return "unfinished due to capacity";
  if (!clean(row.material)) return "material unknown";
  if (
    clean(row.sourceRole).toLowerCase() === "unclassified"
    || clean(row.category).toLowerCase() === "unclassified"
  ) return "allocation shortfall";
  if (
    row.dataLimited
    || /missing|limited|unknown|unmapped/i.test(clean(row.unmappedReason))
  ) return "data limited";
  if (sent) return "allocation shortfall";
  return "data limited";
}

function assumedPlacement(
  assumed: number,
  alreadySold: number,
  liveOrders: number,
): [number, number, number, number] {
  if (assumed <= TOLERANCE) return [0, 0, 0, 0];
  const inW1 = Math.min(assumed, alreadySold + liveOrders);
  const remainder = assumed - inW1;
  const weightTotal = WEEK_DAYS.reduce((sum, value) => sum + value, 0);
  const w1 = inW1 + remainder * WEEK_DAYS[0] / weightTotal;
  const w2 = remainder * WEEK_DAYS[1] / weightTotal;
  const w3 = remainder * WEEK_DAYS[2] / weightTotal;
  // Calculate W4 as a balance, avoiding a floating point residue in the
  // exact weekly conservation assertion.
  const w4 = assumed - w1 - w2 - w3;
  return [w1, w2, w3, w4];
}

function storedPlacement(
  allocations: MachinePlanningAllocation[],
  machineScheduled: number,
  rawScheduled: number,
): { weeks: [number, number, number, number]; machine: string; week: number | null } {
  if (machineScheduled <= TOLERANCE) return { weeks: [0, 0, 0, 0], machine: "", week: null };
  const weeks: [number, number, number, number] = [0, 0, 0, 0];
  const scale = rawScheduled > 0 ? machineScheduled / rawScheduled : 0;
  for (const allocation of allocations) {
    if (allocation.week == null || allocation.week < 1 || allocation.week > 4) {
      throw new BxExportInvariantError(
        `Stored allocation for ${allocation.code} has no persisted week/day placement.`,
      );
    }
    weeks[allocation.week - 1] += allocation.netPieces * scale;
  }
  // The balance keeps the stored placement while eliminating harmless binary
  // floating point drift from sums of fractional allocations.
  const balanceIndex = allocations.reduce((last, allocation) => (
    allocation.week != null && allocation.week >= 1 && allocation.week <= 4
      ? allocation.week - 1
      : last
  ), 0);
  weeks[balanceIndex] += machineScheduled - weeks.reduce((sum, value) => sum + value, 0);
  const machines = [...new Set(allocations.map((allocation) => allocation.machine).filter(Boolean))];
  const distinctWeeks = new Set(allocations.map((allocation) => allocation.week));
  return {
    weeks,
    machine: machines.join(", "),
    week: distinctWeeks.size === 1 ? allocations[0]?.week ?? null : null,
  };
}

function sourceSent(payload: MachinePlanningPayload, row: FrozenPlanRow, allocations: MachinePlanningAllocation[]): boolean {
  const codes = new Set((payload.schedulerSentCodes ?? []).map((value) => value.toUpperCase()));
  if (payload.schedulerSentCodes !== undefined) {
    return allocations.length > 0 || codes.has(rowCode(row));
  }
  const persistedUnscheduled = payload.unscheduled.some((item) => (
    item.code.toUpperCase().replace(/[^A-Z0-9]/g, "") === rowCode(row)
  ));
  return allocations.length > 0 || persistedUnscheduled || codes.has(rowCode(row));
}

export function buildBxPayload(payload: MachinePlanningPayload): BxPayload {
  if (!payload.available || payload.runId == null) {
    throw new BxExportInvariantError(payload.reason ?? "Stored machine-planning evidence is unavailable.");
  }
  const rows = payload.planningRows;
  const unfinishedByCode = {
    ...Object.fromEntries(payload.unscheduled
      .filter((item) => /unfinished/i.test(item.reason))
      .map((item) => [item.code.toUpperCase().replace(/[^A-Z0-9]/g, ""), item.pieces])),
    ...(payload.unfinishedByCode ?? {}),
  };
  const items: BxItem[] = rows.map((row) => {
    const demand = demandFor(row);
    const matching = payload.allocations.filter((allocation) => allocationMatches(allocation, row));
    const rawScheduled = matching.reduce((sum, allocation) => sum + positive(allocation.netPieces), 0);
    // Solvents are explicit executable passthrough rows in the fit summary;
    // they do not consume a pipe or fitting machine allocation.
    const solventPassthrough = row.category.endsWith("Solvent");
    const machineScheduled = solventPassthrough ? demand : Math.min(demand, rawScheduled);
    const assumed = demand - machineScheduled;
    const sent = sourceSent(payload, row, matching);
    const stored = solventPassthrough
      ? { weeks: [0, 0, 0, 0] as [number, number, number, number], machine: "Direct solvent passthrough", week: null }
      : storedPlacement(matching, machineScheduled, rawScheduled);
    if (solventPassthrough && demand > 0) {
      stored.weeks[3] = demand;
    }
    const alreadySold = positive(row.pendingLastMonth);
    const liveOrders = positive(row.pendingCurrent);
    const assumedWeeks = assumedPlacement(assumed, alreadySold, liveOrders);
    const weeks: [number, number, number, number] = [
      stored.weeks[0] + assumedWeeks[0],
      stored.weeks[1] + assumedWeeks[1],
      stored.weeks[2] + assumedWeeks[2],
      stored.weeks[3] + assumedWeeks[3],
    ];
    const status: BxClassification = machineScheduled >= demand - TOLERANCE
      ? "MACHINE SCHEDULED"
      : machineScheduled > TOLERANCE
        ? "PART SCHEDULED"
        : sent ? "NOT SCHEDULED — assumed" : "NOT SENT — assumed";
    const reason = reasonFor(
      row,
      machineScheduled,
      demand,
      sent,
      positive(unfinishedByCode[rowCode(row)]),
    );
    return {
      itemCode: row.itemCode,
      itemName: row.itemName ?? "",
      category: row.category,
      material: row.material ?? "",
      demand,
      machineScheduled,
      assumed,
      status,
      reason,
      machine: stored.machine,
      scheduledWeek: stored.week,
      machineWeeks: stored.weeks,
      assumedWeeks,
      w1: weeks[0],
      w2: weeks[1],
      w3: weeks[2],
      w4: weeks[3],
      alreadySold,
      liveOrders,
    };
  });
  assertBxConservation(items);
  const reasons = Object.fromEntries(REASONS.map((reason) => [
    reason,
    items.filter((item) => item.reason === reason).reduce((sum, item) => sum + item.assumed, 0),
  ])) as Record<BxReason, number>;
  const inferredReasonRows = Object.fromEntries(REASONS.map((reason) => [
    reason,
    items.filter((item) => item.reason === reason && item.assumed > TOLERANCE).length,
  ])) as Record<BxReason, number>;
  const reasonRows: Record<BxReason, number> = {
    "unfinished due to capacity": payload.fitReasonCounts?.unfinished ?? inferredReasonRows["unfinished due to capacity"],
    "material unknown": payload.fitReasonCounts?.materialUnknown ?? inferredReasonRows["material unknown"],
    "data limited": payload.fitReasonCounts?.dataLimited ?? inferredReasonRows["data limited"],
    "allocation shortfall": payload.fitReasonCounts?.allocationShortfall ?? inferredReasonRows["allocation shortfall"],
  };
  return {
    source: payload,
    temporaryRunId: payload.sourceRunId,
    productionRunId: payload.runId,
    month: payload.month,
    segment: payload.segment,
    calendar: payload.month === "2026-09" && payload.segment === "Plumbing"
      ? "September 2026 Plumbing [7,6,6,8] working days"
      : `Stored working-day calendar for ${payload.segment} ${payload.month}`,
    items,
    totals: {
      demand: items.reduce((sum, item) => sum + item.demand, 0),
      machineScheduled: items.reduce((sum, item) => sum + item.machineScheduled, 0),
      assumed: items.reduce((sum, item) => sum + item.assumed, 0),
      w1: items.reduce((sum, item) => sum + item.w1, 0),
      w2: items.reduce((sum, item) => sum + item.w2, 0),
      w3: items.reduce((sum, item) => sum + item.w3, 0),
      w4: items.reduce((sum, item) => sum + item.w4, 0),
      reasons,
      reasonRows,
    },
  };
}

export const buildMachineFeasiblePayload = buildBxPayload;
export const buildWeeklyReleasePayload = buildBxPayload;

export function assertBxConservation(items: BxItem[]): void {
  let demand = 0;
  let machineScheduled = 0;
  let assumed = 0;
  let weekly = 0;
  for (const item of items) {
    const itemWeekly = item.w1 + item.w2 + item.w3 + item.w4;
    if (!closeEnough(item.machineScheduled + item.assumed, item.demand)) {
      throw new BxExportInvariantError(
        `Per-item conservation failed for ${item.itemCode}: ` +
        `machine=${item.machineScheduled}, assumed=${item.assumed}, demand=${item.demand}.`,
      );
    }
    if (!closeEnough(itemWeekly, item.demand)) {
      throw new BxExportInvariantError(
        `Weekly conservation failed for ${item.itemCode}: weekly=${itemWeekly}, demand=${item.demand}.`,
      );
    }
    demand += item.demand;
    machineScheduled += item.machineScheduled;
    assumed += item.assumed;
    weekly += itemWeekly;
  }
  if (!closeEnough(machineScheduled + assumed, demand) || !closeEnough(weekly, demand)) {
    throw new BxExportInvariantError(
      `Total conservation failed: machine=${machineScheduled}, assumed=${assumed}, ` +
      `weekly=${weekly}, demand=${demand}.`,
    );
  }
}

const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" },
};
const ASSUMPTION_FILL: ExcelJS.Fill = {
  type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" },
};
const PART_FILL: ExcelJS.Fill = {
  type: "pattern", pattern: "solid", fgColor: { argb: "FFFCE4D6" },
};
const NUMBER_FORMAT = "#,##0.###";

function setup(sheet: ExcelJS.Worksheet, lastColumn: string): void {
  sheet.properties.showGridLines = false;
  sheet.views = [{ state: "frozen", xSplit: 1, ySplit: 5, showGridLines: false }];
  sheet.pageSetup = {
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: "6:6",
  };
  sheet.autoFilter = { from: "B6", to: `${lastColumn}${Math.max(6, sheet.rowCount)}` };
}

function title(sheet: ExcelJS.Worksheet, text: string, subtitle: string): void {
  sheet.getCell("B1").value = text;
  sheet.getCell("B1").font = { bold: true, size: 15 };
  sheet.mergeCells("B1:J1");
  sheet.getCell("B2").value = subtitle;
  sheet.mergeCells("B2:J2");
  sheet.getCell("B2").font = { italic: true, color: { argb: "FF666666" } };
}

function headers(sheet: ExcelJS.Worksheet, values: string[]): void {
  const row = sheet.getRow(6);
  row.values = ["", ...values];
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { wrapText: true, vertical: "middle" };
}

function formatNumbers(row: ExcelJS.Row, columns: number[]): void {
  for (const column of columns) row.getCell(column).numFmt = NUMBER_FORMAT;
}

function addPlanAtAGlance(workbook: ExcelJS.Workbook, bx: BxPayload): void {
  const sheet = workbook.addWorksheet("Plan at a glance");
  title(sheet, `${bx.segment} Machine Feasible Plan — ${bx.month}`, `Temporary run ${bx.temporaryRunId ?? "—"} → Production run ${bx.productionRunId} · ${bx.calendar}`);
  headers(sheet, ["Metric", "Value", "Notes"]);
  const scheduledPct = bx.totals.demand > 0 ? bx.totals.machineScheduled / bx.totals.demand : 0;
  const assumedPct = bx.totals.demand > 0 ? bx.totals.assumed / bx.totals.demand : 0;
  const metrics: Array<[string, string | number, string]> = [
    ["Demand", bx.totals.demand, "Temporary run demand basis"],
    ["Machine scheduled", bx.totals.machineScheduled, `${(scheduledPct * 100).toFixed(1)}% · stored machine-app allocation`],
    ["ASSUMED feasible", bx.totals.assumed, `${(assumedPct * 100).toFixed(1)}% · down from 17.4% before the standards correction`],
    ["Items in plan", bx.items.filter((item) => item.demand > 0).length, "Every item is classified below"],
  ];
  for (const metric of metrics) {
    const row = sheet.addRow(["", ...metric]);
    row.getCell(2).font = { bold: true };
    if (typeof metric[1] === "number") row.getCell(3).numFmt = NUMBER_FORMAT;
    if (metric[0] === "ASSUMED feasible") row.getCell(2).fill = ASSUMPTION_FILL;
  }
  sheet.addRow([]);
  sheet.addRow(["", "Where each piece comes from", "Pieces", "Share"]);
  sheet.lastRow!.font = { bold: true };
  const classifications: BxClassification[] = [
    "MACHINE SCHEDULED", "PART SCHEDULED", "NOT SCHEDULED — assumed", "NOT SENT — assumed",
  ];
  for (const classification of classifications) {
    const pieces = bx.items
      .filter((item) => item.status === classification)
      .reduce((sum, item) => sum + item.demand, 0);
    const row = sheet.addRow(["", classification, pieces, bx.totals.demand > 0 ? pieces / bx.totals.demand : 0]);
    row.getCell(3).numFmt = NUMBER_FORMAT;
    row.getCell(4).numFmt = "0.0%";
    if (classification.includes("assumed")) row.getCell(2).fill = ASSUMPTION_FILL;
  }
  sheet.addRow([]);
  sheet.addRow(["", "Reason", "Fit-summary rows", "Assumed pieces"]);
  sheet.lastRow!.font = { bold: true };
  for (const reason of REASONS) {
    const row = sheet.addRow(["", reason, bx.totals.reasonRows[reason], bx.totals.reasons[reason]]);
    row.getCell(2).fill = ASSUMPTION_FILL;
    row.getCell(3).numFmt = "#,##0";
    row.getCell(4).numFmt = NUMBER_FORMAT;
  }
  sheet.addRow([]);
  sheet.addRow(["", "Product group", "Machine scheduled", "Assumed"]);
  sheet.lastRow!.font = { bold: true };
  const groups = [...new Set(bx.items.map((item) => item.category))].sort();
  for (const group of groups) {
    const groupItems = bx.items.filter((item) => item.category === group);
    const row = sheet.addRow([
      "", group,
      groupItems.reduce((sum, item) => sum + item.machineScheduled, 0),
      groupItems.reduce((sum, item) => sum + item.assumed, 0),
    ]);
    row.getCell(3).numFmt = NUMBER_FORMAT;
    row.getCell(4).numFmt = NUMBER_FORMAT;
  }
  sheet.getColumn(1).width = 3;
  sheet.getColumn(2).width = 34;
  sheet.getColumn(3).width = 22;
  sheet.getColumn(4).width = 65;
  setup(sheet, "D");
}

function addItemPlan(workbook: ExcelJS.Workbook, bx: BxPayload): void {
  const sheet = workbook.addWorksheet("Item plan");
  title(sheet, `${bx.segment} item plan`, `Stored machine placement plus explicit assumption · ${bx.calendar}`);
  headers(sheet, [
    "Item code", "Item name", "Category", "Material", "Demand",
    "Machine scheduled", "Assumed", "Classification", "Reason", "Machine", "Stored week",
  ]);
  for (const item of bx.items) {
    const row = sheet.addRow([
      "", item.itemCode, item.itemName, item.category, item.material, item.demand,
      item.machineScheduled, item.assumed, item.status, item.reason ?? "",
      item.machine, item.scheduledWeek == null ? "" : `W${item.scheduledWeek}`,
    ]);
    if (item.status.includes("assumed")) row.fill = ASSUMPTION_FILL;
    else if (item.status === "PART SCHEDULED") row.fill = PART_FILL;
    formatNumbers(row, [6, 7, 8]);
  }
  const total = sheet.addRow([
    "", "TOTAL", "", "", "", bx.totals.demand, bx.totals.machineScheduled,
    bx.totals.assumed, "", "", "", "",
  ]);
  total.font = { bold: true };
  formatNumbers(total, [6, 7, 8]);
  const widths = [3, 16, 32, 24, 16, 14, 17, 13, 26, 32, 18, 18, 14];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  setup(sheet, "L");
}

function addAssumedFeasible(workbook: ExcelJS.Workbook, bx: BxPayload): void {
  const sheet = workbook.addWorksheet("Assumed feasible");
  title(sheet, `${bx.segment} assumed feasible portion`, "This is an explicit operational assumption, not a plant-app result.");
  headers(sheet, [
    "Item code", "Item name", "Category", "Demand", "Machine scheduled",
    "Assumed feasible", "Classification", "Reason", "Already sold", "Live orders",
    "Assumed W1", "Assumed W2", "Assumed W3", "Assumed W4",
  ]);
  for (const item of bx.items.filter((item) => item.assumed > TOLERANCE)) {
    const row = sheet.addRow([
      "", item.itemCode, item.itemName, item.category, item.demand, item.machineScheduled,
      item.assumed, item.status, item.reason ?? "", item.alreadySold, item.liveOrders,
      ...item.assumedWeeks,
    ]);
    row.fill = ASSUMPTION_FILL;
    formatNumbers(row, Array.from({ length: 11 }, (_, index) => index + 5));
  }
  const total = bx.items.filter((item) => item.assumed > TOLERANCE).reduce(
    (sum, item) => ({
      demand: sum.demand + item.demand,
      machine: sum.machine + item.machineScheduled,
      assumed: sum.assumed + item.assumed,
      sold: sum.sold + item.alreadySold,
      live: sum.live + item.liveOrders,
      weeks: sum.weeks.map((value, index) => value + item.assumedWeeks[index]!),
    }),
    { demand: 0, machine: 0, assumed: 0, sold: 0, live: 0, weeks: [0, 0, 0, 0] },
  );
  const totalRow = sheet.addRow([
    "", "TOTAL", "", "", total.demand, total.machine, total.assumed, "", "",
    total.sold, total.live, ...total.weeks,
  ]);
  totalRow.font = { bold: true };
  formatNumbers(totalRow, Array.from({ length: 11 }, (_, index) => index + 5));
  const widths = [3, 16, 32, 24, 14, 17, 17, 24, 28, 14, 14, 13, 13, 13, 13];
  widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
  setup(sheet, "O");
}

function addHowToRead(workbook: ExcelJS.Workbook, bx: BxPayload): void {
  const sheet = workbook.addWorksheet("How to read this plan");
  title(sheet, "How to read this plan", `Evidence: stored Temporary run ${bx.temporaryRunId ?? "—"} and Production run ${bx.productionRunId}`);
  headers(sheet, ["Term", "Meaning"]);
  const rows = [
    ["MACHINE SCHEDULED", "Stored machine-app allocation, capped to this item's Temporary demand."],
    ["PART SCHEDULED", "Some stored allocation exists; the remainder is explicit assumed feasible."],
    ["NOT SCHEDULED — assumed", "The row was sent to the machine app but no allocation was stored."],
    ["NOT SENT — assumed", "The row was withheld from the machine app; it is not plant-app evidence."],
    ["Assumed feasible", "Demand minus machine scheduled. It must not be read as a machine result."],
    ["Calendar", bx.calendar],
    ["PTMT calendar", "PTMT uses [6,6,6,8] = 26 working days and does not infer Sunday evidence."],
    ["Machine scheduled share", `${(bx.totals.machineScheduled / bx.totals.demand * 100).toFixed(1)}% comes from stored plant-app allocations.`],
    ["Solvent passthrough", "Solvent demand is executable without a pipe/fitting machine allocation and is placed in W4 as stored fit passthrough."],
    ["Assumed share", `${(bx.totals.assumed / bx.totals.demand * 100).toFixed(1)}% is explicitly assumed feasible; it was 17.4% before the standards correction.`],
    ["Conservation", "For every row: demand = machine scheduled + assumed = W1 + W2 + W3 + W4."],
    ["Reasons", "Capacity, material unknown, data limited and allocation shortfall remain separate."],
    ["Reason row counts", "Counts come from the stored fit summary; item rows show every positive assumed quantity at the frozen-plan grain."],
  ];
  for (const [term, meaning] of rows) {
    const row = sheet.addRow(["", term, meaning]);
    if (/assumed|NOT SENT|PART/.test(term)) row.getCell(2).fill = ASSUMPTION_FILL;
  }
  sheet.getColumn(1).width = 3;
  sheet.getColumn(2).width = 28;
  sheet.getColumn(3).width = 110;
  setup(sheet, "C");
}

export async function exportMachineFeasibleExcel(payload: MachinePlanningPayload): Promise<Buffer> {
  const bx = buildBxPayload(payload);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Production Planning";
  addPlanAtAGlance(workbook, bx);
  addItemPlan(workbook, bx);
  addAssumedFeasible(workbook, bx);
  addHowToRead(workbook, bx);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function addWeekSummary(workbook: ExcelJS.Workbook, bx: BxPayload): void {
  const sheet = workbook.addWorksheet("Week summary");
  title(sheet, `${bx.segment} Weekly Release — ${bx.month}`, `Production run ${bx.productionRunId} · ${bx.calendar}`);
  headers(sheet, ["Week", "Dates", "Working days", "Pieces", "Share", "Pieces per working day", "Of which assumed"]);
  const dates = ["1–7 Sep", "8–14 Sep", "15–21 Sep", "22–30 Sep"];
  const weekTotals = [bx.totals.w1, bx.totals.w2, bx.totals.w3, bx.totals.w4];
  for (let index = 0; index < 4; index++) {
    const assumed = bx.items.reduce((sum, item) => sum + item.assumedWeeks[index]!, 0);
    const row = sheet.addRow([
      "", `W${index + 1}`, dates[index], WEEK_DAYS[index], weekTotals[index],
      bx.totals.demand > 0 ? weekTotals[index]! / bx.totals.demand : 0,
      weekTotals[index]! / WEEK_DAYS[index]!, assumed,
    ]);
    row.getCell(6).numFmt = "0.0%";
    formatNumbers(row, [4, 5, 7, 8]);
  }
  const total = sheet.addRow(["", "TOTAL", "1–30 Sep", 27, bx.totals.demand, 1, bx.totals.demand / 27, bx.totals.assumed]);
  total.font = { bold: true };
  total.getCell(6).numFmt = "0.0%";
  formatNumbers(total, [4, 5, 7, 8]);
  sheet.addRow([]);
  sheet.addRow(["", "Product group", "W1", "W2", "W3", "W4", "Total"]);
  sheet.lastRow!.font = { bold: true };
  for (const group of [...new Set(bx.items.map((item) => item.category))].sort()) {
    const groupItems = bx.items.filter((item) => item.category === group);
    const groupWeeks = [0, 1, 2, 3].map((index) =>
      groupItems.reduce((sum, item) => sum + [item.w1, item.w2, item.w3, item.w4][index]!, 0));
    const row = sheet.addRow(["", group, ...groupWeeks, groupWeeks.reduce((sum, value) => sum + value, 0)]);
    formatNumbers(row, [3, 4, 5, 6, 7]);
  }
  [3, 22, 18, 16, 16, 14, 24, 20].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  setup(sheet, "H");
}

function addWeekSheet(workbook: ExcelJS.Workbook, bx: BxPayload, week: 1 | 2 | 3 | 4): void {
  const sheet = workbook.addWorksheet(`Week ${week}`);
  title(sheet, `${bx.segment} Weekly Release — Week ${week}`, `${bx.month} · ${bx.calendar}`);
  headers(sheet, ["Item code", "Product group", "Item name", "MAKE THIS WEEK", "ASSUMED", "Machine(s)", "Already sold", "Running total", "Placement"]);
  const key = `w${week}` as "w1" | "w2" | "w3" | "w4";
  let running = 0;
  for (const item of bx.items.filter((item) => item[key] > TOLERANCE)) {
    const machineWeek = item.machineWeeks[week - 1]!;
    const assumedWeek = item.assumedWeeks[week - 1]!;
    running += item[key];
    const row = sheet.addRow([
      "", item.itemCode, item.category, item.itemName, item[key],
      assumedWeek > TOLERANCE ? "YES" : "NO", item.machine,
      week === 1 ? item.alreadySold : 0, running,
      item.machineScheduled > 0 && item.scheduledWeek === week ? "stored machine week" : assumedWeek > TOLERANCE ? "assumed placement" : "stored placement",
    ]);
    if (assumedWeek > TOLERANCE) row.fill = ASSUMPTION_FILL;
    formatNumbers(row, [5, 8, 9]);
  }
  const total = sheet.addRow([
    "", "TOTAL", "", "", bx.totals[key],
    "", "", week === 1 ? bx.items.reduce((sum, item) => sum + item.alreadySold, 0) : 0, bx.totals[key], "",
  ]);
  total.font = { bold: true };
  formatNumbers(total, [5, 8, 9]);
  [3, 16, 24, 38, 18, 14, 28, 16, 18, 24].forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
  setup(sheet, "J");
}

export async function exportWeeklyReleaseBxExcel(payload: MachinePlanningPayload): Promise<Buffer> {
  const bx = buildBxPayload(payload);
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Production Planning";
  addWeekSummary(workbook, bx);
  addWeekSheet(workbook, bx, 1);
  addWeekSheet(workbook, bx, 2);
  addWeekSheet(workbook, bx, 3);
  addWeekSheet(workbook, bx, 4);
  addHowToRead(workbook, bx);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
