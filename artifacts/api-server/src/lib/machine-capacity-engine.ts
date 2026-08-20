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
 * Algorithm — PARTIAL ALLOCATION:
 *   Track residualPcs per item.  Each week, for every item whose desiredWeek ≤ w and
 *   residual > 0, find the best available machine and allocate as many pieces as the
 *   machine's remaining hours allow (min(residual, machineCapacity)).  Residual carries
 *   forward to the next week.  Items still with residual after W4 are unfulfillable.
 *
 * Weekly hours capacity:
 *   machine.workingDays (monthly total, configured per machine) is distributed
 *   proportionally across weeks using the calendar Mon–Sat day split.
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
  unfulfillable: { itemCode: string; category: string; pieces: number; bindingMachine: string | null }[];
}

/** Calendar Mon–Sat count for each week partition (W1=1–7, W2=8–14, W3=15–21, W4=22–end). */
function calendarWorkingDaysInWeek(year: number, month: number, weekNum: 1 | 2 | 3 | 4): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  const startDay = weekNum === 1 ? 1 : weekNum === 2 ? 8 : weekNum === 3 ? 15 : 22;
  const endDay = weekNum === 4 ? daysInMonth : startDay + 6;
  let count = 0;
  for (let d = startDay; d <= endDay; d++) {
    const date = new Date(year, month - 1, d);
    if (date.getUTCDay() !== 0) count++;
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
 *     (each week may be a PARTIAL fill; sum ≤ maxProduction)
 *   assignedMachineId — the machine that handled the first week's allocation
 *   machineWeek — the first week the item was partially or fully allocated
 *   machineUnfulfillable — true if residual remains after W4
 *
 * @param items         Plan items (with w1/w2/w3/w4 already set by annotateWeeklyRelease)
 * @param machines      Machine rows from DB (pre-filtered by segment)
 * @param month         "YYYY-MM" — used to compute week working-day distribution
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

  // ── Per-week capacity: distribute machine.workingDays proportionally by calendar split ──
  const calDays = new Map<WeekIdx, number>(
    WEEKS.map(w => [w, calendarWorkingDaysInWeek(year, mon, w)]),
  );
  const totalCalDays = WEEKS.reduce((s, w) => s + (calDays.get(w) ?? 0), 0) || 1;

  const hoursAvailable = (machine: PlumbingMachineCapacity, week: WeekIdx): number => {
    const fraction = (calDays.get(week) ?? 0) / totalCalDays;
    return machine.shiftsPerDay * machine.hoursPerShift * machine.workingDays * fraction;
  };

  // remaining[machineId][week] = hours still available this week
  const remaining: Map<string, Map<WeekIdx, number>> = new Map();
  for (const m of activeMachines) {
    const wkMap = new Map<WeekIdx, number>();
    for (const w of WEEKS) wkMap.set(w, hoursAvailable(m, w));
    remaining.set(m.machineId, wkMap);
  }

  // Initialise all machineW* to 0.
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

  // ── Residual tracking per item ─────────────────────────────────────────────
  const residualPcs = new Map<PlanItemForCascade, number>();

  for (const item of items) {
    const pool = getPoolForCategory(item.category);
    const kg   = item.weightKg ?? 0;

    if (pool === "SOLVENT" || kg === 0 || item.maxProduction <= 0) {
      // Unconstrained: copy desired weekly split directly.
      item.machineW1 = item.w1 ?? 0;
      item.machineW2 = item.w2 ?? 0;
      item.machineW3 = item.w3 ?? 0;
      item.machineW4 = item.w4 ?? 0;
      item.machineWeek = desiredWeek(item);
      continue;
    }

    residualPcs.set(item, item.maxProduction);
  }

  // ── Week-by-week partial allocation ───────────────────────────────────────
  for (const w of WEEKS) {
    // Items eligible this week: desiredWeek ≤ w AND still have residual.
    const eligible: PlanItemForCascade[] = [];
    for (const [item, rem] of residualPcs) {
      if (rem > 0 && desiredWeek(item) <= w) {
        eligible.push(item);
      }
    }

    // Sort by cover ascending (most urgent first).
    eligible.sort((a, b) => coverKey(a.cover) - coverKey(b.cover));

    for (const item of eligible) {
      let rem = residualPcs.get(item) ?? 0;
      if (rem <= 0) continue;

      const pool     = getPoolForCategory(item.category);
      const material = getMaterialFromCategory(item.category);
      const kg       = item.weightKg ?? 0;
      const kgPerPiece = kg / item.maxProduction; // > 0 (guarded above)

      const key = `machineW${w}` as "machineW1" | "machineW2" | "machineW3" | "machineW4";

      if (pool === "PIPE") {
        // Dedicated-first priority: iterate all eligible machines in order,
        // allocating as much as each can give before moving to the next.
        const eligible2 = pipeMachines.filter(m => material in (m.rates as Record<string, number>));
        const sorted = sortPipeMachines(eligible2, material);

        for (const m of sorted) {
          if (rem <= 0) break;
          const remHrs = remaining.get(m.machineId)?.get(w) ?? 0;
          if (remHrs <= 0) continue;
          const rate = (m.rates as Record<string, number>)[material]!;
          const maxPcs = Math.floor(remHrs * rate / kgPerPiece);
          const allocatePcs = Math.min(rem, maxPcs);
          if (allocatePcs <= 0) continue;

          item[key] = (item[key] ?? 0) + allocatePcs;
          if (!item.assignedMachineId) { item.assignedMachineId = m.machineId; item.machineWeek = w; }
          const hoursUsed = (allocatePcs * kgPerPiece) / rate;
          remaining.get(m.machineId)!.set(w, remHrs - hoursUsed);
          rem -= allocatePcs;
        }
      } else {
        // MOULDING: sort by most kg-capacity first; allocate from each until item is placed.
        const sorted = mouldMachines.slice().sort((a, b) => {
          const rateA = (a.rates as Record<string, number>)["ALL"] ?? 0;
          const rateB = (b.rates as Record<string, number>)["ALL"] ?? 0;
          const capA  = (remaining.get(a.machineId)?.get(w) ?? 0) * rateA;
          const capB  = (remaining.get(b.machineId)?.get(w) ?? 0) * rateB;
          return capB - capA;
        });

        for (const m of sorted) {
          if (rem <= 0) break;
          const rate = (m.rates as Record<string, number>)["ALL"] ?? 0;
          if (rate <= 0) continue;
          const remHrs = remaining.get(m.machineId)?.get(w) ?? 0;
          if (remHrs <= 0) continue;
          const maxPcs = Math.floor(remHrs * rate / kgPerPiece);
          const allocatePcs = Math.min(rem, maxPcs);
          if (allocatePcs <= 0) continue;

          item[key] = (item[key] ?? 0) + allocatePcs;
          if (!item.assignedMachineId) { item.assignedMachineId = m.machineId; item.machineWeek = w; }
          const hoursUsed = (allocatePcs * kgPerPiece) / rate;
          remaining.get(m.machineId)!.set(w, remHrs - hoursUsed);
          rem -= allocatePcs;
        }
      }

      // Update residual after trying all machines this week.
      residualPcs.set(item, rem);
    }
  }

  // ── After W4: items with remaining residual are unfulfillable ─────────────
  const unfulfillable: MachineCascadeResult["unfulfillable"] = [];

  for (const [item, rem] of residualPcs) {
    if (rem <= 0) continue;

    item.machineUnfulfillable = true;

    // bindingMachine = the most loaded machine for this material in W4
    // (the bottleneck that exhausted before this item was fully placed).
    const pool     = getPoolForCategory(item.category);
    const material = getMaterialFromCategory(item.category);
    let bindingMachine: string | null = null;

    if (pool === "PIPE") {
      const eligible2 = pipeMachines.filter(m => material in (m.rates as Record<string, number>));
      if (eligible2.length > 0) {
        bindingMachine = eligible2.reduce((best, m) => {
          const ra = remaining.get(best)?.get(4) ?? Infinity;
          const rb = remaining.get(m.machineId)?.get(4) ?? Infinity;
          return rb < ra ? m.machineId : best;
        }, eligible2[0]!.machineId);
      }
    } else if (pool === "MOULDING") {
      if (mouldMachines.length > 0) {
        bindingMachine = mouldMachines.reduce((best, m) => {
          const ra = remaining.get(best)?.get(4) ?? Infinity;
          const rb = remaining.get(m.machineId)?.get(4) ?? Infinity;
          return rb < ra ? m.machineId : best;
        }, mouldMachines[0]!.machineId);
      }
    }

    unfulfillable.push({ itemCode: item.itemCode, category: item.category, pieces: rem, bindingMachine });
  }

  // ── Compute utilisation stats ──────────────────────────────────────────────
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
