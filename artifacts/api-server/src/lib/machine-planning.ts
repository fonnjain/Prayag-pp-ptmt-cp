import { and, desc, eq } from "drizzle-orm";
import {
  db,
  planRunInputsTable,
  planRunResultsTable,
  planRunsTable,
  planRunSupersessionsTable,
  planScheduleResultsTable,
  plumbingFitAttemptsTable,
  plumbingMachineCapacityTable,
} from "@workspace/db";
import type { FrozenPlanRow } from "./excel-export";

type Json = Record<string, unknown>;
type ScheduleRow = typeof planScheduleResultsTable.$inferSelect;
type ResultRow = typeof planRunResultsTable.$inferSelect;
type InputRow = typeof planRunInputsTable.$inferSelect;
type MachineRow = typeof plumbingMachineCapacityTable.$inferSelect;

const PTMT_REASON =
  "Machine planning is not available for PTMT. It requires item-to-machine routing, machine rates and a machine roster, which do not exist for this segment.";

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}
function number(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function text(value: unknown): string {
  return String(value ?? "").trim();
}
function code(value: unknown): string {
  return text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function first(row: Json, names: string[]): unknown {
  for (const name of names) if (row[name] !== undefined && row[name] !== null) return row[name];
  return undefined;
}
function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
function poolFor(category: string, material?: string | null): string {
  if (category.endsWith("Pipe") || material) return category.endsWith("Fitting") ? "MOULDING" : "PIPE";
  if (category.endsWith("Fitting")) return "MOULDING";
  return "";
}
function weekFor(row: Json, weekDays: number[]): number | null {
  const explicit = number(first(row, ["week", "week_no", "week_number"]));
  if (explicit >= 1 && explicit <= 4) return explicit;
  const day = number(row.day ?? row.day_number);
  if (day > 0) {
    let running = 0;
    for (let index = 0; index < weekDays.length; index += 1) {
      running += number(weekDays[index]);
      if (day <= running) return index + 1;
    }
  }
  return null;
}
function dateString(value: Date | string | null | undefined): string | null {
  return value ? new Date(value).toISOString() : null;
}

export type MachinePlanningAllocation = {
  code: string;
  name: string;
  category: string;
  machine: string;
  pool: string;
  week: number | null;
  netPieces: number;
  grossPieces: number | null;
  kg: number | null;
  hours: number;
  routeMethod: string;
  isFallback: boolean;
};
export type MachinePlanningPayload = {
  available: boolean;
  reason?: string;
  segment: string;
  month: string;
  runId: number | null;
  sourceRunId: number | null;
  attemptId: number | null;
  generatedAt: string | null;
  status: string;
  draft: boolean;
  superseded: boolean;
  supersedingId: number | null;
  weekDays: number[];
  headline: {
    scheduledPieces: number;
    notScheduledPieces: number;
    productsCovered: number;
    routingRosterProducts: number;
    matchedRoutingMaster: number;
    coverageDerivation: string;
    withoutRouting: number;
    withoutRoutingPieces: number;
    mouldingMachinesUsed: number;
    mouldingMachinesTotal: number;
    pipeMachinesUsed: number;
  };
  reasons: Array<{ reason: string; label: string; pieces: number; rows: number }>;
  machines: Array<{
    machine: string;
    pool: string;
    materials: string;
    weeks: Array<{ week: number; available: number; used: number; utilization: number; idle: number }>;
    month: { available: number; used: number; idle: number; utilization: number };
  }>;
  allocations: MachinePlanningAllocation[];
  unscheduled: Array<{ code: string; name: string; category: string; pieces: number; grossPieces: number | null; kg: number | null; reason: string }>;
  coverage: Array<{ code: string; name: string; category: string; requestedPieces: number; status: string; routeMethod: string; covered: boolean; reason: string }>;
  concentration: Array<{ machine: string; pool: string; products: number; pieces: number; singleMachineCount: number; overlapWarning: string | null }>;
  planningRows: FrozenPlanRow[];
  /**
   * These are scheduler-evidence fields, not a new planning calculation.
   * They let the BX exports distinguish a row which was sent to the machine
   * app from a row which was deliberately withheld.
   */
  schedulerSentCodes?: string[];
  unfinishedByCode?: Record<string, number>;
  fitReasonCounts?: {
    unfinished: number;
    materialUnknown: number;
    dataLimited: number;
    allocationShortfall: number;
  };
  trace: Record<string, unknown>;
};

export type StoredMachinePlanningInput = {
  run: typeof planRunsTable.$inferSelect;
  sourceRun?: typeof planRunsTable.$inferSelect;
  results: ResultRow[];
  sourceResults: ResultRow[];
  sourceInputs?: InputRow[];
  schedules: ScheduleRow[];
  machines: MachineRow[];
  attempt?: typeof plumbingFitAttemptsTable.$inferSelect;
  supersession?: typeof planRunSupersessionsTable.$inferSelect;
};

function normalizeMachine(value: unknown): string {
  return text(value).toUpperCase().replace(/\([^)]*\)/g, "").replace(/[^A-Z0-9]/g, "");
}

function resultDemand(row: ResultRow): number {
  return Math.max(0, number(row.demandPlan ?? row.productionPlan ?? row.temporaryPlan));
}
function resultMaterial(row: ResultRow): string {
  return text(row.material).toUpperCase();
}
function itemMap(input: StoredMachinePlanningInput): Map<string, ResultRow> {
  const map = new Map<string, ResultRow>();
  for (const row of [...input.sourceResults, ...input.results]) {
    map.set(`${code(row.itemCode)}::${text(row.category)}`, row);
    if (!map.has(code(row.itemCode))) map.set(code(row.itemCode), row);
  }
  return map;
}

/**
 * Normalizes only persisted planner and scheduler records. This function has
 * no planner, plant, Sheets, or HTTP calls; it is also used by both exports.
 */
export function normalizeStoredMachinePlanning(input: StoredMachinePlanningInput): MachinePlanningPayload {
  const { run, schedules, machines } = input;
  // The Temporary snapshot is the submitted demand basis. Production results
  // are retained for status/feasibility metadata, but must not be counted a
  // second time as another product demand row.
  const rows = input.sourceResults.length > 0 ? input.sourceResults : input.results;
  const byItem = itemMap(input);
  const sourceInputs = new Map<string, InputRow>();
  for (const row of input.sourceInputs ?? []) {
    sourceInputs.set(`${code(row.itemCode)}::${text(row.colour)}`, row);
    if (!sourceInputs.has(code(row.itemCode))) sourceInputs.set(code(row.itemCode), row);
  }
  const scheduleRows = schedules.filter((row) => row.kind === "pipe" || row.kind === "fitting");
  const weekDays = scheduleRows[0]?.weekDays?.map(Number) ?? [];
  const coverageByCode = new Map<string, Json>();
  const schedulerSentCodes = new Set<string>();
  const unfinishedByCode = new Map<string, number>();
  for (const schedule of scheduleRows) {
    for (const value of array(object(schedule.requestJson).demand)) {
      const item = object(value);
      const itemCode = code(first(item, ["item_code", "itemCode", "raw_code"]));
      if (itemCode) schedulerSentCodes.add(itemCode);
    }
    for (const value of array(object(object(schedule.resultJson).coverage).items)) {
      const item = object(value);
      const itemCode = code(first(item, ["item_code", "itemCode", "raw_code"]));
      if (itemCode) coverageByCode.set(itemCode, item);
    }
  }
  const fitSummary = object(input.attempt?.summaryJson);
  const allocations: MachinePlanningAllocation[] = [];
  const unscheduled: MachinePlanningPayload["unscheduled"] = [];
  const coverage: MachinePlanningPayload["coverage"] = [];
  const addReason = (reason: string, label: string, pieces: number) => {
    // Kept as a local audit hook while reason totals below use the persisted
    // fit summary and route-aware unfinished rows.
    if (pieces <= 0) return;
  };

  const addAllocation = (raw: Json, kind: string, fallback: boolean) => {
    const itemCode = text(first(raw, ["item_code", "itemCode", "raw_code"]));
    if (!itemCode) return;
    const source = byItem.get(code(itemCode));
    const category = text(first(raw, ["category"])) || source?.category || (kind === "pipe" ? "Pipe" : "Fitting");
    const material = text(first(raw, ["material"])) || resultMaterial(source ?? ({} as ResultRow));
    const machine = text(first(raw, ["machine", "machine_id", "machineId"])) || "";
    const coverage = coverageByCode.get(code(itemCode));
    const coverageRoute = text(first(coverage ?? {}, ["route_method", "routeMethod", "routing_method"]));
    const routeMethod = text(first(raw, ["route_method", "routeMethod", "routing_method"]))
      || coverageRoute
      || (fallback ? "material_fallback" : "direct");
    const isFallback = fallback || routeMethod === "material_fallback" || /fallback/i.test(routeMethod) || raw.is_fallback === true;
    const net = number(first(raw, ["scheduled_net_pcs", "net_pcs", "net", "scheduled_pcs", "qty_pcs"]));
    const grossValue = first(raw, ["scheduled_gross_pcs", "gross_pcs", "gross"]);
    const kgValue = first(raw, ["scheduled_kg", "kg"]);
    allocations.push({
      code: itemCode,
      name: source?.itemName ?? text(first(raw, ["name", "item_name"])),
      category,
      machine,
      pool: text(first(raw, ["pool"])) || poolFor(category, material),
      week: weekFor(raw, weekDays),
      netPieces: net,
      grossPieces: grossValue === undefined ? null : number(grossValue),
      kg: kgValue === undefined ? null : number(kgValue),
      hours: number(first(raw, ["planned_hours", "planned_hrs", "hours"])),
      routeMethod,
      isFallback,
    });
  };

  for (const schedule of scheduleRows) {
    const raw = object(schedule.resultJson);
    // Allocations v1 is authoritative for item quantities. Blocks are only
    // retained below for persisted capacity/idle evidence; never use them as
    // an alternative item allocation ledger.
    for (const value of array(raw.allocations)) addAllocation(object(value), schedule.kind, false);
    for (const value of array(raw.unfinished)) {
      const item = object(value);
      const itemCode = text(first(item, ["item_code", "itemCode", "raw_code"]));
      const pieces = number(first(item, ["remaining_net_pcs", "remaining_pcs", "net_pcs"]));
      if (!itemCode || pieces <= 0) continue;
      unfinishedByCode.set(
        code(itemCode),
        (unfinishedByCode.get(code(itemCode)) ?? 0) + pieces,
      );
      const source = byItem.get(code(itemCode));
      const routeMethod = text(first(coverageByCode.get(code(itemCode)) ?? {}, ["route_method", "routeMethod", "routing_method"]));
      const fallback = item.is_fallback === true || routeMethod === "material_fallback" || /fallback/i.test(text(item.reason ?? item.route_method));
      const dataLimited = routeMethod === "not_evaluated" || routeMethod === "data_limited" || routeMethod === "missing";
      const reason = fallback ? "material-fallback" : dataLimited ? "data-limited" : "direct-routed";
      addReason(reason, fallback
        ? "Material fallback unfinished — estimated, not plant-approved"
        : dataLimited ? "Data-limited / missing routing or BOM" : "Direct-routed unfinished", pieces);
      unscheduled.push({
        code: itemCode,
        name: source?.itemName ?? "",
        category: source?.category ?? (schedule.kind === "pipe" ? "Pipe" : "Fitting"),
        pieces,
        grossPieces: first(item, ["remaining_gross_pcs", "gross_pcs"]) === undefined
          ? null : number(first(item, ["remaining_gross_pcs", "gross_pcs"])),
        kg: first(item, ["remaining_kg", "kg"]) === undefined ? null : number(first(item, ["remaining_kg", "kg"])),
        reason: fallback
          ? "material fallback — estimated, not plant-approved"
          : dataLimited ? "data-limited / missing routing or BOM" : "direct-routed unfinished",
      });
    }
    for (const value of array(raw.data_limited)) {
      const item = object(value);
      const itemCode = text(first(item, ["item_code", "itemCode", "raw_code"]));
      const pieces = number(first(item, ["requested_pcs", "remaining_net_pcs", "remaining_pcs"]));
      if (!itemCode || pieces <= 0) continue;
      addReason("data-limited", "Data-limited / missing BOM", pieces);
      unscheduled.push({
        code: itemCode,
        name: byItem.get(code(itemCode))?.itemName ?? "",
        category: byItem.get(code(itemCode))?.category ?? "",
        pieces,
        grossPieces: null,
        kg: null,
        reason: "data-limited / missing BOM",
      });
    }
    for (const value of array(object(raw.coverage).items)) {
      const item = object(value);
      const itemCode = text(first(item, ["item_code", "itemCode", "raw_code"]));
      if (!itemCode) continue;
      const source = byItem.get(code(itemCode));
      const status = text(item.status) || "unknown";
      coverage.push({
        code: itemCode,
        name: source?.itemName ?? "",
        category: source?.category ?? "",
        requestedPieces: number(first(item, ["requested_pcs", "qty_pcs"])),
        status,
        routeMethod: text(first(item, ["route_method", "routeMethod", "routing_method"])) || status,
        covered: !/unroute|limit|missing|unknown/i.test(status),
        reason: text(item.reason ?? item.message),
      });
    }
  }

  const demandPieces = scheduleRows.reduce((total, row) => total + number(row.demandPieces), 0)
    + rows.filter((row) => !scheduleRows.some((schedule) => array(object(schedule.requestJson).demand).some((demand) =>
      code(object(demand).item_code) === code(row.itemCode),
    ))).reduce((total, row) => total + resultDemand(row), 0);
  const scheduledPieces = scheduleRows.reduce((total, row) => total + number(row.scheduledPieces), 0)
    || sum(allocations.map((allocation) => allocation.netPieces));
  const notScheduledPieces = Math.max(0, demandPieces - scheduledPieces);

  // Keep unknown/withheld material visible even though those lines are never
  // submitted to the machine app.
  for (const row of rows) {
    const demand = resultDemand(row);
    if (demand <= 0) continue;
    const material = resultMaterial(row);
    if (!material && !coverageByCode.has(code(row.itemCode))) {
      addReason("material-unknown", "Material unknown / withheld", demand);
      unscheduled.push({
        code: row.itemCode,
        name: row.itemName ?? "",
        category: row.category,
        pieces: demand,
        grossPieces: null,
        kg: row.totalKg,
        reason: "material unknown / withheld",
      });
    }
  }

  const rosterRows = rows.filter((row) => /(Pipe|Fitting|Solvent)$/.test(row.category));
  const matchedRoutingRows = rosterRows.filter((row) =>
    coverageByCode.has(code(row.itemCode)) || row.category.endsWith("Solvent"),
  );
  const withoutRoutingRows = rosterRows.filter((row) =>
    !coverageByCode.has(code(row.itemCode)) && !row.category.endsWith("Solvent"),
  );
  const usedMachines = new Set(allocations.map((allocation) => allocation.machine).filter(Boolean));
  const machineData = new Map<string, MachinePlanningPayload["machines"][number]>();
  const machineByAlias = new Map<string, string>();
  const fillMachineAliases = new Set<string>();
  const fillOrdinals = new Map<string, number>();
  for (const machine of machines) {
    machineByAlias.set(normalizeMachine(machine.machineId), machine.machineId);
    machineData.set(machine.machineId, {
      machine: machine.machineId,
      pool: machine.pool,
      materials: Object.keys(machine.rates ?? {}).sort().join(", "),
      weeks: [1, 2, 3, 4].map((week) => ({
        week,
        available: number(machine.shiftsPerDay) * number(machine.hoursPerShift) * number((weekDays[week - 1] ?? 0)),
        used: 0,
        utilization: 0,
        idle: 0,
      })),
      month: { available: 0, used: 0, idle: 0, utilization: 0 },
    });
  }
  for (const schedule of scheduleRows) {
    for (const value of array(object(schedule.resultJson).weekly_fill)) {
      const fill = object(value);
      const schedulerMachineId = text(first(fill, ["machine", "machine_id", "machineId"]));
      if (!schedulerMachineId) continue;
      fillMachineAliases.add(normalizeMachine(schedulerMachineId));
      const machineId = machineByAlias.get(normalizeMachine(schedulerMachineId)) ?? schedulerMachineId;
      const entry = machineData.get(machineId) ?? {
        machine: machineId, pool: "", materials: "", weeks: [1, 2, 3, 4].map((week) => ({ week, available: 0, used: 0, utilization: 0, idle: 0 })),
        month: { available: 0, used: 0, idle: 0, utilization: 0 },
      };
      const explicitWeek = weekFor(fill, weekDays);
      const ordinal = fillOrdinals.get(schedulerMachineId) ?? 0;
      const week = explicitWeek ?? Math.min(4, ordinal + 1);
      if (explicitWeek === null) fillOrdinals.set(schedulerMachineId, ordinal + 1);
      const slot = entry.weeks[week - 1]!;
      slot.available += number(first(fill, ["capacity_hrs", "capacity_hours"]));
      slot.idle += number(first(fill, ["idle_hrs", "idle_hours"]));
      machineData.set(machineId, entry);
    }
  }
  for (const allocation of allocations) {
    const machineId = machineByAlias.get(normalizeMachine(allocation.machine)) ?? allocation.machine;
    const entry = machineData.get(machineId);
    if (!entry) continue;
    const week = allocation.week ?? 1;
    const slot = entry.weeks[week - 1];
    if (slot) slot.used += allocation.hours;
  }
  const machineList = [...machineData.values()].map((machine) => {
    for (const week of machine.weeks) week.utilization = week.available > 0 ? week.used / week.available * 100 : 0;
    machine.month = {
      available: sum(machine.weeks.map((week) => week.available)),
      used: sum(machine.weeks.map((week) => week.used)),
      idle: sum(machine.weeks.map((week) => week.idle)),
      utilization: 0,
    };
    machine.month.utilization = machine.month.available > 0 ? machine.month.used / machine.month.available * 100 : 0;
    return machine;
  });

  const concentrationMap = new Map<string, { pool: string; products: Set<string>; pieces: number; machines: Set<string> }>();
  for (const allocation of allocations) {
    const key = allocation.machine || "(unassigned)";
    const entry = concentrationMap.get(key) ?? { pool: allocation.pool, products: new Set<string>(), pieces: 0, machines: new Set<string>() };
    entry.products.add(code(allocation.code));
    entry.machines.add(allocation.machine || "(unassigned)");
    entry.pieces += allocation.netPieces;
    concentrationMap.set(key, entry);
  }
  const productMachines = new Map<string, Set<string>>();
  for (const allocation of allocations) {
    const set = productMachines.get(code(allocation.code)) ?? new Set<string>();
    set.add(allocation.machine || "(unassigned)");
    productMachines.set(code(allocation.code), set);
  }
  const overlapCount = [...productMachines.values()].filter((set) => set.size > 1).length;
  const concentration = [...concentrationMap.entries()].map(([machine, value]) => ({
    machine,
    pool: value.pool,
    products: value.products.size,
    pieces: value.pieces,
    singleMachineCount: [...value.products].filter((product) => (productMachines.get(product)?.size ?? 0) === 1).length,
    overlapWarning: overlapCount > 0 ? `${overlapCount} product(s) overlap machines; concentration pieces are not summable.` : null,
  }));

  // Coverage is a roster report, not a submission report. Include every
  // persisted Temporary source roster row, including zero-demand products.
  coverage.length = 0;
  for (const row of rosterRows) {
    const evidence = coverageByCode.get(code(row.itemCode));
    const routeMethod = text(first(evidence ?? {}, ["route_method", "routeMethod", "routing_method"]))
      || (row.category.endsWith("Solvent") ? "direct" : "missing");
    coverage.push({
      code: row.itemCode,
      name: row.itemName ?? "",
      category: row.category,
      requestedPieces: resultDemand(row),
      status: text(evidence?.status) || (routeMethod === "missing" ? "missing" : "source-roster"),
      routeMethod,
      covered: routeMethod === "direct" || routeMethod === "material_fallback",
      reason: routeMethod === "missing" ? "No route in persisted coverage evidence" : routeMethod,
    });
  }

  const productionByKey = new Map(
    input.results.map((row) => [`${code(row.itemCode)}::${row.category}`, row]),
  );
  const planningRows: FrozenPlanRow[] = rows.map((source) => {
    const production = productionByKey.get(`${code(source.itemCode)}::${source.category}`);
    const sourceInput = sourceInputs.get(`${code(source.itemCode)}::${text(source.colour)}`)
      ?? sourceInputs.get(code(source.itemCode));
    return {
      itemCode: source.itemCode,
      colour: source.colour,
      category: source.category,
      itemName: source.itemName,
      sourceRole: source.sourceRole,
      unmappedReason: source.unmappedReason,
      dataLimited: production?.dataLimited ?? source.dataLimited,
      dataLimitedReason: production?.dataLimitedReason ?? source.dataLimitedReason,
      avg3MoSale: 0,
      stock: sourceInput?.stock ?? 0,
      pendingCurrent: sourceInput?.pendingCurrent ?? 0,
      pendingLastMonth: sourceInput?.pendingLastMonth ?? 0,
      bufferReq: production?.bufferReq ?? source.bufferReq,
      minProduction: production?.minProduction ?? source.minProduction,
      demandPlan: production?.demandPlan ?? source.demandPlan,
      productionPlan: production?.productionPlan ?? 0,
      temporaryPlan: source.temporaryPlan,
      cannotBeMade: production?.cannotBeMade ?? 0,
      feasibilityStatus: production?.feasibilityStatus,
      dummy: 0,
      orders: 0,
      buffer: production?.bufferReq ?? 0,
      material: production?.material ?? source.material,
      totalKg: production?.totalKg ?? source.totalKg,
      urgencyRank: production?.urgencyRank ?? source.urgencyRank,
      releaseWeek: production?.releaseWeek ?? null,
      w1: production?.w1 ?? 0,
      w2: production?.w2 ?? 0,
      w3: production?.w3 ?? 0,
      w4: production?.w4 ?? 0,
    };
  });

  const summaryReasons = object(fitSummary.unfeasibleByReason);
  const summaryDataLimitedRow = object(summaryReasons["data-limited"]);
  const summaryShortfallRow = object(summaryReasons["allocation-shortfall"]);
  const summaryUnknownRow = object(summaryReasons.MATERIAL_UNKNOWN);
  const summaryDataLimited = number(summaryDataLimitedRow.pieces);
  const summaryMaterialUnknown = number(object(fitSummary.materialUnknown).pieces)
    || number(summaryUnknownRow.pieces);
  const directUnfinished = sum(unscheduled.filter((row) => row.reason === "direct-routed unfinished").map((row) => row.pieces));
  const fallbackUnfinished = sum(unscheduled.filter((row) => row.reason.startsWith("material fallback")).map((row) => row.pieces));
  const reasonRows: Array<{ reason: string; label: string; pieces: number; rows: number }> = [
    { reason: "direct-routed", label: "Direct-routed unfinished", pieces: directUnfinished, rows: unscheduled.filter((row) => row.reason === "direct-routed unfinished").length },
    { reason: "material-fallback", label: "Material fallback unfinished — estimated, not plant-approved", pieces: fallbackUnfinished, rows: unscheduled.filter((row) => row.reason.startsWith("material fallback")).length },
    { reason: "data-limited", label: "Data-limited / missing BOM or route", pieces: summaryDataLimited || sum(unscheduled.filter((row) => row.reason.startsWith("data-limited")).map((row) => row.pieces)), rows: number(summaryDataLimitedRow.rowCount) },
    { reason: "allocation-shortfall", label: "Allocation shortfall / Unclassified", pieces: number(summaryShortfallRow.pieces), rows: number(summaryShortfallRow.rowCount) },
    { reason: "material-unknown", label: "Material unknown / withheld", pieces: summaryMaterialUnknown, rows: number(object(fitSummary.materialUnknown).rowCount) || number(summaryUnknownRow.rowCount) },
  ];
  const reasonTotal = sum(reasonRows.map((row) => row.pieces));
  const notScheduledBasis = fitSummary.unfeasiblePieces === undefined ? notScheduledPieces : number(fitSummary.unfeasiblePieces);
  if (Math.abs(reasonTotal - notScheduledBasis) > 0.0001) {
    reasonRows.push({
      reason: "other-shortfall",
      label: "Other persisted shortfall (not allocated to a business group)",
      pieces: notScheduledBasis - reasonTotal,
      rows: 0,
    });
  }

  return {
    available: true,
    segment: run.segment,
    month: run.month,
    runId: run.id,
    sourceRunId: run.temporaryRunId ?? input.sourceRun?.id ?? null,
    attemptId: input.attempt?.id ?? null,
    generatedAt: dateString(scheduleRows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.createdAt ?? run.createdAt),
    status: run.status,
    draft: run.status === "draft",
    superseded: Boolean(input.supersession),
    supersedingId: input.supersession?.supersedingRunId ?? null,
    weekDays,
    headline: {
      scheduledPieces: fitSummary.executableNet === undefined ? scheduledPieces : number(fitSummary.executableNet),
      notScheduledPieces: notScheduledBasis,
      productsCovered: matchedRoutingRows.length,
      routingRosterProducts: rosterRows.length,
      matchedRoutingMaster: matchedRoutingRows.length,
      coverageDerivation: `Source Temporary rows in Pipe/Fitting/Solvent categories; matched = ${coverageByCode.size} persisted coverage codes plus ${rosterRows.filter((row) => row.category.endsWith("Solvent")).length} solvent passthrough rows; no route = source roster without persisted coverage item. Scheduler submission rows are not used as the roster.`,
      withoutRouting: rosterRows.length - matchedRoutingRows.length,
      withoutRoutingPieces: sum(withoutRoutingRows.map(resultDemand)),
      mouldingMachinesUsed: machines.filter((machine) =>
        machine.pool === "MOULDING"
        && (fillMachineAliases.has(normalizeMachine(machine.machineId))
          || [...usedMachines].some((id) => normalizeMachine(id) === normalizeMachine(machine.machineId))),
      ).length,
      mouldingMachinesTotal: machines.filter((machine) => machine.pool === "MOULDING").length,
      pipeMachinesUsed: new Set([...usedMachines]
        .map((id) => machineByAlias.get(normalizeMachine(id)) ?? id)
        .filter((id) => machineData.get(id)?.pool === "PIPE")).size,
    },
    reasons: reasonRows,
    machines: machineList,
    allocations,
    unscheduled,
    coverage,
    concentration,
    planningRows,
      schedulerSentCodes: [...schedulerSentCodes],
      unfinishedByCode: Object.fromEntries(unfinishedByCode),
      fitReasonCounts: {
        unfinished: number(object(summaryReasons.unfinished).rowCount),
        materialUnknown: number(summaryUnknownRow.rowCount),
        dataLimited: number(summaryDataLimitedRow.rowCount),
        allocationShortfall: number(summaryShortfallRow.rowCount),
      },
    trace: {
      productionRunId: run.id,
      sourceTemporaryRunId: run.temporaryRunId ?? null,
      attemptId: input.attempt?.id ?? null,
      attemptState: input.attempt?.state ?? null,
      sourceRunStatus: input.sourceRun?.status ?? null,
      supersessionId: input.supersession?.id ?? null,
      supersedingRunId: input.supersession?.supersedingRunId ?? null,
      weekDays,
      plantReferences: fitSummary.references ?? [],
      fitSummary: {
        executableNet: fitSummary.executableNet ?? null,
        unfeasiblePieces: fitSummary.unfeasiblePieces ?? null,
      },
        schedulerSentCodes: [...schedulerSentCodes],
    },
  };
}

export function machinePlanningUnavailable(segment: string, month: string): MachinePlanningPayload {
  return {
    available: false,
    reason: PTMT_REASON,
    segment,
    month,
    runId: null,
    sourceRunId: null,
    attemptId: null,
    generatedAt: null,
    status: "unavailable",
    draft: false,
    superseded: false,
    supersedingId: null,
    weekDays: [],
    headline: {
      scheduledPieces: 0, notScheduledPieces: 0, productsCovered: 0, routingRosterProducts: 0,
      matchedRoutingMaster: 0, coverageDerivation: "Unavailable for PTMT.", withoutRouting: 0, withoutRoutingPieces: 0, mouldingMachinesUsed: 0, mouldingMachinesTotal: 0, pipeMachinesUsed: 0,
    },
    reasons: [],
    machines: [],
    allocations: [],
    unscheduled: [],
    coverage: [],
    concentration: [],
    planningRows: [],
    trace: {},
  };
}

export async function loadStoredMachinePlanning(month: string, segment: string): Promise<MachinePlanningPayload> {
  if (segment === "PTMT") return machinePlanningUnavailable(segment, month);
  const [run] = await db.select().from(planRunsTable).where(and(
    eq(planRunsTable.month, month),
    eq(planRunsTable.segment, "Plumbing"),
    eq(planRunsTable.planType, "production"),
  )).orderBy(desc(planRunsTable.id)).limit(1);
  if (!run) return { ...machinePlanningUnavailable("Plumbing", month), reason: "No stored Plumbing Production run exists for this month." };
  const [schedules, results, inputs, machines, supersession, attempt] = await Promise.all([
    db.select().from(planScheduleResultsTable).where(eq(planScheduleResultsTable.runId, run.id)).orderBy(desc(planScheduleResultsTable.id)),
    db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, run.id)),
    db.select().from(planRunInputsTable).where(eq(planRunInputsTable.runId, run.temporaryRunId ?? run.id)),
    db.select().from(plumbingMachineCapacityTable).where(eq(plumbingMachineCapacityTable.segment, "Plumbing")),
    db.select().from(planRunSupersessionsTable).where(eq(planRunSupersessionsTable.productionRunId, run.id)).orderBy(desc(planRunSupersessionsTable.id)).limit(1),
    db.select().from(plumbingFitAttemptsTable).where(eq(plumbingFitAttemptsTable.productionRunId, run.id)).orderBy(desc(plumbingFitAttemptsTable.id)).limit(1),
  ]);
  const sourceRun = run.temporaryRunId == null ? undefined : (await db.select().from(planRunsTable).where(eq(planRunsTable.id, run.temporaryRunId)).limit(1))[0];
  const sourceResults = sourceRun
    ? await db.select().from(planRunResultsTable).where(eq(planRunResultsTable.runId, sourceRun.id))
    : [];
  const newestBatch = schedules[0]?.batchId;
  const latestSchedules = newestBatch ? schedules.filter((row) => row.batchId === newestBatch) : [];
  return normalizeStoredMachinePlanning({
    run,
    sourceRun,
    results,
    sourceInputs: inputs,
    sourceResults,
    schedules: latestSchedules,
    machines,
    supersession: supersession[0],
    attempt: attempt[0],
  });
}

export const buildMachinePlanning = normalizeStoredMachinePlanning;
export const loadMachinePlanning = loadStoredMachinePlanning;

export { PTMT_REASON };