import type { MachineMonthRecord, TotalCountBasis } from "./report5";
import {
  calendarDates,
  countCalendarWorkingDays,
  countWorkingDaysInMonth as countCanonicalWorkingDaysInMonth,
  isSunday,
} from "./working-days";

export interface CalendarModel {
  workingDays: number;
  elapsed: number;
  remaining: number;
}

/** Counts working days (non-Sunday) from the 1st of the month through `throughDateIso` inclusive. */
export function countWorkingDaysElapsed(month: string, throughDateIso: string | null): number {
  if (!throughDateIso) return 0;
  const throughDay = Number(throughDateIso.slice(8, 10));
  return countCalendarWorkingDays(month, throughDay);
}

/** Calendar fallback when a plant has not configured the month explicitly. */
export function countWorkingDaysInMonth(month: string): number {
  return countWorkingDaysInMonthCanonical(month);
}

function countWorkingDaysInMonthCanonical(month: string): number {
  return countCanonicalWorkingDaysInMonth(month);
}

export { calendarDates, isSunday };

export function buildCalendarModel(workingDays: number, elapsed: number): CalendarModel {
  return { workingDays, elapsed, remaining: Math.max(workingDays - elapsed, 0) };
}

export interface ItemWeightMap {
  get(itemCode: string, colour: string): number | null;
}

export interface PlanItemForMonitoring {
  itemCode: string;
  colour: string;
  category: string;
  minProduction: number;
  maxProduction: number;
  stock: number;
  pendingOrder: number;
}

export interface TargetConversionResult {
  targetKgByCategory: Map<string, number>;
  floorKgByCategory: Map<string, number>;
  plantTargetKg: number;
  plantFloorKg: number;
  needsReviewItems: { itemCode: string; colour: string; category: string }[];
}

/** Rule 1 (unit): converts piece targets to kg using per-item weight; items with no weight are excluded and flagged. */
export function convertTargetsToKg(
  items: PlanItemForMonitoring[],
  weights: ItemWeightMap,
): TargetConversionResult {
  const targetKgByCategory = new Map<string, number>();
  const floorKgByCategory = new Map<string, number>();
  const needsReviewItems: { itemCode: string; colour: string; category: string }[] = [];
  let plantTargetKg = 0;
  let plantFloorKg = 0;

  for (const item of items) {
    const weight = weights.get(item.itemCode, item.colour);
    if (weight === null || weight === undefined) {
      needsReviewItems.push({ itemCode: item.itemCode, colour: item.colour, category: item.category });
      continue;
    }
    const targetKg = item.maxProduction * weight;
    const floorKg = item.minProduction * weight;
    targetKgByCategory.set(item.category, (targetKgByCategory.get(item.category) ?? 0) + targetKg);
    floorKgByCategory.set(item.category, (floorKgByCategory.get(item.category) ?? 0) + floorKg);
    plantTargetKg += targetKg;
    plantFloorKg += floorKg;
  }

  return { targetKgByCategory, floorKgByCategory, plantTargetKg, plantFloorKg, needsReviewItems };
}

/**
 * Piece-based alternative to convertTargetsToKg.
 *
 * Used for segments that have no BOM weight data (PTMT), so the plan target
 * is expressed in pieces rather than kg.  needsReviewItems is always empty
 * because no weight lookup is performed.
 */
export function convertTargetsToPcs(items: PlanItemForMonitoring[]): {
  targetPcsByCategory: Map<string, number>;
  floorPcsByCategory: Map<string, number>;
  plantTargetPcs: number;
  plantFloorPcs: number;
} {
  const targetPcsByCategory = new Map<string, number>();
  const floorPcsByCategory = new Map<string, number>();
  let plantTargetPcs = 0;
  let plantFloorPcs = 0;
  for (const item of items) {
    targetPcsByCategory.set(item.category, (targetPcsByCategory.get(item.category) ?? 0) + item.maxProduction);
    floorPcsByCategory.set(item.category, (floorPcsByCategory.get(item.category) ?? 0) + item.minProduction);
    plantTargetPcs += item.maxProduction;
    plantFloorPcs += item.minProduction;
  }
  return { targetPcsByCategory, floorPcsByCategory, plantTargetPcs, plantFloorPcs };
}

export interface PaceMetrics {
  targetKg: number;
  outputToDateKg: number;
  requiredPerDay: number;
  expectedCumulative: number;
  paceIndex: number | null;
  actualPerDay: number | null;
  projectedMonthEnd: number | null;
  projectedAttainmentPct: number | null;
  daysAheadBehind: number | null;
  catchUpPerDay: number | null;
  catchUpVsPlanPct: number | null;
  attainmentPct: number | null;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Core formulas per build-spec §6. Returns null (never 0) for ratios that cannot be computed. */
export function computePaceMetrics(targetKg: number, outputToDateKg: number, calendar: CalendarModel): PaceMetrics {
  const { workingDays, elapsed, remaining } = calendar;
  const requiredPerDay = workingDays > 0 ? targetKg / workingDays : 0;
  const expectedCumulative = requiredPerDay * elapsed;

  const attainmentPct = targetKg > 0 ? round2((outputToDateKg / targetKg) * 100) : null;
  const paceIndex = expectedCumulative > 0 ? round2((outputToDateKg / expectedCumulative) * 100) : null;
  const actualPerDay = elapsed > 0 ? outputToDateKg / elapsed : null;
  const projectedMonthEnd = actualPerDay !== null ? round2(actualPerDay * workingDays) : null;
  const projectedAttainmentPct =
    projectedMonthEnd !== null && targetKg > 0 ? round2((projectedMonthEnd / targetKg) * 100) : null;
  const daysAheadBehind =
    requiredPerDay > 0 ? round2((outputToDateKg - expectedCumulative) / requiredPerDay) : null;
  const catchUpPerDay = remaining > 0 ? round2((targetKg - outputToDateKg) / remaining) : null;
  const catchUpVsPlanPct =
    catchUpPerDay !== null && requiredPerDay > 0 ? round2((catchUpPerDay / requiredPerDay) * 100) : null;

  return {
    targetKg: round2(targetKg),
    outputToDateKg: round2(outputToDateKg),
    requiredPerDay: round2(requiredPerDay),
    expectedCumulative: round2(expectedCumulative),
    paceIndex,
    actualPerDay: actualPerDay !== null ? round2(actualPerDay) : null,
    projectedMonthEnd,
    projectedAttainmentPct,
    daysAheadBehind,
    catchUpPerDay,
    catchUpVsPlanPct,
    attainmentPct,
  };
}

export type RagBand = "green" | "amber" | "red";

export function ragBand(pct: number | null): RagBand | null {
  if (pct === null) return null;
  if (pct >= 85) return "green";
  if (pct >= 60) return "amber";
  return "red";
}

export interface MachineQuality {
  machineId: string;
  isGrinder: boolean;
  runHours: number;
  idealHours: number | null;
  utilisationPct: number | null;
  outputKg: number;
  rejectionKg: number | null;
  rejectionPct: number | null;
  totalCountBasis: TotalCountBasis;
  goodOutputKg: number | null;
}

export function computeMachineQuality(machine: MachineMonthRecord, idealHoursOverride?: number): MachineQuality {
  const idealHours = idealHoursOverride ?? machine.idealHours;
  const utilisationPct =
    idealHours !== null && idealHours > 0 ? round2((machine.totalRunHours / idealHours) * 100) : null;
  const goodOutputKg = machine.rejectionKg !== null ? round2(machine.totalOutputKg - machine.rejectionKg) : null;
  const rejectionDenominator =
    machine.total_count_basis === "net" ? goodOutputKg : machine.totalOutputKg;
  const rejectionPct =
    machine.rejectionKg !== null && rejectionDenominator !== null && rejectionDenominator > 0
      ? round2((machine.rejectionKg / rejectionDenominator) * 100)
      : null;

  return {
    machineId: machine.machineId,
    isGrinder: machine.isGrinder,
    runHours: machine.totalRunHours,
    idealHours,
    utilisationPct,
    outputKg: machine.totalOutputKg,
    rejectionKg: machine.rejectionKg,
    rejectionPct,
    totalCountBasis: machine.total_count_basis,
    goodOutputKg,
  };
}

export interface WarningThresholds {
  behindPaceHigh: number;
  behindPaceCritical: number;
  catchupInfeasibleRatio: number;
  stockoutDaysCover: number;
  noProductionDays: number;
  highRejectionHigh: number;
  highRejectionCritical: number;
  lowUtilisation: number;
  backlogAgedDays: number;
}

export const DEFAULT_WARNING_THRESHOLDS: WarningThresholds = {
  behindPaceHigh: 90,
  behindPaceCritical: 75,
  catchupInfeasibleRatio: 1.3,
  stockoutDaysCover: 7,
  noProductionDays: 3,
  highRejectionHigh: 5,
  highRejectionCritical: 10,
  lowUtilisation: 60,
  backlogAgedDays: 30,
};

export type WarningSeverity = "info" | "medium" | "high" | "critical";

export interface Warning {
  code: string;
  severity: WarningSeverity;
  scope: string;
  message: string;
  value: number | null;
  threshold: number | null;
  source: string;
}

export interface CategoryPace {
  category: string;
  pace: PaceMetrics;
}

export function buildBehindPaceAndWillMissWarnings(
  scope: string,
  pace: PaceMetrics,
  thresholds: WarningThresholds,
): Warning[] {
  const warnings: Warning[] = [];
  if (pace.paceIndex !== null) {
    if (pace.paceIndex < thresholds.behindPaceCritical) {
      warnings.push({
        code: "BEHIND_PACE",
        severity: "critical",
        scope,
        message: `${scope} pace index ${pace.paceIndex}% is critically behind plan`,
        value: pace.paceIndex,
        threshold: thresholds.behindPaceCritical,
        source: "velocity",
      });
    } else if (pace.paceIndex < thresholds.behindPaceHigh) {
      warnings.push({
        code: "BEHIND_PACE",
        severity: "high",
        scope,
        message: `${scope} pace index ${pace.paceIndex}% is behind plan`,
        value: pace.paceIndex,
        threshold: thresholds.behindPaceHigh,
        source: "velocity",
      });
    }
  }
  if (pace.projectedAttainmentPct !== null && pace.projectedAttainmentPct < 100) {
    const gap = 100 - pace.projectedAttainmentPct;
    const severity: WarningSeverity = gap > 25 ? "critical" : gap > 10 ? "high" : "medium";
    warnings.push({
      code: "WILL_MISS",
      severity,
      scope,
      message: `${scope} projected to reach only ${pace.projectedAttainmentPct}% of target`,
      value: pace.projectedAttainmentPct,
      threshold: 100,
      source: "velocity",
    });
  }
  if (pace.catchUpVsPlanPct !== null && pace.catchUpVsPlanPct > thresholds.catchupInfeasibleRatio * 100) {
    warnings.push({
      code: "CATCHUP_INFEASIBLE",
      severity: "critical",
      scope,
      message: `${scope} catch-up/day is ${pace.catchUpVsPlanPct}% of required/day — re-planning needed`,
      value: pace.catchUpVsPlanPct,
      threshold: thresholds.catchupInfeasibleRatio * 100,
      source: "velocity",
    });
  }
  return warnings;
}

export function buildQualityWarnings(machines: MachineQuality[], thresholds: WarningThresholds): Warning[] {
  const warnings: Warning[] = [];
  for (const m of machines) {
    if (m.isGrinder) continue;
    const rejectionMeaning = m.totalCountBasis === "net"
      ? "rejects ÷ good output"
      : "rejects ÷ total manufactured";
    if (m.rejectionPct !== null) {
      if (m.rejectionPct > thresholds.highRejectionCritical) {
        warnings.push({
          code: "HIGH_REJECTION",
          severity: "critical",
          scope: m.machineId,
          message: `${m.machineId} rejection ${m.rejectionPct}% (${rejectionMeaning}) exceeds critical threshold`,
          value: m.rejectionPct,
          threshold: thresholds.highRejectionCritical,
          source: "quality",
        });
      } else if (m.rejectionPct > thresholds.highRejectionHigh) {
        warnings.push({
          code: "HIGH_REJECTION",
          severity: "high",
          scope: m.machineId,
          message: `${m.machineId} rejection ${m.rejectionPct}% (${rejectionMeaning}) exceeds threshold`,
          value: m.rejectionPct,
          threshold: thresholds.highRejectionHigh,
          source: "quality",
        });
      }
    }
    if (m.utilisationPct !== null && m.utilisationPct < thresholds.lowUtilisation) {
      warnings.push({
        code: "LOW_UTILISATION",
        severity: "medium",
        scope: m.machineId,
        message: `${m.machineId} utilisation ${m.utilisationPct}% is below target`,
        value: m.utilisationPct,
        threshold: thresholds.lowUtilisation,
        source: "quality",
      });
    }
    if (m.idealHours === null) {
      warnings.push({
        code: "DATA_MISSING",
        severity: "info",
        scope: m.machineId,
        message: `${m.machineId} has no ideal-hours baseline — needs review`,
        value: null,
        threshold: null,
        source: "quality",
      });
    }
  }
  return warnings;
}

export interface StockoutCandidate {
  itemCode: string;
  colour: string;
  category: string;
  stock: number;
  pendingOrder: number;
}

export function buildStockoutWarnings(items: StockoutCandidate[]): Warning[] {
  return items
    .filter((i) => i.stock < i.pendingOrder)
    .map((i) => ({
      code: "STOCKOUT_RISK",
      severity: "high" as WarningSeverity,
      scope: `${i.itemCode}${i.colour ? " / " + i.colour : ""}`,
      message: `${i.itemCode} stock (${i.stock}) is below pending orders (${i.pendingOrder})`,
      value: i.stock,
      threshold: i.pendingOrder,
      source: "backlog",
    }));
}

export interface RecommendedAction {
  priority: number;
  code: string;
  scope: string;
  message: string;
  suggestedQty: number | null;
}

export function buildRecommendedActions(
  plantPace: PaceMetrics,
  categoryPaces: CategoryPace[],
  stockoutItems: StockoutCandidate[],
  thresholds: WarningThresholds,
): RecommendedAction[] {
  const actions: RecommendedAction[] = [];

  if (plantPace.paceIndex !== null && plantPace.paceIndex < thresholds.behindPaceHigh) {
    actions.push({
      priority: 1,
      code: "BEHIND_PACE",
      scope: "Plant",
      message: `Increase priority / add overtime — catch-up ${plantPace.catchUpPerDay ?? "n/a"} kg/day needed`,
      suggestedQty: plantPace.catchUpPerDay,
    });
  }

  const over = categoryPaces.filter((c) => (c.pace.projectedAttainmentPct ?? 0) > 110);
  const under = categoryPaces.filter(
    (c) => c.pace.projectedAttainmentPct !== null && c.pace.projectedAttainmentPct < 90,
  );
  for (const u of under) {
    const donor = over[0];
    if (donor) {
      actions.push({
        priority: 2,
        code: "REALLOCATE_CAPACITY",
        scope: `${donor.category} -> ${u.category}`,
        message: `Reallocate capacity from ${donor.category} (projected ${donor.pace.projectedAttainmentPct}%) to ${u.category} (projected ${u.pace.projectedAttainmentPct}%)`,
        suggestedQty: u.pace.catchUpPerDay,
      });
    }
  }

  for (const item of stockoutItems) {
    actions.push({
      priority: 3,
      code: "STOCKOUT_RISK",
      scope: `${item.itemCode}${item.colour ? " / " + item.colour : ""}`,
      message: `Expedite ${item.itemCode} — pending ${item.pendingOrder} exceeds stock ${item.stock}`,
      suggestedQty: round2(item.pendingOrder - item.stock),
    });
  }

  if (plantPace.catchUpVsPlanPct !== null && plantPace.catchUpVsPlanPct > thresholds.catchupInfeasibleRatio * 100) {
    actions.push({
      priority: 6,
      code: "CATCHUP_INFEASIBLE",
      scope: "Plant",
      message: "Catch-up/day exceeds feasible capacity — flag for re-planning or added capacity",
      suggestedQty: plantPace.catchUpPerDay,
    });
  }

  return actions.sort((a, b) => a.priority - b.priority);
}
