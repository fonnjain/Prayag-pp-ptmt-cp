import type { FrozenPlanRow } from "./excel-export";

type JsonObject = Record<string, unknown>;

export interface PersistedPlumbingScheduleRow {
  kind: "pipe" | "fitting";
  batchId: string;
  weekDays: number[];
  requestJson: JsonObject;
  resultJson: JsonObject;
}

export class PlumbingScheduleExportError extends Error {
  readonly code = "PLUMBING_SCHEDULE_EXPORT_RECONCILIATION_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "PlumbingScheduleExportError";
  }
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function asNumber(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function roundQuantity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function blockCode(block: JsonObject): string {
  return normalizeCode(block.item_code ?? block.raw_code ?? block.itemCode);
}

function blockWeek(block: JsonObject, weekDays: number[]): 1 | 2 | 3 | 4 {
  const explicitWeek = asNumber(block.week);
  const day = asNumber(block.day);
  let derivedWeek: number | null = null;
  if (day > 0) {
    let cumulative = 0;
    for (let index = 0; index < weekDays.length; index += 1) {
      cumulative += weekDays[index] ?? 0;
      if (day <= cumulative) {
        derivedWeek = index + 1;
        break;
      }
    }
  }
  if (explicitWeek >= 1 && explicitWeek <= 4) {
    if (derivedWeek !== null && explicitWeek !== derivedWeek) {
      throw new PlumbingScheduleExportError(
        `Scheduler block for ${blockCode(block) || "unknown item"} echoed week=${explicitWeek} ` +
        `but day=${day} belongs to week ${derivedWeek} under week_days=[${weekDays.join(",")}].`,
      );
    }
    return explicitWeek as 1 | 2 | 3 | 4;
  }
  if (derivedWeek !== null && derivedWeek <= 4) return derivedWeek as 1 | 2 | 3 | 4;
  throw new PlumbingScheduleExportError(
    `Scheduler block for ${blockCode(block) || "unknown item"} has no valid week/day boundary.`,
  );
}

function requestCodes(row: PersistedPlumbingScheduleRow): Set<string> {
  const demand = asArray(row.requestJson.demand);
  return new Set(
    demand
      .map(asObject)
      .filter((item): item is JsonObject => item !== null)
      .map((item) => normalizeCode(item.item_code ?? item.itemCode)),
  );
}

function addUnfinished(
  target: Map<string, number>,
  resultJson: JsonObject,
): void {
  for (const raw of asArray(resultJson.unfinished)) {
    const row = asObject(raw);
    if (!row) continue;
    const code = normalizeCode(row.item_code ?? row.raw_code ?? row.itemCode);
    if (!code) continue;
    target.set(code, (target.get(code) ?? 0) + Math.max(0, asNumber(row.remaining_pcs)));
  }
}

function addBlockHours(
  target: Map<string, [number, number, number, number]>,
  row: PersistedPlumbingScheduleRow,
): void {
  for (const raw of asArray(row.resultJson.blocks)) {
    const block = asObject(raw);
    if (!block || block.is_idle === true) continue;
    const code = blockCode(block);
    if (!code) continue;
    const week = blockWeek(block, row.weekDays);
    const hours = Math.max(0, asNumber(block.planned_hours ?? block.planned_hrs ?? block.hours));
    const weekly = target.get(code) ?? [0, 0, 0, 0];
    weekly[week - 1] += hours;
    target.set(code, weekly);
  }
}

function allocateByBlockHours(total: number, hours: [number, number, number, number], code: string): [number, number, number, number] {
  const totalHours = hours.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [0, 0, 0, 0];
  if (totalHours <= 0) {
    throw new PlumbingScheduleExportError(
      `Scheduled Plumbing item ${code} has no non-idle machine-hour blocks to allocate by week.`,
    );
  }
  // Allocate in milli-pieces with a largest-remainder pass. Rounding each
  // week's floating-point share independently can make the final residual
  // negative by a few thousandths, which would make a valid schedule
  // impossible to export.
  const targetUnits = Math.round(total * 1000);
  const rawUnits = hours.map((value) => targetUnits * value / totalHours);
  const units = rawUnits.map(Math.floor);
  let remaining = targetUnits - units.reduce((sum, value) => sum + value, 0);
  const remainderOrder = rawUnits
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let index = 0; index < remainderOrder.length && remaining > 0; index += 1) {
    units[remainderOrder[index]!.index] += 1;
    remaining -= 1;
  }
  const allocation = units.map((value) => value / 1000) as [number, number, number, number];
  if (allocation.some((value) => value < 0) || units.reduce((sum, value) => sum + value, 0) !== targetUnits) {
    throw new PlumbingScheduleExportError(`Weekly allocation failed for Plumbing item ${code}.`);
  }
  return allocation;
}

function scheduleRowsByKind(
  schedules: PersistedPlumbingScheduleRow[],
): Map<"pipe" | "fitting", PersistedPlumbingScheduleRow> {
  const byKind = new Map<"pipe" | "fitting", PersistedPlumbingScheduleRow>();
  for (const row of schedules) {
    const previous = byKind.get(row.kind);
    if (previous && previous.batchId !== row.batchId) {
      throw new PlumbingScheduleExportError(
        `Plumbing schedule results are split across batches ${previous.batchId} and ${row.batchId}; ` +
        "refusing to merge non-atomic scheduler runs.",
      );
    }
    byKind.set(row.kind, row);
  }
  if (!byKind.has("pipe") || !byKind.has("fitting")) {
    throw new PlumbingScheduleExportError(
      "A finalized Plumbing export requires both pipe and fitting scheduler results.",
    );
  }
  return byKind;
}

/**
 * Convert the persisted machine schedule into the common frozen export row
 * shape. The upstream blocks carry hours, not quantities, so the scheduler's
 * item-level scheduled pieces are conserved and distributed by that item's
 * non-idle block-hour share in each echoed week. Solvents are intentionally
 * outside the machine app and remain unconstrained pass-through demand.
 */
export function applyPlumbingScheduleToFrozenRows(
  rows: FrozenPlanRow[],
  schedules: PersistedPlumbingScheduleRow[],
): FrozenPlanRow[] {
  const byKind = scheduleRowsByKind(schedules);
  const sentByCode = new Map<string, Set<string>>();
  const unfinishedByCode = new Map<string, number>();
  const hoursByCode = new Map<string, [number, number, number, number]>();

  for (const kind of ["pipe", "fitting"] as const) {
    const schedule = byKind.get(kind)!;
    sentByCode.set(kind, requestCodes(schedule));
    addUnfinished(unfinishedByCode, schedule.resultJson);
    addBlockHours(hoursByCode, schedule);
  }

  return rows.map((row) => {
    const originalPlan = Math.max(0, row.productionPlan);
    const isSolvent = row.category.endsWith("Solvent");
    if (isSolvent) {
      return {
        ...row,
        productionPlan: originalPlan,
        cannotBeMade: 0,
        releaseWeek: originalPlan > 0 ? 1 : null,
        w1: originalPlan,
        w2: 0,
        w3: 0,
        w4: 0,
      };
    }

    const isPipe = row.category.endsWith("Pipe");
    const isFitting = row.category.endsWith("Fitting");
    if (!isPipe && !isFitting) {
      throw new PlumbingScheduleExportError(
        `Plumbing item ${row.itemCode} is in unsupported export category "${row.category}".`,
      );
    }
    const kind = isPipe ? "pipe" : "fitting";
    const code = normalizeCode(row.itemCode);
    const sent = sentByCode.get(kind)!.has(code);
    const unfinished = sent ? Math.min(originalPlan, unfinishedByCode.get(code) ?? 0) : originalPlan;
    const scheduled = roundQuantity(Math.max(0, originalPlan - unfinished));
    const weeks = sent
      ? allocateByBlockHours(scheduled, hoursByCode.get(code) ?? [0, 0, 0, 0], code)
      : [0, 0, 0, 0] as [number, number, number, number];

    if (roundQuantity(weeks[0] + weeks[1] + weeks[2] + weeks[3]) !== scheduled) {
      throw new PlumbingScheduleExportError(
        `Plumbing item ${row.itemCode} failed weekly conservation: ` +
        `W1..W4=${weeks.reduce((sum, value) => sum + value, 0)} scheduled=${scheduled}.`,
      );
    }
    return {
      ...row,
      productionPlan: scheduled,
      cannotBeMade: roundQuantity(Math.max(0, originalPlan - scheduled)),
      releaseWeek: scheduled > 0 ? (weeks.findIndex((value) => value > 0) + 1 || null) as 1 | 2 | 3 | 4 : null,
      w1: weeks[0],
      w2: weeks[1],
      w3: weeks[2],
      w4: weeks[3],
    };
  });
}