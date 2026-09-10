import type ExcelJS from "exceljs";
import type { PlumbingMachineCapacity } from "@workspace/db";
import {
  annotateWeeklyRelease,
  type CalcPlanItem,
  type WeeklyBandConfig,
} from "./calc";
import {
  runMachineCascade,
  type PlanItemForCascade,
  type MachineWeekUtilisation,
} from "./machine-capacity-engine";
import type { FrozenPlanRow } from "./excel-export";

export const PLUMBING_UNFEASIBLE_REASONS = [
  "CAPACITY",
  "NO ROUTE",
  "NO BOM WEIGHT",
  "DATA LIMITED",
] as const;

export type PlumbingUnfeasibleReason = typeof PLUMBING_UNFEASIBLE_REASONS[number];

export type PlumbingAchievabilityItem = {
  itemCode: string;
  colour: string;
  category: string;
  itemName: string;
  temporaryDemand: number;
  achievable: number;
  unfeasible: number;
  achievableDummy: number;
  achievableOrders: number;
  achievableBuffer: number;
  unfeasibleDummy: number;
  unfeasibleOrders: number;
  unfeasibleBuffer: number;
  machineW1: number;
  machineW2: number;
  machineW3: number;
  machineW4: number;
  machine: string;
  reason: PlumbingUnfeasibleReason | "";
  bindingMachine: string;
};

export type PlumbingAchievabilityCategory = {
  category: string;
  rowCount: number;
  temporaryDemand: number;
  achievable: number;
  unfeasible: number;
};

export type PlumbingAchievabilityReasonSummary = {
  reason: PlumbingUnfeasibleReason;
  rowCount: number;
  pieces: number;
};

export type PlumbingMachineLoad = {
  machineId: string;
  pool: string;
  label: string;
  materials: string;
  lockedOut: boolean;
  weeks: Array<{
    week: number;
    hoursAvailable: number;
    hoursUsed: number;
    utilisationPct: number;
  }>;
  monthHoursAvailable: number;
  monthHoursUsed: number;
  monthUtilisationPct: number;
};

export type PlumbingAchievabilityAnalysis = {
  month: string;
  items: PlumbingAchievabilityItem[];
  categories: PlumbingAchievabilityCategory[];
  reasons: PlumbingAchievabilityReasonSummary[];
  machineLoads: PlumbingMachineLoad[];
  totalTemporaryDemand: number;
  totalAchievable: number;
  totalUnfeasible: number;
  unfeasibleRowCount: number;
};

export type PlumbingWeeklyBand = WeeklyBandConfig & {
  categoryName: string;
};

const EPSILON = 0.01;

function positive(value: number | null | undefined): number {
  return Math.max(0, value ?? 0);
}

function quantity(value: number): number {
  return Math.round(value * 100) / 100;
}

function splitDemand(demand: number, row: FrozenPlanRow): {
  dummy: number;
  orders: number;
  buffer: number;
} {
  // Component demand is consumed in the same order as the machine cascade:
  // dummy, current orders, then buffer. The final component absorbs any
  // harmless persisted rounding difference so the components always describe
  // exactly the temporary demand being conserved.
  const dummy = Math.min(demand, positive(row.dummy));
  const orders = Math.min(Math.max(0, demand - dummy), positive(row.orders));
  const buffer = Math.max(0, demand - dummy - orders);
  return { dummy, orders, buffer };
}

function splitPlaced(
  placed: number,
  components: { dummy: number; orders: number; buffer: number },
): { dummy: number; orders: number; buffer: number } {
  const dummy = Math.min(placed, components.dummy);
  const orders = Math.min(Math.max(0, placed - dummy), components.orders);
  const buffer = Math.min(
    Math.max(0, placed - dummy - orders),
    components.buffer,
  );
  return { dummy, orders, buffer };
}

function poolForCategory(category: string): "PIPE" | "MOULDING" | "SOLVENT" | null {
  if (category.endsWith("Pipe")) return "PIPE";
  if (category.endsWith("Fitting")) return "MOULDING";
  if (category.endsWith("Solvent")) return "SOLVENT";
  return null;
}

function materialForCategory(category: string): string {
  return category.split(" ")[0] ?? "";
}

function hasRoute(
  category: string,
  machines: PlumbingMachineCapacity[],
): boolean {
  const pool = poolForCategory(category);
  if (pool === "SOLVENT") return true;
  if (pool === null) return false;

  const active = machines.filter((machine) => !machine.lockedOut && machine.pool === pool);
  if (pool === "PIPE") {
    const material = materialForCategory(category);
    return active.some((machine) => {
      const rates = machine.rates as Record<string, number>;
      return typeof rates[material] === "number" && rates[material] > 0;
    });
  }
  return active.some((machine) => {
    const rates = machine.rates as Record<string, number>;
    return typeof rates.ALL === "number" && rates.ALL > 0;
  });
}

function machineInputs(
  row: FrozenPlanRow,
  demand: number,
): PlanItemForCascade {
  const item: CalcPlanItem = {
    itemCode: row.itemCode,
    colour: row.colour,
    category: row.category,
    itemName: row.itemName,
    sourceRole: row.sourceRole,
    unmappedReason: row.unmappedReason,
    avg3MoSale: row.avg3MoSale,
    stock: row.stock,
    stockNeedsReview: false,
    bufferReq: row.bufferReq,
    minProduction: row.minProduction,
    maxProduction: demand,
    pendingOrderLastMonth: positive(row.dummy),
    pendingOrder: positive(row.orders),
    order: positive(row.orders),
    achievementPct: null,
    cover: row.avg3MoSale > 0 ? row.stock / row.avg3MoSale : "OS",
    week: null,
    w1: 0,
    w2: 0,
    w3: 0,
    w4: 0,
  };

  return {
    ...item,
    totalKg: row.totalKg ?? 0,
    noBomKg: row.totalKg == null || row.totalKg <= 0,
    machineW1: 0,
    machineW2: 0,
    machineW3: 0,
    machineW4: 0,
    assignedMachineId: null,
    machineWeek: null,
    machineUnfulfillable: false,
  };
}

function assertBalanced(
  label: string,
  demand: number,
  achievable: number,
  unfeasible: number,
): void {
  if (
    Math.abs((achievable + unfeasible) - demand) > EPSILON
    || achievable < -EPSILON
    || unfeasible < -EPSILON
  ) {
    throw new Error(
      `Plumbing achievability conservation failed for ${label}: ` +
      `achievable=${achievable}, unfeasible=${unfeasible}, demand=${demand}`,
    );
  }
}

function routeReason(
  row: FrozenPlanRow,
  demand: number,
  machines: PlumbingMachineCapacity[],
): PlumbingUnfeasibleReason | "" {
  if (demand <= EPSILON) return "";
  if (row.dataLimited) return "DATA LIMITED";
  if (row.totalKg == null || row.totalKg <= 0) return "NO BOM WEIGHT";
  if (!hasRoute(row.category, machines)) return "NO ROUTE";
  return "";
}

function makeCategorySummary(
  items: PlumbingAchievabilityItem[],
): PlumbingAchievabilityCategory[] {
  const categories = new Map<string, PlumbingAchievabilityCategory>();
  for (const item of items) {
    const current = categories.get(item.category) ?? {
      category: item.category,
      rowCount: 0,
      temporaryDemand: 0,
      achievable: 0,
      unfeasible: 0,
    };
    current.rowCount += 1;
    current.temporaryDemand += item.temporaryDemand;
    current.achievable += item.achievable;
    current.unfeasible += item.unfeasible;
    categories.set(item.category, current);
  }
  return [...categories.values()].map((summary) => ({
    ...summary,
    temporaryDemand: quantity(summary.temporaryDemand),
    achievable: quantity(summary.achievable),
    unfeasible: quantity(summary.unfeasible),
  }));
}

function makeReasonSummary(
  items: PlumbingAchievabilityItem[],
): PlumbingAchievabilityReasonSummary[] {
  const counts = new Map<PlumbingUnfeasibleReason, PlumbingAchievabilityReasonSummary>(
    PLUMBING_UNFEASIBLE_REASONS.map((reason) => [reason, { reason, rowCount: 0, pieces: 0 }]),
  );
  for (const item of items) {
    if (!item.reason || item.unfeasible <= EPSILON) continue;
    const current = counts.get(item.reason)!;
    current.rowCount += 1;
    current.pieces += item.unfeasible;
  }
  return PLUMBING_UNFEASIBLE_REASONS.map((reason) => ({
    ...counts.get(reason)!,
    pieces: quantity(counts.get(reason)!.pieces),
  }));
}

export function buildPlumbingAchievability(
  month: string,
  rows: FrozenPlanRow[],
  machines: PlumbingMachineCapacity[],
  bands: PlumbingWeeklyBand[],
): PlumbingAchievabilityAnalysis {
  const bandsByCategory = new Map(bands.map((band) => [band.categoryName, band]));
  const cascadeItems: PlanItemForCascade[] = [];
  const classifications = new Map<string, {
    row: FrozenPlanRow;
    demand: number;
    components: { dummy: number; orders: number; buffer: number };
    reason: PlumbingUnfeasibleReason | "";
  }>();

  for (const row of rows) {
    const demand = positive(row.temporaryPlan);
    const components = splitDemand(demand, row);
    const reason = routeReason(row, demand, machines);
    classifications.set(`${row.category}::${row.itemCode}::${row.colour}`, {
      row,
      demand,
      components,
      reason,
    });
    if (!reason && demand > EPSILON) {
      cascadeItems.push(machineInputs(row, demand));
    }
  }

  annotateWeeklyRelease(cascadeItems, bandsByCategory);
  const cascadeResult = runMachineCascade(cascadeItems, machines, month);
  const cascadedByKey = new Map(
    cascadeItems.map((item) => [`${item.category}::${item.itemCode}::${item.colour}`, item]),
  );
  const bindingMachineByItem = new Map(
    cascadeResult.unfulfillable.map((item) => [
      `${item.category}::${item.itemCode}`,
      item.bindingMachine ?? "",
    ]),
  );

  const items = [...classifications.values()].map(({ row, demand, components, reason }) => {
    const cascaded = cascadedByKey.get(`${row.category}::${row.itemCode}::${row.colour}`);
    const placed = cascaded
      ? Math.min(
        demand,
        Math.max(
          0,
          cascaded.machineW1
            + cascaded.machineW2
            + cascaded.machineW3
            + cascaded.machineW4,
        ),
      )
      : reason === "" ? demand : 0;
    const unfeasible = Math.max(0, demand - placed);
    const achievedComponents = splitPlaced(placed, components);
    const unfeasibleComponents = splitPlaced(unfeasible, {
      dummy: Math.max(0, components.dummy - achievedComponents.dummy),
      orders: Math.max(0, components.orders - achievedComponents.orders),
      buffer: Math.max(0, components.buffer - achievedComponents.buffer),
    });

    assertBalanced(`${row.category}/${row.itemCode}/${row.colour}`, demand, placed, unfeasible);
    const actualReason: PlumbingUnfeasibleReason | "" = unfeasible > EPSILON
      ? reason || "CAPACITY"
      : "";

    return {
      itemCode: row.itemCode,
      colour: row.colour,
      category: row.category,
      itemName: row.itemName ?? "",
      temporaryDemand: quantity(demand),
      achievable: quantity(placed),
      unfeasible: quantity(unfeasible),
      achievableDummy: quantity(achievedComponents.dummy),
      achievableOrders: quantity(achievedComponents.orders),
      achievableBuffer: quantity(achievedComponents.buffer),
      unfeasibleDummy: quantity(unfeasibleComponents.dummy),
      unfeasibleOrders: quantity(unfeasibleComponents.orders),
      unfeasibleBuffer: quantity(unfeasibleComponents.buffer),
      machineW1: quantity(cascaded?.machineW1 ?? (reason === "" ? demand : 0)),
      machineW2: quantity(cascaded?.machineW2 ?? 0),
      machineW3: quantity(cascaded?.machineW3 ?? 0),
      machineW4: quantity(cascaded?.machineW4 ?? 0),
      machine: cascaded?.assignedMachineId ?? "",
      reason: actualReason,
      bindingMachine: actualReason === "CAPACITY"
        ? bindingMachineByItem.get(`${row.category}::${row.itemCode}`) ?? ""
        : "",
    };
  });

  const totalTemporaryDemand = items.reduce((sum, item) => sum + item.temporaryDemand, 0);
  const totalAchievable = items.reduce((sum, item) => sum + item.achievable, 0);
  const totalUnfeasible = items.reduce((sum, item) => sum + item.unfeasible, 0);
  assertBalanced("TOTAL", totalTemporaryDemand, totalAchievable, totalUnfeasible);

  const categories = makeCategorySummary(items);
  for (const category of categories) {
    assertBalanced(
      `CATEGORY/${category.category}`,
      category.temporaryDemand,
      category.achievable,
      category.unfeasible,
    );
  }

  return {
    month,
    items,
    categories,
    reasons: makeReasonSummary(items),
    machineLoads: buildMachineLoads(machines, cascadeResult.utilisation),
    totalTemporaryDemand: quantity(totalTemporaryDemand),
    totalAchievable: quantity(totalAchievable),
    totalUnfeasible: quantity(totalUnfeasible),
    unfeasibleRowCount: items.filter((item) => item.unfeasible > EPSILON).length,
  };
}

function styleHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } };
  row.alignment = { vertical: "middle", wrapText: true };
}

function roundMachineMetric(value: number): number {
  return Math.round(value * 10) / 10;
}

function buildMachineLoads(
  machines: PlumbingMachineCapacity[],
  utilisation: MachineWeekUtilisation[],
): PlumbingMachineLoad[] {
  const byMachineWeek = new Map(
    utilisation.map((entry) => [`${entry.machineId}::${entry.week}`, entry]),
  );

  return machines.map((machine) => {
    const weeks = [1, 2, 3, 4].map((week) => {
      const entry = byMachineWeek.get(`${machine.machineId}::${week}`);
      return {
        week,
        hoursAvailable: roundMachineMetric(entry?.hoursAvailable ?? 0),
        hoursUsed: roundMachineMetric(entry?.hoursUsed ?? 0),
        utilisationPct: roundMachineMetric(entry?.utilisationPct ?? 0),
      };
    });
    const monthHoursAvailable = roundMachineMetric(
      weeks.reduce((sum, current) => sum + current.hoursAvailable, 0),
    );
    const monthHoursUsed = roundMachineMetric(
      weeks.reduce((sum, current) => sum + current.hoursUsed, 0),
    );

    return {
      machineId: machine.machineId,
      pool: machine.pool,
      label: machine.label ?? "",
      materials: Object.entries(machine.rates as Record<string, number>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([material, rate]) => `${material}: ${rate}`)
        .join(", "),
      lockedOut: machine.lockedOut,
      weeks,
      monthHoursAvailable,
      monthHoursUsed,
      monthUtilisationPct: monthHoursAvailable > 0
        ? roundMachineMetric((monthHoursUsed / monthHoursAvailable) * 100)
        : 0,
    };
  });
}

function colourUtilisationCell(cell: ExcelJS.Cell, utilisationPct: number): void {
  if (utilisationPct >= 100) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFC7CE" } };
    cell.font = { color: { argb: "FF9C0006" } };
  } else if (utilisationPct > 90) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFEB9C" } };
    cell.font = { color: { argb: "FF9C6500" } };
  }
}

function addMachineLoadSheet(
  workbook: ExcelJS.Workbook,
  analysis: PlumbingAchievabilityAnalysis,
): void {
  const sheet = workbook.addWorksheet("MACHINE LOAD BY WEEK");
  sheet.addRow([`MACHINE LOAD BY WEEK — Plumbing — ${analysis.month}`]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow(["Source", "Frozen Temporary Plan plus in-memory Plumbing machine cascade"]);
  sheet.addRow(["Machine hours available", analysis.machineLoads.reduce((sum, machine) => sum + machine.monthHoursAvailable, 0)]);
  sheet.addRow(["Machine hours used", analysis.machineLoads.reduce((sum, machine) => sum + machine.monthHoursUsed, 0)]);
  sheet.addRow(["Routed positive-weight demand", analysis.items
    .filter((item) => item.reason === "" && item.temporaryDemand > 0)
    .reduce((sum, item) => sum + item.temporaryDemand, 0)]);
  sheet.addRow(["Routed achievable pieces", analysis.items
    .filter((item) => item.reason === "" && item.temporaryDemand > 0)
    .reduce((sum, item) => sum + item.achievable, 0)]);
  sheet.addRow(["Routed capacity residual", analysis.items
    .filter((item) => item.reason === "CAPACITY")
    .reduce((sum, item) => sum + item.unfeasible, 0)]);
  sheet.addRow(["Item detail note", "The cascade retains first-machine attribution and aggregate weekly item pieces, not a complete multi-machine allocation ledger."]);
  sheet.addRow([]);

  const headers = [
    "Machine", "Pool", "Materials / Rates", "Locked Out",
    "W1 Hours Available", "W1 Hours Used", "W1 Utilisation %",
    "W2 Hours Available", "W2 Hours Used", "W2 Utilisation %",
    "W3 Hours Available", "W3 Hours Used", "W3 Utilisation %",
    "W4 Hours Available", "W4 Hours Used", "W4 Utilisation %",
    "Month Hours Available", "Month Hours Used", "Month Utilisation %",
  ];
  sheet.addRow(headers);
  styleHeader(sheet.lastRow!);

  for (const machine of analysis.machineLoads) {
    const row = sheet.addRow([
      machine.machineId,
      machine.pool,
      machine.materials,
      machine.lockedOut ? "Yes" : "No",
      machine.weeks[0]!.hoursAvailable,
      machine.weeks[0]!.hoursUsed,
      machine.weeks[0]!.utilisationPct,
      machine.weeks[1]!.hoursAvailable,
      machine.weeks[1]!.hoursUsed,
      machine.weeks[1]!.utilisationPct,
      machine.weeks[2]!.hoursAvailable,
      machine.weeks[2]!.hoursUsed,
      machine.weeks[2]!.utilisationPct,
      machine.weeks[3]!.hoursAvailable,
      machine.weeks[3]!.hoursUsed,
      machine.weeks[3]!.utilisationPct,
      machine.monthHoursAvailable,
      machine.monthHoursUsed,
      machine.monthUtilisationPct,
    ]);
    for (const column of [7, 10, 13, 16, 19]) {
      colourUtilisationCell(row.getCell(column), Number(row.getCell(column).value ?? 0));
    }
  }

  sheet.views = [{ state: "frozen", ySplit: 10 }];
  sheet.columns.forEach((column) => { column.width = 16; });
  sheet.getColumn(1).width = 13;
  sheet.getColumn(2).width = 12;
  sheet.getColumn(3).width = 24;
  sheet.getColumn(4).width = 12;
  sheet.getColumn(8).width = 18;
  sheet.getColumn(9).width = 14;
  sheet.getColumn(10).width = 16;
  sheet.getColumn(11).width = 18;
  sheet.getColumn(12).width = 14;
  sheet.getColumn(13).width = 16;
  sheet.getColumn(14).width = 18;
  sheet.getColumn(15).width = 14;
  sheet.getColumn(16).width = 16;
  sheet.getColumn(17).width = 20;
  sheet.getColumn(18).width = 16;
  sheet.getColumn(19).width = 18;
}

function addSummary(
  sheet: ExcelJS.Worksheet,
  analysis: PlumbingAchievabilityAnalysis,
): number {
  sheet.addRow(["Temporary plan demand", analysis.totalTemporaryDemand]);
  sheet.addRow(["Achievable this month", analysis.totalAchievable]);
  sheet.addRow(["Unfeasible for the month", analysis.totalUnfeasible]);
  sheet.addRow(["Unfeasible row count", analysis.unfeasibleRowCount]);
  sheet.addRow([]);
  sheet.addRow(["Category breakdown"]);
  styleHeader(sheet.lastRow!);
  sheet.addRow(["Category", "Rows", "Temporary Demand", "Achievable", "Unfeasible"]);
  styleHeader(sheet.lastRow!);
  for (const category of analysis.categories) {
    sheet.addRow([
      category.category,
      category.rowCount,
      category.temporaryDemand,
      category.achievable,
      category.unfeasible,
    ]);
  }
  sheet.addRow([]);
  sheet.addRow(["Reason distribution"]);
  styleHeader(sheet.lastRow!);
  sheet.addRow(["Reason", "Rows", "Pieces"]);
  styleHeader(sheet.lastRow!);
  for (const reason of analysis.reasons) {
    sheet.addRow([reason.reason, reason.rowCount, reason.pieces]);
  }
  sheet.addRow([]);
  return sheet.rowCount + 1;
}

export function addPlumbingAchievabilitySheets(
  workbook: ExcelJS.Workbook,
  analysis: PlumbingAchievabilityAnalysis,
): void {
  const achievable = workbook.addWorksheet("WHAT CAN BE ACHIEVED");
  achievable.addRow([`WHAT CAN BE ACHIEVED — Plumbing — ${analysis.month}`]);
  achievable.getRow(1).font = { bold: true, size: 14 };
  achievable.addRow([
    "Note",
    "An item may run on more than one machine; this is the first allocation machine.",
  ]);
  achievable.getRow(2).alignment = { wrapText: true };
  let row = addSummary(achievable, analysis);
  achievable.addRow([
    "Item Code", "Colour", "Category", "Item Name", "Temporary Demand",
    "Achievable Quantity", "Of Which Dummy", "Of Which Orders", "Of Which Buffer",
    "Machine W1", "Machine W2", "Machine W3", "Machine W4", "First allocation machine",
  ]);
  styleHeader(achievable.lastRow!);
  row += 1;
  for (const item of analysis.items) {
    achievable.addRow([
      item.itemCode,
      item.colour,
      item.category,
      item.itemName,
      item.temporaryDemand,
      item.achievable,
      item.achievableDummy,
      item.achievableOrders,
      item.achievableBuffer,
      item.machineW1,
      item.machineW2,
      item.machineW3,
      item.machineW4,
      item.machine,
    ]);
  }
  void row;
  achievable.views = [{ state: "frozen", ySplit: 1 }];
  achievable.getRow(1).alignment = { wrapText: true };
  achievable.columns.forEach((column) => { column.width = 18; });
  achievable.getColumn(3).width = 24;
  achievable.getColumn(4).width = 28;

  const unfeasible = workbook.addWorksheet("UNFEASIBLE FOR THE MONTH");
  unfeasible.getCell("A1").value =
    "These quantities cannot be produced in September 2026. They do NOT carry forward to October.";
  unfeasible.getRow(1).font = { bold: true, size: 13, color: { argb: "FF9C0006" } };
  unfeasible.getRow(1).alignment = { wrapText: true };
  addSummary(unfeasible, analysis);
  unfeasible.addRow([
    "Item Code", "Colour", "Category", "Item Name", "Temporary Demand",
    "Unfeasible Quantity", "Of Which Dummy", "Of Which Orders", "Of Which Buffer",
    "Reason", "Binding Machine",
  ]);
  styleHeader(unfeasible.lastRow!);
  for (const item of analysis.items.filter((candidate) => candidate.unfeasible > EPSILON)) {
    unfeasible.addRow([
      item.itemCode,
      item.colour,
      item.category,
      item.itemName,
      item.temporaryDemand,
      item.unfeasible,
      item.unfeasibleDummy,
      item.unfeasibleOrders,
      item.unfeasibleBuffer,
      item.reason,
      item.bindingMachine,
    ]);
  }
  unfeasible.views = [{ state: "frozen", ySplit: 1 }];
  unfeasible.columns.forEach((column) => { column.width = 18; });
  unfeasible.getColumn(3).width = 24;
  unfeasible.getColumn(4).width = 28;
  unfeasible.getColumn(10).width = 18;

  addMachineLoadSheet(workbook, analysis);
}