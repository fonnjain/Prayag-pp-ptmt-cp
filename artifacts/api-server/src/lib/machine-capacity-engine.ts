/**
 * Machine-capacity-constrained weekly release for Plumbing.
 *
 * The engine RE-TIMES when items are released across W1–W4 but never changes
 * the total production quantity for any item.
 *
 * Pool routing:
 *   category ends in "Pipe"    → PIPE pool   (9 machines; 2 locked out)
 *   category ends in "Fitting" → MOULDING pool (24 machines)
 *   category ends in "Solvent" → unconstrained (pass-through)
 *
 * PIPE machine priority order (for a given material):
 *   1. Dedicated machines (only carry one material in their rates map)
 *   2. Flex machines (carry multiple materials)
 *   Within each tier: machine ID ascending.
 *
 * AGRI Pipe has no dedicated machine — only flex machines (MC3, MC4, MC5).
 *
 * Items with noBomWeight=true or weightKg=0 are unconstrained (no kg to schedule).
 *
 * Algorithm:
 *   For W1→W4, collect items whose desiredWeek ≤ currentWeek plus spillover.
 *   Sort by cover ascending (lowest cover = most urgent first; "OS" treated as ∞).
 *   For each item find a machine with enough hours remaining; if none → spill.
 *   Items that cannot fit after W4 → unfulfillable (machineW1–W4 remain 0).
 */

import type { PlumbingMachineCapacity } from "@workspace/db";
import type { CalcPlanItem } from "./calc";

export type PlanItemForCascade = CalcPlanItem & {
  weightKg?: number;
  noBomWeight?: boolean;
  machineW1: number;
  machineW2: number;
  machineW3: number;
  machineW4: number;
  assignedMachineId: string | null;
  machineWeek: 1 | 2 | 3 | 4 | null;
  machineUnfulfillable: boolean;
};

export interface MachineWeekUtilisation {
  machineId: string;
  pool: string;
  label: string | null;
  week: number;
  hoursUsed: number;
  hoursAvailable: number;
  utilisationPct: number;
}

export interface MachineCascadeResult {
  utilisation: MachineWeekUtilisation[];
  unfulfillable: { itemCode: string; category: string; pieces: number }[];
}

function workingDaysInWeek(year: number, month: number, weekNum: 1 | 2 | 3 | 4): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDay = weekNum === 1 ? 1 : weekNum === 2 ? 8 : weekNum === 3 ? 15 : 22;
  const endDay = weekNum === 4 ? daysInMonth : startDay + 6;
  let count = 0;
  for (let d = startDay; d <= endDay; d++) {
    const date = new Date(year, month - 1, d);
    if (date.getDay() !== 0) count++;
  }
  return count;
}

function coverKey(cover: number | "OS"): number {
  return cover === "OS" ? Infinity : cover;
}

function getPoolForCategory(category: string): "PIPE" | "MOULDING" | "SOLVENT" {
  if (category.endsWith("Pipe"))    return "PIPE";
  if (category.endsWith("Fitting")) return "MOULDING";
  return "SOLVENT";
}

function getMaterialFromCategory(category: string): string {
  return category.split(" ")[0] ?? "";
}

/**
 * A machine is "dedicated" for a material if it carries only that one material in its rates.
 */
function isDedicatedFor(machine: PlumbingMachineCapacity, material: string): boolean {
  const keys = Object.keys(machine.rates as Record<string, number>);
  return keys.length === 1 && keys[0] === material;
}

/**
 * Sort pipe-pool candidates for a given material:
 *   1. Dedicated machines first (have only this material), sorted by machineId asc.
 *   2. Flex machines second, sorted by machineId asc.
 */
function sortPipeMachines(
  machines: PlumbingMachineCapacity[],
  material: string,
): PlumbingMachineCapacity[] {
  return machines.slice().sort((a, b) => {
    const aDedicated = isDedicatedFor(a, material) ? 0 : 1;
    const bDedicated = isDedicatedFor(b, material) ? 0 : 1;
    if (aDedicated !== bDedicated) return aDedicated - bDedicated;
    return a.machineId.localeCompare(b.machineId);
  });
}

/**
 * Run the machine-capacity cascade over Plumbing plan items.
 *
 * Mutates each item in-place, adding:
 *   machineW1, machineW2, machineW3, machineW4 — machine-feasible release quantities
 *   assignedMachineId — the machine ID (null = unconstrained or unfulfillable)
 *   machineWeek — the week the item was assigned (null if unfulfillable)
 *   machineUnfulfillable — true if no slot was found across all 4 weeks
 *
 * @param items         Plan items (with w1/w2/w3/w4 already set by annotateWeeklyRelease)
 * @param machines      Machine rows from DB
 * @param month         "YYYY-MM" — used to compute week working-day counts
 * @returns             Utilisation array + unfulfillable list
 */
export function runMachineCascade(
  items: PlanItemForCascade[],
  machines: PlumbingMachineCapacity[],
  month: string,
): MachineCascadeResult {
  const [yearStr, monthStr] = month.split("-");
  const year  = parseInt(yearStr ?? "2026", 10);
  const mon   = parseInt(monthStr ?? "7", 10);

  const activeMachines = machines.filter(m => !m.lockedOut);

  const pipeMachines    = activeMachines.filter(m => m.pool === "PIPE");
  const mouldMachines   = activeMachines.filter(m => m.pool === "MOULDING");

  type WeekIdx = 1 | 2 | 3 | 4;
  const WEEKS: WeekIdx[] = [1, 2, 3, 4];

  const workingDays = new Map<WeekIdx, number>(
    WEEKS.map(w => [w, workingDaysInWeek(year, mon, w)]),
  );

  const hoursAvailable = (machine: PlumbingMachineCapacity, week: WeekIdx): number =>
    machine.shiftsPerDay * machine.hoursPerShift * (workingDays.get(week) ?? 0);

  const remaining: Map<string, Map<WeekIdx, number>> = new Map();
  for (const m of activeMachines) {
    const wkMap = new Map<WeekIdx, number>();
    for (const w of WEEKS) wkMap.set(w, hoursAvailable(m, w));
    remaining.set(m.machineId, wkMap);
  }

  for (const item of items) {
    item.machineW1 = 0;
    item.machineW2 = 0;
    item.machineW3 = 0;
    item.machineW4 = 0;
    item.assignedMachineId = null;
    item.machineWeek = null;
    item.machineUnfulfillable = false;
  }

  const desiredWeek = (item: PlanItemForCascade): WeekIdx =>
    (item.week ?? 4) as WeekIdx;

  const qtyForItem = (item: PlanItemForCascade): number => item.maxProduction;

  const pendingByWeek = new Map<WeekIdx, PlanItemForCascade[]>(
    WEEKS.map(w => [w, []]),
  );
  for (const item of items) {
    if (item.maxProduction <= 0) {
      item.machineWeek = desiredWeek(item);
      const key = `machineW${item.machineWeek}` as "machineW1"|"machineW2"|"machineW3"|"machineW4";
      item[key] = item.maxProduction;
      continue;
    }
    pendingByWeek.get(desiredWeek(item))!.push(item);
  }

  const spillover: PlanItemForCascade[] = [];
  const unfulfillable: { itemCode: string; category: string; pieces: number }[] = [];

  for (const w of WEEKS) {
    const bucket = [...spillover, ...(pendingByWeek.get(w) ?? [])];
    spillover.length = 0;

    bucket.sort((a, b) => coverKey(a.cover) - coverKey(b.cover));

    for (const item of bucket) {
      const pool     = getPoolForCategory(item.category);
      const material = getMaterialFromCategory(item.category);
      const kg       = item.weightKg ?? 0;

      if (pool === "SOLVENT" || kg === 0) {
        item.machineWeek = w;
        const key = `machineW${w}` as "machineW1"|"machineW2"|"machineW3"|"machineW4";
        item[key] = qtyForItem(item);
        continue;
      }

      let assigned = false;

      if (pool === "PIPE") {
        const eligible = pipeMachines.filter(m => {
          const r = m.rates as Record<string, number>;
          return material in r;
        });
        const sorted = sortPipeMachines(eligible, material);

        for (const machine of sorted) {
          const rate = (machine.rates as Record<string, number>)[material]!;
          const hoursNeeded = kg / rate;
          const rem = remaining.get(machine.machineId)!;
          if ((rem.get(w) ?? 0) >= hoursNeeded) {
            rem.set(w, (rem.get(w) ?? 0) - hoursNeeded);
            item.assignedMachineId = machine.machineId;
            item.machineWeek = w;
            const key = `machineW${w}` as "machineW1"|"machineW2"|"machineW3"|"machineW4";
            item[key] = qtyForItem(item);
            assigned = true;
            break;
          }
        }
      } else {
        const sorted = mouldMachines.slice().sort((a, b) => {
          const ra = remaining.get(a.machineId)!.get(w) ?? 0;
          const rb = remaining.get(b.machineId)!.get(w) ?? 0;
          return rb - ra;
        });

        for (const machine of sorted) {
          const rate = (machine.rates as Record<string, number>)["ALL"] ?? 0;
          if (rate <= 0) continue;
          const hoursNeeded = kg / rate;
          const rem = remaining.get(machine.machineId)!;
          if ((rem.get(w) ?? 0) >= hoursNeeded) {
            rem.set(w, (rem.get(w) ?? 0) - hoursNeeded);
            item.assignedMachineId = machine.machineId;
            item.machineWeek = w;
            const key = `machineW${w}` as "machineW1"|"machineW2"|"machineW3"|"machineW4";
            item[key] = qtyForItem(item);
            assigned = true;
            break;
          }
        }
      }

      if (!assigned) {
        if (w < 4) {
          spillover.push(item);
        } else {
          item.machineUnfulfillable = true;
          unfulfillable.push({ itemCode: item.itemCode, category: item.category, pieces: qtyForItem(item) });
        }
      }
    }
  }

  const utilisation: MachineWeekUtilisation[] = [];
  const machById = new Map(activeMachines.map(m => [m.machineId, m]));

  for (const [machineId, wkMap] of remaining) {
    const machine = machById.get(machineId)!;
    for (const w of WEEKS) {
      const avail = hoursAvailable(machine, w);
      const used  = avail - (wkMap.get(w) ?? 0);
      utilisation.push({
        machineId,
        pool: machine.pool,
        label: machine.label ?? null,
        week: w,
        hoursUsed: Math.round(used * 10) / 10,
        hoursAvailable: Math.round(avail * 10) / 10,
        utilisationPct: avail > 0 ? Math.round((used / avail) * 1000) / 10 : 0,
      });
    }
  }

  utilisation.sort((a, b) => {
    if (a.pool !== b.pool) return a.pool.localeCompare(b.pool);
    if (a.machineId !== b.machineId) return a.machineId.localeCompare(b.machineId);
    return a.week - b.week;
  });

  return { utilisation, unfulfillable };
}
