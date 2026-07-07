import type { PlantBundle, PlantKPIs, CategoryKPIs } from "./plant-engine";
import type { PlantWarningThresholds } from "./plant-warnings";

export interface PlantRecommendation {
  priority: number;
  code: string;
  scope: string;
  action: string;
  rationale: string;
  quantifiedImpact: string;
  effort: "low" | "med" | "high";
}

export function buildPlantRecommendations(bundle: PlantBundle, thresholds: PlantWarningThresholds): PlantRecommendation[] {
  const { plant, categories, items, context, variancePareto } = bundle;
  const recs: PlantRecommendation[] = [];
  const { shiftsPerDay, shiftHours, remaining } = context;

  const pcsPerShift = plant.actualPerDay !== null && shiftsPerDay > 0 ? plant.actualPerDay / shiftsPerDay : null;

  if (plant.attainmentCumPct !== null && plant.attainmentCumPct < thresholds.behindPaceHigh && plant.catchUpPerDay !== null) {
    const extraShifts = pcsPerShift !== null && pcsPerShift > 0 ? r2((plant.catchUpPerDay - (plant.actualPerDay ?? 0)) / pcsPerShift) : null;
    const extraShiftText = extraShifts !== null ? `; approx. ${extraShifts} extra shifts/day needed` : "";
    recs.push({
      priority: 1,
      code: "OVERTIME",
      scope: "Plant",
      action: "Add overtime / extra shifts to close the pacing gap",
      rationale: `Plant is at ${plant.attainmentCumPct}% of required cumulative output. Catch-up rate needed: ${plant.catchUpPerDay} pcs/day vs current ${plant.actualPerDay ?? "n/a"} pcs/day${extraShiftText}.`,
      quantifiedImpact: `Closing gap of ${r2((plant.catchUpPerDay ?? 0) * remaining)} pcs over ${remaining} remaining working days`,
      effort: "high",
    });
  }

  const overPerforming = categories.filter((c) => (c.projectedAttainmentPct ?? 0) > 110);
  const underPerforming = categories.filter((c) => c.projectedAttainmentPct !== null && c.projectedAttainmentPct < 90);
  for (const under of underPerforming) {
    const donor = overPerforming[0];
    if (donor) {
      recs.push({
        priority: 2,
        code: "REALLOCATE_CAPACITY",
        scope: `${donor.category} → ${under.category}`,
        action: `Reallocate capacity from ${donor.category} to ${under.category}`,
        rationale: `${donor.category} is projected at ${donor.projectedAttainmentPct}% (surplus); ${under.category} is projected at ${under.projectedAttainmentPct}% (shortfall of ${under.gapPcs} pcs).`,
        quantifiedImpact: `Surplus from ${donor.category}: ${r2(donor.producedToDate - donor.requiredCum)} pcs ahead; ${under.category} shortfall: ${under.gapPcs} pcs`,
        effort: "med",
      });
    }
  }

  const zeroItems = items.filter((i) => i.producedToDate === 0 && i.targetMax > 0).sort((a, b) => b.targetMax - a.targetMax).slice(0, 5);
  if (zeroItems.length > 0) {
    recs.push({
      priority: 3,
      code: "RESEQUENCE",
      scope: zeroItems.map((i) => `${i.itemCode}/${i.colour || "–"}`).join(", "),
      action: "Resequence production to prioritise zero-output high-plan items",
      rationale: `${zeroItems.length} items with plan > 0 have zero output across all ${context.elapsed} elapsed days: ${zeroItems.map((i) => `${i.itemCode} (plan ${i.targetMax} pcs)`).join("; ")}.`,
      quantifiedImpact: `Total unstarted plan: ${zeroItems.reduce((s, i) => s + i.targetMax, 0)} pcs`,
      effort: "med",
    });
  }

  if (variancePareto.length > 0) {
    const top5 = variancePareto.slice(0, 5);
    const top5Gap = top5.reduce((s, i) => s + i.gapPcs, 0);
    const totalGap = items.reduce((s, i) => s + Math.max(i.gapPcs, 0), 0);
    const coverPct = totalGap > 0 ? r2((top5Gap / totalGap) * 100) : 0;
    recs.push({
      priority: 4,
      code: "VITAL_FEW",
      scope: top5.map((i) => i.itemCode).join(", "),
      action: "Focus production on the vital-few items driving ~80% of the shortfall",
      rationale: `Top 5 items by gap account for ${coverPct}% of total pcs shortfall: ${top5.map((i) => `${i.itemCode} (gap ${i.gapPcs} pcs)`).join("; ")}.`,
      quantifiedImpact: `Closing top 5 items recovers ${top5Gap} pcs of ${totalGap} total gap`,
      effort: "low",
    });
  }

  if (plant.projectedMinAttainmentPct !== null && plant.projectedMinAttainmentPct < 100) {
    recs.push({
      priority: 5,
      code: "PROTECT_FLOOR",
      scope: "Plant",
      action: "Escalate: minimum production floor (Min PP) is at risk",
      rationale: `Projected attainment of ${plant.projectedMinAttainmentPct}% vs Min PP (${plant.targetMin} pcs). Hitting the minimum floor is non-negotiable; escalate to management if normal overtime is insufficient.`,
      quantifiedImpact: `Min PP shortfall: ${r2(plant.targetMin - (plant.projectedMonthEnd ?? 0))} pcs at current rate`,
      effort: "high",
    });
  }

  if (plant.catchUpVsPlanPct !== null && plant.catchUpVsPlanPct > thresholds.catchupInfeasibleRatio * 100) {
    const extraHoursPerDay = pcsPerShift !== null && pcsPerShift > 0 ? r2(((plant.catchUpPerDay ?? 0) / pcsPerShift) * shiftHours) : null;
    recs.push({
      priority: 6,
      code: "INFEASIBLE_RECOVERY",
      scope: "Plant",
      action: "Flag for re-planning: recovery requires capacity beyond demonstrated output",
      rationale: `Catch-up/day (${plant.catchUpPerDay} pcs) is ${plant.catchUpVsPlanPct}% of required/day — exceeds feasible capacity. Additional machines, a new shift pattern, or revised targets are needed.${extraHoursPerDay !== null ? ` Required extra production hours/day: ~${extraHoursPerDay} h.` : ""}`,
      quantifiedImpact: `Gap to close over ${remaining} days: ${r2((plant.catchUpPerDay ?? 0) * remaining)} pcs`,
      effort: "high",
    });
  }

  recs.sort((a, b) => a.priority - b.priority);
  return recs;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}
