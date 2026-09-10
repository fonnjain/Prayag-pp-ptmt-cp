import { randomUUID } from "node:crypto";
import { countWorkingDaysInMonth, countWorkingDaysInWeek } from "./working-days";
import { normalizeProductionCode } from "./production-code";

export const PLUMBING_SCHEDULE_KINDS = ["pipe", "fitting"] as const;
export type PlumbingScheduleKind = (typeof PLUMBING_SCHEDULE_KINDS)[number];

const ACCEPTED_MATERIALS = new Set(["CPVC", "UPVC", "SWR", "AGRI"]);
const SCHEDULE_URL = "https://prayag-plant.com/data-api/v1/schedule";

export interface PlumbingScheduleDemand {
  item_code: string;
  material: string;
  qty_pcs: number;
  weight_kg_per_piece?: number;
}

export interface PlumbingScheduleCoverageItem {
  item_code: string;
  raw_code?: string;
  requested_pcs: number;
  status: string;
  [key: string]: unknown;
}

export interface PlumbingScheduleDataLimited {
  item_code: string;
  raw_code?: string;
  requested_pcs?: number;
  reasons?: string[];
  reason_text?: string[];
  [key: string]: unknown;
}

export interface PlumbingScheduleDemandReconciliation {
  submitted_requested_pcs: number;
  schedulable_requested_pcs?: number;
  data_limited_requested_pcs?: number;
  capacity_limited_gross_pcs?: number;
  modelled_gross_pcs?: number;
  scheduled_gross_pcs?: number;
  units?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PlumbingScheduleUnfinished {
  item_code: string;
  material: string;
  remaining_pcs: number;
  remaining_kg: number;
  remaining_hours: number;
  [key: string]: unknown;
}

export interface PlumbingScheduleResult {
  kind: PlumbingScheduleKind;
  blocks: unknown[];
  weekly_fill: unknown[];
  coverage: {
    items: PlumbingScheduleCoverageItem[];
    [key: string]: unknown;
  };
  data_limited: PlumbingScheduleDataLimited[];
  demand_reconciliation: PlumbingScheduleDemandReconciliation;
  unfinished: PlumbingScheduleUnfinished[];
  week_days: number[];
  total_capacity_hrs: number;
  total_scheduled_hrs: number;
  total_idle_hrs: number;
  total_scheduled_pcs: number;
  total_scheduled_kg: number | null;
  total_unfinished_pcs: number;
  total_unfinished_kg: number;
  total_unfinished_hours: number;
  total_data_limited_pcs: number;
  total_data_limited_kg: number | null;
  total_downtime_hours_lost: number;
  total_downtime_machine_days: number;
  unfinished_capability: Array<{
    item_code: string;
    material: string;
    remaining_pcs: number;
    remaining_kg: number;
    remaining_hours: number;
    capable_machines: Array<{
      machine_id: string;
      locked_out: boolean | null;
      capacity_hours: number;
      scheduled_hours: number;
      idle_hours: number;
      peak_utilisation_pct: number;
      saturated: boolean;
    }>;
  }>;
  raw: Record<string, unknown>;
}

export interface PlumbingScheduleBatch {
  batchId: string;
  month: string;
  segment: "Plumbing";
  week_days: number[];
  worked_sunday_dates: string[];
  working_days_provenance: {
    total_days: number;
    week_days: number[];
    worked_sunday_dates: string[];
    source: "sunday-aware-calendar";
  };
  materials: string[];
  demand: {
    pieces: number;
    item_count: number;
    kg: number | null;
  };
  scheduled: {
    pieces: number;
    kg: number | null;
    hours: number;
  };
  unfinished: {
    pieces: number;
    kg: number;
    hours: number;
  };
  capacity_hours: number;
  idle_hours: number;
  downtime_hours_lost: number;
  downtime_machine_days: number;
  unallocated_hours: number;
  unroutable: Array<{
    kind: PlumbingScheduleKind;
    item_code: string;
    material: string;
    qty_pcs: number;
    reason: string;
  }>;
  data_limited: Array<{
    kind: PlumbingScheduleKind;
    item_code: string;
    material: string;
    qty_pcs: number;
    reason: string;
  }>;
  data_limited_pieces: number;
  results: PlumbingScheduleResult[];
  merged: {
    blocks: unknown[];
    weekly_fill: unknown[];
    unfinished: PlumbingScheduleUnfinished[];
    data_limited: PlumbingScheduleBatch["data_limited"];
    totals: {
      capacity_hrs: number;
      scheduled_hrs: number;
      idle_hrs: number;
        downtime_hours_lost: number;
        downtime_machine_days: number;
        unallocated_hours: number;
      scheduled_pcs: number;
      scheduled_kg: number | null;
      unfinished_pcs: number;
      unfinished_kg: number;
      unfinished_hours: number;
      data_limited_pcs: number;
    };
  };
}

export interface PlumbingCorrectiveWeek {
  originalWeek: 1 | 2 | 3 | 4;
  workingDays: number;
}

export interface PlumbingCorrectiveAllocation {
  itemCode: string;
  scheduledPieces: number;
  unfinishedPieces: number;
  weeks: [number, number, number, number];
}

export interface PlumbingCorrectiveSubOnePieceExclusion {
  kind: PlumbingScheduleKind;
  item_code: string;
  material: string;
  remaining_pcs: number;
  rounded_pcs: number;
  reason: "SUB_ONE_PIECE_REMAINDER";
}

export interface PlumbingCorrectivePayloadAudit {
  candidate_pipe_rows: number;
  candidate_fitting_rows: number;
  sent_pipe_rows: number;
  sent_fitting_rows: number;
  sub_one_piece_excluded_rows: number;
  sub_one_piece_excluded_quantity: number;
  sub_one_piece_excluded: PlumbingCorrectiveSubOnePieceExclusion[];
}

export interface PlumbingCorrectiveSchedule {
  batchId: string;
  month: string;
  segment: "Plumbing";
  /** Original calendar weeks represented by scheduler-local week 1 onward. */
  originalWeeks: Array<1 | 2 | 3 | 4>;
  /** originalWeek = schedulerWeek + weekOffset. */
  weekOffset: number;
  /** The positive calendar values actually sent to the machine app. */
  weekDays: number[];
  payloadAudit: PlumbingCorrectivePayloadAudit;
  results: PlumbingScheduleResult[];
  allocations: PlumbingCorrectiveAllocation[];
  unroutable: PlumbingScheduleBatch["unroutable"];
}

class UnroutableDemandError extends Error {
  constructor(
    readonly kind: PlumbingScheduleKind,
    readonly itemCodes: string[],
    message: string,
  ) {
    super(message);
    this.name = "UnroutableDemandError";
  }
}

export function buildPlumbingWeekDays(month: string, workedSundayDates: Iterable<string>): number[] {
  const worked = [...new Set(workedSundayDates)].sort();
  const weekDays = ([1, 2, 3, 4] as const).map((week) =>
    countWorkingDaysInWeek(month, week, worked),
  );
  const monthDays = countWorkingDaysInMonth(month, worked);
  if (
    weekDays.some((days) => !Number.isInteger(days) || days <= 0) ||
    weekDays.reduce((sum, days) => sum + days, 0) !== monthDays
  ) {
    throw new Error(`Invalid Plumbing working-day calendar for ${month}: ${weekDays.join(",")}`);
  }
  return weekDays;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : Number(value ?? 0) || 0;
}

function optionalNumberField(raw: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (raw[key] !== undefined && raw[key] !== null) return numberField(raw[key]);
  }
  return null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Machine scheduler returned an invalid ${label}`);
  }
  return value as Record<string, unknown>;
}

function responseItemCode(row: Record<string, unknown>, label: string): string {
  const code = String(row.item_code ?? row.raw_code ?? "").trim();
  if (!code) throw new Error(`Machine scheduler returned a ${label} row without item_code`);
  return code;
}

function reasonText(row: PlumbingScheduleDataLimited): string {
  const reasons = [
    ...(Array.isArray(row.reasons) ? row.reasons : []),
    ...(Array.isArray(row.reason_text) ? row.reason_text : []),
  ].map((reason) => String(reason).trim()).filter(Boolean);
  const direct = String(row.reason ?? row.message ?? "").trim();
  if (direct) reasons.push(direct);
  return [...new Set(reasons)].join("; ") || "Scheduler data limited";
}

function assertSchedulerContract(
  raw: Record<string, unknown>,
  requestedKind: PlumbingScheduleKind,
  demand: PlumbingScheduleDemand[],
  weekDays: number[],
): {
  coverage: { items: PlumbingScheduleCoverageItem[]; [key: string]: unknown };
  dataLimited: PlumbingScheduleDataLimited[];
  demandReconciliation: PlumbingScheduleDemandReconciliation;
} {
  const coverageRaw = asObject(raw.coverage, "coverage");
  const coverageValues = coverageRaw.items;
  if (!Array.isArray(coverageValues)) {
    throw new Error(`Machine scheduler ${requestedKind} response is missing coverage.items`);
  }
  const coverageItems = coverageValues.map((value) => {
    const row = asObject(value, "coverage item");
    const itemCode = responseItemCode(row, "coverage");
    return {
      ...row,
      item_code: itemCode,
      requested_pcs: numberField(row.requested_pcs ?? row.qty_pcs),
      status: String(row.status ?? ""),
    };
  });
  const submittedCodes = demand.map((item) => normalizeProductionCode(item.item_code));
  const coveredCodes = coverageItems.map((item) => normalizeProductionCode(item.item_code));
  if (
    coveredCodes.length !== submittedCodes.length ||
    coveredCodes.some((code, index) => code !== submittedCodes[index])
  ) {
    throw new Error(
      `Machine scheduler ${requestedKind} coverage.items does not preserve every submitted line in request order: ` +
      `submitted=${JSON.stringify(submittedCodes)} covered=${JSON.stringify(coveredCodes)}`,
    );
  }

  const dataLimitedValues = raw.data_limited;
  if (!Array.isArray(dataLimitedValues)) {
    throw new Error(`Machine scheduler ${requestedKind} response is missing data_limited`);
  }
  const dataLimited = dataLimitedValues.map((value) => {
    const row = asObject(value, "data-limited");
    const itemCode = responseItemCode(row, "data-limited");
    if (!submittedCodes.includes(normalizeProductionCode(itemCode))) {
      throw new Error(`Machine scheduler returned data_limited for an unsubmitted item ${itemCode}`);
    }
    return { ...row, item_code: itemCode } as PlumbingScheduleDataLimited;
  });

  const demandReconciliation = asObject(
    raw.demand_reconciliation,
    "demand_reconciliation",
  ) as PlumbingScheduleDemandReconciliation;
  const submittedRequestedPcs = demand.reduce((sum, item) => sum + item.qty_pcs, 0);
  if (
    !Number.isFinite(numberField(demandReconciliation.submitted_requested_pcs)) ||
    Math.abs(numberField(demandReconciliation.submitted_requested_pcs) - submittedRequestedPcs) > 1e-6
  ) {
    throw new Error(
      `Machine scheduler ${requestedKind} demand reconciliation mismatch: ` +
      `submitted=${submittedRequestedPcs} echoed=${String(demandReconciliation.submitted_requested_pcs)}`,
    );
  }

  const paramsUsed = asObject(raw.params_used, "params_used");
  const paramsWeekDays = asArray(paramsUsed.week_days).map(numberField);
  if (JSON.stringify(paramsWeekDays) !== JSON.stringify(weekDays)) {
    throw new Error(
      `Machine scheduler params_used.week_days=${JSON.stringify(paramsWeekDays)} instead of ${JSON.stringify(weekDays)}`,
    );
  }

  return {
    coverage: { ...coverageRaw, items: coverageItems },
    dataLimited,
    demandReconciliation,
  };
}

function normalizeMachineId(value: string): string {
  return value.trim().toUpperCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^A-Z0-9]/g, "");
}

function validateMaterials(demand: PlumbingScheduleDemand[]): string[] {
  const materials = [...new Set(demand.map((item) => item.material))].sort();
  const invalid = materials.filter((material) => !ACCEPTED_MATERIALS.has(material));
  if (invalid.length > 0) {
    throw new Error(`Unsupported Plumbing material value(s): ${invalid.join(", ")}`);
  }
  return materials;
}

function parseScheduleResult(
  raw: Record<string, unknown>,
  requestedKind: PlumbingScheduleKind,
  demand: PlumbingScheduleDemand[],
  weekDays: number[],
  weightByCode: Map<string, number>,
  machineLockedOut?: Map<string, boolean>,
): PlumbingScheduleResult {
  if (raw.kind !== requestedKind) {
    throw new Error(`Machine scheduler returned kind=${String(raw.kind)} for requested kind=${requestedKind}`);
  }
  const { coverage, dataLimited, demandReconciliation } = assertSchedulerContract(
    raw,
    requestedKind,
    demand,
    weekDays,
  );
  const unfinished = asArray(raw.unfinished).map((value) => {
    if (!value || typeof value !== "object") throw new Error("Machine scheduler returned an invalid unfinished row");
    const row = value as Record<string, unknown>;
    if (row.remaining_pcs === undefined || row.remaining_kg === undefined) {
      throw new Error("Machine scheduler unfinished rows must include remaining_pcs and remaining_kg");
    }
    return row as PlumbingScheduleUnfinished;
  });
  const unfinishedPcs = unfinished.reduce((sum, row) => sum + numberField(row.remaining_pcs), 0);
  const unfinishedKg = unfinished.reduce((sum, row) => sum + numberField(row.remaining_kg), 0);
  const unfinishedHours = unfinished.reduce((sum, row) => sum + numberField(row.remaining_hours), 0);
  const demandPieces = demand.reduce((sum, item) => sum + item.qty_pcs, 0);
  const demandKg = demand.every((item) => weightByCode.has(item.item_code))
    ? demand.reduce((sum, item) => sum + item.qty_pcs * (weightByCode.get(item.item_code) ?? 0), 0)
    : null;
  const dataLimitedCodes = new Set(
    dataLimited.map((row) => normalizeProductionCode(row.item_code)),
  );
  const dataLimitedPcs = demand.reduce(
    (sum, item) => dataLimitedCodes.has(normalizeProductionCode(item.item_code)) ? sum + item.qty_pcs : sum,
    0,
  );
  const dataLimitedKg = demandKg === null
    ? null
    : demand.reduce(
      (sum, item) => dataLimitedCodes.has(normalizeProductionCode(item.item_code))
        ? sum + item.qty_pcs * (weightByCode.get(item.item_code) ?? 0)
        : sum,
      0,
    );
  const scheduledPcs = Math.max(0, demandPieces - dataLimitedPcs - unfinishedPcs);
  const scheduledKg = demandKg === null ? null : Math.max(0, demandKg - (dataLimitedKg ?? 0) - unfinishedKg);
  const machineFill = new Map<string, {
    capacity_hours: number;
    scheduled_hours: number;
    idle_hours: number;
    peak_utilisation_pct: number;
  }>();
  for (const value of asArray(raw.weekly_fill)) {
    if (!value || typeof value !== "object") continue;
    const fill = value as Record<string, unknown>;
    const machineId = String(fill.machine ?? fill.machine_id ?? fill.machineId ?? "").trim();
    if (!machineId) continue;
    const existing = machineFill.get(machineId) ?? {
      capacity_hours: 0,
      scheduled_hours: 0,
      idle_hours: 0,
      peak_utilisation_pct: 0,
    };
    existing.capacity_hours += numberField(fill.capacity_hrs ?? fill.capacity_hours);
    existing.scheduled_hours += numberField(fill.scheduled_hrs ?? fill.scheduled_hours);
    existing.idle_hours += numberField(fill.idle_hrs ?? fill.idle_hours);
    const weeklyUtilisation = optionalNumberField(fill, ["utilisation_pct", "utilization_pct", "utilisation", "utilization"])
      ?? (numberField(fill.capacity_hrs ?? fill.capacity_hours) > 0
        ? numberField(fill.scheduled_hrs ?? fill.scheduled_hours) / numberField(fill.capacity_hrs ?? fill.capacity_hours) * 100
        : 0);
    existing.peak_utilisation_pct = Math.max(existing.peak_utilisation_pct, weeklyUtilisation);
    machineFill.set(machineId, existing);
  }
  const unfinishedCapability = unfinished.map((row) => {
    const capableMachineIds = Array.isArray(row.capable_machines)
      ? row.capable_machines.map((machine) => String(machine)).filter(Boolean)
      : [];
    return {
      item_code: String(row.item_code ?? row.raw_code ?? ""),
      material: String(row.material ?? ""),
      remaining_pcs: numberField(row.remaining_pcs),
      remaining_kg: numberField(row.remaining_kg),
      remaining_hours: numberField(row.remaining_hours),
      capable_machines: capableMachineIds.map((machineId) => {
        const fill = machineFill.get(machineId) ?? {
          capacity_hours: 0,
          scheduled_hours: 0,
          idle_hours: 0,
          peak_utilisation_pct: 0,
        };
        return {
          machine_id: machineId,
          locked_out: machineLockedOut?.get(machineId)
            ?? machineLockedOut?.get(normalizeMachineId(machineId))
            ?? null,
          capacity_hours: fill.capacity_hours,
          scheduled_hours: fill.scheduled_hours,
          idle_hours: fill.idle_hours,
          peak_utilisation_pct: fill.peak_utilisation_pct,
          saturated: fill.peak_utilisation_pct >= 99.9,
        };
      }),
    };
  });

  return {
    kind: requestedKind,
    blocks: asArray(raw.blocks),
    weekly_fill: asArray(raw.weekly_fill),
    coverage,
    data_limited: dataLimited,
    demand_reconciliation: demandReconciliation,
    unfinished,
    week_days: asArray(raw.week_days).map(numberField),
    total_capacity_hrs: numberField(raw.total_capacity_hrs),
    total_scheduled_hrs: numberField(raw.total_scheduled_hrs),
    total_idle_hrs: numberField(raw.total_idle_hrs),
    total_scheduled_pcs: scheduledPcs,
    total_scheduled_kg: scheduledKg,
    total_unfinished_pcs: unfinishedPcs,
    total_unfinished_kg: unfinishedKg,
    total_unfinished_hours: unfinishedHours,
    total_data_limited_pcs: dataLimitedPcs,
    total_data_limited_kg: dataLimitedKg,
    total_downtime_hours_lost: optionalNumberField(raw, ["downtime_hours_lost", "downtime_hours", "downtime_hrs"]) ?? 0,
    total_downtime_machine_days: optionalNumberField(raw, ["downtime_machine_days", "downtime_days"]) ?? 0,
    unfinished_capability: unfinishedCapability,
    raw,
  };
}

async function callSchedule(
  month: string,
  weekDays: number[],
  kind: PlumbingScheduleKind,
  demand: PlumbingScheduleDemand[],
  weightByCode: Map<string, number>,
  machineLockedOut?: Map<string, boolean>,
): Promise<PlumbingScheduleResult> {
  const apiKey = process.env.PRAYAG_PLANT_API_KEY;
  if (!apiKey) throw new Error("PRAYAG_PLANT_API_KEY is not configured");
  const response = await fetch(SCHEDULE_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-API-Key": apiKey,
    },
    body: JSON.stringify({
      segment: "PLUMBING",
      month,
      kind,
      week_days: weekDays,
      demand,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const body = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    throw new Error(`Machine scheduler returned non-JSON HTTP ${response.status}`);
  }
  if (!response.ok) {
    // The scheduler can return a structured 422 when every submitted line is
    // data-limited. Preserve that contract so the caller can report the rows
    // instead of converting them into a generic upstream failure.
    if (
      parsed &&
      typeof parsed === "object" &&
      (parsed as Record<string, unknown>).coverage !== undefined
    ) {
      const structuredBody = parsed as Record<string, unknown>;
      const normalizedStructuredBody: Record<string, unknown> = {
        ...structuredBody,
        // Structured all-data-limited responses use HTTP 422 and omit the
        // normal success envelope. The request is the authoritative source
        // for these omitted echo fields.
        kind: structuredBody.kind ?? kind,
        week_days: structuredBody.week_days ?? weekDays,
        params_used: structuredBody.params_used ?? { week_days: weekDays },
      };
      const structuredResult = parseScheduleResult(
        normalizedStructuredBody,
        kind,
        demand,
        weekDays,
        weightByCode,
        machineLockedOut,
      );
      if (JSON.stringify(structuredResult.week_days) !== JSON.stringify(weekDays)) {
        throw new Error(`Machine scheduler echoed week_days=${JSON.stringify(structuredResult.week_days)} instead of ${JSON.stringify(weekDays)}`);
      }
      return structuredResult;
    }
    const detail = parsed && typeof parsed === "object" ? JSON.stringify(parsed) : body;
    const upstreamMessage = parsed && typeof parsed === "object" && typeof (parsed as Record<string, unknown>).message === "string"
      ? (parsed as Record<string, unknown>).message as string
      : "";
    if (
      response.status === 400 &&
      (upstreamMessage.includes("no capable extrusion route") || upstreamMessage.includes("no BOM weight"))
    ) {
      const itemCodes = [...upstreamMessage.matchAll(/([A-Za-z0-9][A-Za-z0-9-]*):\s*no (?:capable extrusion route|BOM weight)/g)]
        .map((match) => match[1]!.trim())
        .filter(Boolean);
      throw new UnroutableDemandError(kind, itemCodes, upstreamMessage);
    }
    throw new Error(`Machine scheduler HTTP ${response.status}: ${detail.slice(0, 1000)}`);
  }
  if (!parsed || typeof parsed !== "object") throw new Error("Machine scheduler returned an invalid response");
  const result = parseScheduleResult(parsed as Record<string, unknown>, kind, demand, weekDays, weightByCode, machineLockedOut);
  if (JSON.stringify(result.week_days) !== JSON.stringify(weekDays)) {
    throw new Error(`Machine scheduler echoed week_days=${JSON.stringify(result.week_days)} instead of ${JSON.stringify(weekDays)}`);
  }
  return result;
}

export async function runPlumbingSchedule(args: {
  month: string;
  workedSundayDates: string[];
  demandByKind: Record<PlumbingScheduleKind, PlumbingScheduleDemand[]>;
  weightByCode: Map<string, number>;
  machineLockedOut?: Map<string, boolean>;
}): Promise<PlumbingScheduleBatch> {
  const weekDays = buildPlumbingWeekDays(args.month, args.workedSundayDates);
  const allDemand = PLUMBING_SCHEDULE_KINDS.flatMap((kind) => args.demandByKind[kind]);
  if (allDemand.length === 0) throw new Error("Plumbing schedule demand is empty");
  for (const kind of PLUMBING_SCHEDULE_KINDS) {
    if (args.demandByKind[kind].length === 0) {
      throw new Error(`Plumbing ${kind} schedule demand is empty; refusing a one-sided run`);
    }
  }
  const materials = validateMaterials(allDemand);
  const unroutable: PlumbingScheduleBatch["unroutable"] = [];
  const sentDemandByKind: Record<PlumbingScheduleKind, PlumbingScheduleDemand[]> = {
    pipe: [...args.demandByKind.pipe],
    fitting: [...args.demandByKind.fitting],
  };
  const results: PlumbingScheduleResult[] = [];
  for (const kind of PLUMBING_SCHEDULE_KINDS) {
    while (true) {
      try {
        results.push(await callSchedule(
          args.month,
          weekDays,
          kind,
          sentDemandByKind[kind],
          args.weightByCode,
          args.machineLockedOut,
        ));
        break;
      } catch (error) {
        if (!(error instanceof UnroutableDemandError) || error.kind !== kind) throw error;
        const rejected = new Set(error.itemCodes);
        const retained = sentDemandByKind[kind].filter((item) => !rejected.has(item.item_code));
        let removed = 0;
        for (const item of sentDemandByKind[kind]) {
          if (rejected.has(item.item_code)) {
            removed++;
            unroutable.push({
              kind,
              item_code: item.item_code,
              material: item.material,
              qty_pcs: item.qty_pcs,
              reason: error.message,
            });
          }
        }
        if (removed === 0 || retained.length === 0) throw error;
        sentDemandByKind[kind] = retained;
        // The failed request was a validation preflight, not a schedule result.
        // Retry this kind without rows the upstream master explicitly cannot route.
      }
    }
  }
  const sentDemand = PLUMBING_SCHEDULE_KINDS.flatMap((kind) => sentDemandByKind[kind]);
  const demandPieces = sentDemand.reduce((sum, item) => sum + item.qty_pcs, 0);
  const demandKg = sentDemand.every((item) => args.weightByCode.has(item.item_code))
    ? sentDemand.reduce((sum, item) => sum + item.qty_pcs * (args.weightByCode.get(item.item_code) ?? 0), 0)
    : null;
  const unfinished = results.flatMap((result) => result.unfinished);
  const dataLimited = results.flatMap((result) => {
    const demandByCode = new Map(
      sentDemandByKind[result.kind].map((item) => [normalizeProductionCode(item.item_code), item]),
    );
    return result.data_limited.map((row) => {
      const submitted = demandByCode.get(normalizeProductionCode(row.item_code));
      return {
        kind: result.kind,
        item_code: row.item_code,
        material: String(row.material ?? submitted?.material ?? ""),
        qty_pcs: submitted?.qty_pcs ?? numberField(row.requested_pcs),
        reason: reasonText(row),
      };
    });
  });
  const scheduledPieces = results.reduce((sum, result) => sum + result.total_scheduled_pcs, 0);
  const dataLimitedPieces = results.reduce((sum, result) => sum + result.total_data_limited_pcs, 0);
  const dataLimitedKg = results.every((result) => result.total_data_limited_kg !== null)
    ? results.reduce((sum, result) => sum + (result.total_data_limited_kg ?? 0), 0)
    : null;
  const scheduledKg = demandKg === null
    ? null
    : Math.max(0, demandKg - (dataLimitedKg ?? 0) - unfinished.reduce((sum, row) => sum + numberField(row.remaining_kg), 0));
  const totalCapacity = results.reduce((sum, result) => sum + result.total_capacity_hrs, 0);
  const totalScheduledHours = results.reduce((sum, result) => sum + result.total_scheduled_hrs, 0);
  const totalIdleHours = results.reduce((sum, result) => sum + result.total_idle_hrs, 0);
  const totalDowntimeHours = results.reduce((sum, result) => sum + result.total_downtime_hours_lost, 0);
  const totalDowntimeMachineDays = results.reduce((sum, result) => sum + result.total_downtime_machine_days, 0);
  const unfinishedPcs = unfinished.reduce((sum, row) => sum + numberField(row.remaining_pcs), 0);
  const unfinishedKg = unfinished.reduce((sum, row) => sum + numberField(row.remaining_kg), 0);
  const unfinishedHours = unfinished.reduce((sum, row) => sum + numberField(row.remaining_hours), 0);

  return {
    batchId: randomUUID(),
    month: args.month,
    segment: "Plumbing",
    week_days: weekDays,
    worked_sunday_dates: [...new Set(args.workedSundayDates)].sort(),
    working_days_provenance: {
      total_days: weekDays.reduce((sum, days) => sum + days, 0),
      week_days: weekDays,
      worked_sunday_dates: [...new Set(args.workedSundayDates)].sort(),
      source: "sunday-aware-calendar",
    },
    materials,
    demand: { pieces: demandPieces, item_count: sentDemand.length, kg: demandKg },
    scheduled: { pieces: scheduledPieces, kg: scheduledKg, hours: totalScheduledHours },
    unfinished: { pieces: unfinishedPcs, kg: unfinishedKg, hours: unfinishedHours },
    capacity_hours: totalCapacity,
    idle_hours: totalIdleHours,
    downtime_hours_lost: totalDowntimeHours,
    downtime_machine_days: totalDowntimeMachineDays,
    unallocated_hours: totalCapacity - totalScheduledHours - totalIdleHours,
    unroutable,
    data_limited: dataLimited,
    data_limited_pieces: dataLimitedPieces,
    results,
    merged: {
      blocks: results.flatMap((result) => result.blocks),
      weekly_fill: results.flatMap((result) => result.weekly_fill),
      unfinished,
      data_limited: dataLimited,
      totals: {
        capacity_hrs: totalCapacity,
        scheduled_hrs: totalScheduledHours,
        idle_hrs: totalIdleHours,
        downtime_hours_lost: totalDowntimeHours,
        downtime_machine_days: totalDowntimeMachineDays,
        unallocated_hours: totalCapacity - totalScheduledHours - totalIdleHours,
        scheduled_pcs: scheduledPieces,
        scheduled_kg: scheduledKg,
        unfinished_pcs: unfinishedPcs,
        unfinished_kg: unfinishedKg,
        unfinished_hours: unfinishedHours,
        data_limited_pcs: dataLimitedPieces,
      },
    },
  };
}

function correctiveLocalWeek(block: Record<string, unknown>, weekDays: number[]): number {
  const explicitWeek = numberField(block.week);
  if (Number.isInteger(explicitWeek) && explicitWeek >= 1 && explicitWeek <= weekDays.length) {
    return explicitWeek;
  }
  const day = numberField(block.day);
  if (day > 0) {
    let cumulative = 0;
    for (let index = 0; index < weekDays.length; index += 1) {
      cumulative += weekDays[index] ?? 0;
      if (day <= cumulative) return index + 1;
    }
  }
  throw new Error("Machine scheduler returned a corrective block without a valid local week/day.");
}

function allocateCorrectiveWeeks(
  scheduledPieces: number,
  hours: [number, number, number, number],
  itemCode: string,
): [number, number, number, number] {
  if (scheduledPieces <= 0) return [0, 0, 0, 0];
  const totalHours = hours.reduce((sum, value) => sum + value, 0);
  if (totalHours <= 0) {
    throw new Error(`Scheduled Plumbing item ${itemCode} has no non-idle corrective machine-hour blocks.`);
  }
  const target = Math.round(scheduledPieces);
  const raw = hours.map((value) => target * value / totalHours);
  const result = raw.map(Math.floor);
  let remainder = target - result.reduce((sum, value) => sum + value, 0);
  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (const entry of order) {
    if (remainder <= 0) break;
    result[entry.index] += 1;
    remainder -= 1;
  }
  return result as [number, number, number, number];
}

type CorrectiveWeekBucket = {
  days: number;
  originalWeek: 1 | 2 | 3 | 4;
};

function expandCorrectiveWeekDays(
  weeks: PlumbingCorrectiveWeek[],
): { requestWeekDays: number[]; requestToOriginalWeek: Array<1 | 2 | 3 | 4> } | null {
  const buckets: CorrectiveWeekBucket[] = weeks.map((week) => ({
    days: week.workingDays,
    originalWeek: week.originalWeek,
  }));
  while (buckets.length < 4) {
    const splitIndex = [...buckets.keys()]
      .reverse()
      .find((index) => (buckets[index]?.days ?? 0) >= 2);
    if (splitIndex === undefined) return null;
    const bucket = buckets[splitIndex]!;
    const leftDays = Math.floor(bucket.days / 2);
    const rightDays = bucket.days - leftDays;
    buckets.splice(
      splitIndex,
      1,
      { days: leftDays, originalWeek: bucket.originalWeek },
      { days: rightDays, originalWeek: bucket.originalWeek },
    );
  }
  return {
    requestWeekDays: buckets.map((bucket) => bucket.days),
    requestToOriginalWeek: buckets.map((bucket) => bucket.originalWeek),
  };
}

/**
 * Run the machine scheduler for a corrective window.
 *
 * The external contract requires exactly four positive weekly values. A
 * corrective window can contain fewer original calendar weeks, so the final
 * open week is split into additional scheduler buckets while preserving the
 * total days and mapping every returned bucket back to its original week.
 */
export async function runPlumbingCorrectiveSchedule(args: {
  month: string;
  weeks: PlumbingCorrectiveWeek[];
  demandByKind: Record<PlumbingScheduleKind, PlumbingScheduleDemand[]>;
  weightByCode: Map<string, number>;
  machineLockedOut?: Map<string, boolean>;
}): Promise<PlumbingCorrectiveSchedule> {
  const originalWeeks = args.weeks.map((week) => week.originalWeek);
  const weekDays = args.weeks.map((week) => week.workingDays);
  const expandedCalendar = expandCorrectiveWeekDays(args.weeks);
  const subOnePieceExcluded: PlumbingCorrectiveSubOnePieceExclusion[] = [];
  const candidatePipeRows = args.demandByKind.pipe.length;
  const candidateFittingRows = args.demandByKind.fitting.length;
  const normalizeDemand = (kind: PlumbingScheduleKind): PlumbingScheduleDemand[] =>
    args.demandByKind[kind].flatMap((item) => {
      const roundedPieces = Math.round(item.qty_pcs);
      if (roundedPieces < 1) {
        subOnePieceExcluded.push({
          kind,
          item_code: item.item_code,
          material: item.material,
          remaining_pcs: item.qty_pcs,
          rounded_pcs: roundedPieces,
          reason: "SUB_ONE_PIECE_REMAINDER",
        });
        return [];
      }
      return [{ ...item, qty_pcs: roundedPieces }];
    });
  const filteredDemandByKind: Record<PlumbingScheduleKind, PlumbingScheduleDemand[]> = {
    pipe: normalizeDemand("pipe"),
    fitting: normalizeDemand("fitting"),
  };
  const payloadAudit = (): PlumbingCorrectivePayloadAudit => ({
    candidate_pipe_rows: candidatePipeRows,
    candidate_fitting_rows: candidateFittingRows,
    sent_pipe_rows: filteredDemandByKind.pipe.length,
    sent_fitting_rows: filteredDemandByKind.fitting.length,
    sub_one_piece_excluded_rows: subOnePieceExcluded.length,
    sub_one_piece_excluded_quantity: Math.round(
      subOnePieceExcluded.reduce((sum, item) => sum + item.remaining_pcs, 0) * 100,
    ) / 100,
    sub_one_piece_excluded: subOnePieceExcluded,
  });
  if (originalWeeks.length === 0) {
    return {
      batchId: randomUUID(),
      month: args.month,
      segment: "Plumbing",
      originalWeeks,
      weekOffset: 0,
      weekDays,
      payloadAudit: payloadAudit(),
      results: [],
      allocations: [],
      unroutable: [],
    };
  }
  if (weekDays.some((days) => !Number.isInteger(days) || days <= 0)) {
    throw new Error(`Corrective Plumbing scheduler requires positive week_days: ${weekDays.join(",")}`);
  }
  if (originalWeeks.some((week, index) => week !== originalWeeks[0]! + index)) {
    throw new Error(`Corrective Plumbing weeks must be contiguous: ${originalWeeks.join(",")}`);
  }
  if (!expandedCalendar) {
    return {
      batchId: randomUUID(),
      month: args.month,
      segment: "Plumbing",
      originalWeeks,
      weekOffset: originalWeeks[0]! - 1,
      weekDays,
      payloadAudit: payloadAudit(),
      results: [],
      allocations: [],
      unroutable: [],
    };
  }
  const requestWeekDays = expandedCalendar.requestWeekDays;

  const allDemand = PLUMBING_SCHEDULE_KINDS.flatMap((kind) => filteredDemandByKind[kind]);
  if (allDemand.length === 0) {
    return {
      batchId: randomUUID(),
      month: args.month,
      segment: "Plumbing",
      originalWeeks,
      weekOffset: originalWeeks[0]! - 1,
      weekDays,
      payloadAudit: payloadAudit(),
      results: [],
      allocations: [],
      unroutable: [],
    };
  }
  const materials = validateMaterials(allDemand);
  void materials;
  const unroutable: PlumbingScheduleBatch["unroutable"] = [];
  const sentDemandByKind: Record<PlumbingScheduleKind, PlumbingScheduleDemand[]> = {
    pipe: [...filteredDemandByKind.pipe],
    fitting: [...filteredDemandByKind.fitting],
  };
  const results: PlumbingScheduleResult[] = [];

  for (const kind of PLUMBING_SCHEDULE_KINDS) {
    while (sentDemandByKind[kind].length > 0) {
      try {
        results.push(await callSchedule(
          args.month,
          requestWeekDays,
          kind,
          sentDemandByKind[kind],
          args.weightByCode,
          args.machineLockedOut,
        ));
        break;
      } catch (error) {
        if (!(error instanceof UnroutableDemandError) || error.kind !== kind) throw error;
        const rejected = new Set(error.itemCodes);
        const retained = sentDemandByKind[kind].filter((item) => !rejected.has(item.item_code));
        if (retained.length === sentDemandByKind[kind].length) throw error;
        for (const item of sentDemandByKind[kind]) {
          if (rejected.has(item.item_code)) {
            unroutable.push({
              kind,
              item_code: item.item_code,
              material: item.material,
              qty_pcs: item.qty_pcs,
              reason: error.message,
            });
          }
        }
        sentDemandByKind[kind] = retained;
      }
    }
  }

  const unfinishedByCode = new Map<string, number>();
  const dataLimitedByCode = new Map<string, number>();
  const hoursByCode = new Map<string, [number, number, number, number]>();
  for (const result of results) {
    const demandByCode = new Map(
      sentDemandByKind[result.kind].map((item) => [normalizeProductionCode(item.item_code), item]),
    );
    for (const unfinished of result.unfinished) {
      const code = normalizeProductionCode(String(unfinished.item_code ?? ""));
      if (!code) continue;
      unfinishedByCode.set(code, (unfinishedByCode.get(code) ?? 0) + Math.max(0, numberField(unfinished.remaining_pcs)));
    }
    for (const dataLimited of result.data_limited) {
      const code = normalizeProductionCode(String(dataLimited.item_code ?? ""));
      if (!code) continue;
      const submitted = demandByCode.get(code);
      const quantity = submitted?.qty_pcs ?? numberField(dataLimited.requested_pcs);
      dataLimitedByCode.set(code, (dataLimitedByCode.get(code) ?? 0) + Math.max(0, quantity));
    }
    for (const raw of result.blocks) {
      if (!raw || typeof raw !== "object") continue;
      const block = raw as Record<string, unknown>;
      if (block.is_idle === true) continue;
      const code = normalizeProductionCode(String(block.item_code ?? block.raw_code ?? block.itemCode ?? ""));
      if (!code) continue;
      const localWeek = correctiveLocalWeek(block, requestWeekDays);
      const hours = Math.max(0, numberField(block.planned_hours ?? block.planned_hrs ?? block.hours));
      const values = hoursByCode.get(code) ?? [0, 0, 0, 0];
      values[expandedCalendar.requestToOriginalWeek[localWeek - 1]! - 1] += hours;
      hoursByCode.set(code, values);
    }
  }

  const allocations: PlumbingCorrectiveAllocation[] = [];
  for (const kind of PLUMBING_SCHEDULE_KINDS) {
    for (const demand of sentDemandByKind[kind]) {
      const demandCode = normalizeProductionCode(demand.item_code);
      const unfinishedPieces = Math.min(
        Math.max(0, demand.qty_pcs),
        unfinishedByCode.get(demandCode) ?? 0,
      );
      const dataLimitedPieces = Math.min(
        Math.max(0, demand.qty_pcs - unfinishedPieces),
        dataLimitedByCode.get(demandCode) ?? 0,
      );
      const scheduledPieces = Math.max(
        0,
        Math.round(demand.qty_pcs - unfinishedPieces - dataLimitedPieces),
      );
      const weeks = allocateCorrectiveWeeks(
        scheduledPieces,
        hoursByCode.get(demandCode) ?? [0, 0, 0, 0],
        demand.item_code,
      );
      allocations.push({
        itemCode: demand.item_code,
        scheduledPieces,
        unfinishedPieces,
        weeks,
      });
    }
  }

  return {
    batchId: randomUUID(),
    month: args.month,
    segment: "Plumbing",
    originalWeeks,
    weekOffset: originalWeeks[0]! - 1,
    weekDays,
    payloadAudit: payloadAudit(),
    results,
    allocations,
    unroutable,
  };
}