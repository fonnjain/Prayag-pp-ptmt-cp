import type { PlantBundle, PlantKPIs, CategoryKPIs } from "./plant-engine";
import type { PlantWeeklySummary } from "./plant-weekly-engine";

export type PlantWarningSeverity = "info" | "medium" | "high" | "critical";

export interface PlantWarning {
  code: string;
  severity: PlantWarningSeverity;
  scope: string;
  message: string;
  value: number | null;
  threshold: number | null;
  source: string;
}

export interface PlantWarningThresholds {
  behindPaceHigh: number;
  behindPaceCritical: number;
  willMissPpGapMedium: number;
  willMissPpGapHigh: number;
  willMissPpGapCritical: number;
  catchupInfeasibleRatio: number;
  categoryLaggingGap: number;
  backloadingIndex: number;
  noProductionDays: number;
}

export const DEFAULT_PLANT_WARNING_THRESHOLDS: PlantWarningThresholds = {
  behindPaceHigh: 90,
  behindPaceCritical: 80,
  willMissPpGapMedium: 5,
  willMissPpGapHigh: 10,
  willMissPpGapCritical: 25,
  catchupInfeasibleRatio: 1.3,
  categoryLaggingGap: 15,
  backloadingIndex: 0.6,
  noProductionDays: 3,
};

function severityOrder(s: PlantWarningSeverity): number {
  return { critical: 0, high: 1, medium: 2, info: 3 }[s] ?? 4;
}

function warnBehindPace(scope: string, kpis: PlantKPIs | CategoryKPIs, thresholds: PlantWarningThresholds): PlantWarning[] {
  const warnings: PlantWarning[] = [];
  const pi = kpis.attainmentCumPct;
  if (pi === null) return warnings;
  if (pi < thresholds.behindPaceCritical) {
    warnings.push({ code: "BEHIND_PACE", severity: "critical", scope, message: `${scope}: pace ${pi}% is critically behind plan (threshold ${thresholds.behindPaceCritical}%)`, value: pi, threshold: thresholds.behindPaceCritical, source: "velocity" });
  } else if (pi < thresholds.behindPaceHigh) {
    warnings.push({ code: "BEHIND_PACE", severity: "high", scope, message: `${scope}: pace ${pi}% is behind plan (threshold ${thresholds.behindPaceHigh}%)`, value: pi, threshold: thresholds.behindPaceHigh, source: "velocity" });
  }
  return warnings;
}

function warnWillMiss(scope: string, kpis: PlantKPIs | CategoryKPIs, thresholds: PlantWarningThresholds): PlantWarning[] {
  const warnings: PlantWarning[] = [];
  const proj = kpis.projectedAttainmentPct;
  if (proj === null || proj >= 100) return warnings;
  const gap = 100 - proj;
  const sev: PlantWarningSeverity = gap >= thresholds.willMissPpGapCritical ? "critical" : gap >= thresholds.willMissPpGapHigh ? "high" : "medium";
  warnings.push({ code: "WILL_MISS_PP", severity: sev, scope, message: `${scope}: projected to reach ${proj}% of Max PP (gap ${gap.toFixed(1)}%)`, value: proj, threshold: 100, source: "velocity" });
  return warnings;
}

export function buildPlantWarnings(bundle: PlantBundle, thresholds: PlantWarningThresholds): PlantWarning[] {
  const { plant, categories, items, context } = bundle;
  const warnings: PlantWarning[] = [];

  if (!bundle.dataAvailable) {
    warnings.push({ code: "DATA_STALE", severity: "info", scope: "Plant", message: `No production data found for ${bundle.month} — data may be stale or not yet loaded`, value: null, threshold: null, source: "data" });
    return warnings;
  }

  warnings.push(...warnBehindPace("Plant", plant, thresholds));
  warnings.push(...warnWillMiss("Plant", plant, thresholds));

  if (plant.catchUpVsPlanPct !== null && plant.catchUpVsPlanPct > thresholds.catchupInfeasibleRatio * 100) {
    warnings.push({ code: "CATCHUP_INFEASIBLE", severity: "critical", scope: "Plant", message: `Catch-up/day is ${plant.catchUpVsPlanPct}% of required/day — recovery may require re-planning or added capacity`, value: plant.catchUpVsPlanPct, threshold: thresholds.catchupInfeasibleRatio * 100, source: "velocity" });
  }

  if (plant.projectedMinAttainmentPct !== null && plant.projectedMinAttainmentPct < 100) {
    warnings.push({ code: "BELOW_MIN_TRAJECTORY", severity: "critical", scope: "Plant", message: `Projected ${plant.projectedMinAttainmentPct}% of Min PP — minimum floor is at risk`, value: plant.projectedMinAttainmentPct, threshold: 100, source: "velocity" });
  }

  const plantAtt = plant.attainmentCumPct ?? 0;
  for (const cat of categories) {
    warnings.push(...warnBehindPace(cat.category, cat, thresholds));
    const catAtt = cat.attainmentCumPct ?? 0;
    if (cat.attainmentCumPct !== null && plantAtt - catAtt > thresholds.categoryLaggingGap) {
      warnings.push({ code: "CATEGORY_LAGGING", severity: "high", scope: cat.category, message: `${cat.category} attainment (${catAtt}%) lags plant average (${plantAtt.toFixed(1)}%) by ${(plantAtt - catAtt).toFixed(1)} pts`, value: catAtt, threshold: plantAtt - thresholds.categoryLaggingGap, source: "velocity" });
    }
  }

  if (plant.linearityIndex !== null && plant.linearityIndex < thresholds.backloadingIndex) {
    warnings.push({ code: "BACKLOADING", severity: "medium", scope: "Plant", message: `Linearity index ${plant.linearityIndex.toFixed(2)} < ${thresholds.backloadingIndex} — output is back-loaded; production may be concentrated too late in the month`, value: plant.linearityIndex, threshold: thresholds.backloadingIndex, source: "velocity" });
  }

  const noProducedItems = items.filter((i) => i.producedToDate === 0 && i.targetMax > 0 && i.daysWithNoProduction >= context.elapsed);
  for (const item of noProducedItems.slice(0, 5)) {
    warnings.push({ code: "MIX_IMBALANCE", severity: "high", scope: `${item.itemCode}/${item.colour || "–"}`, message: `${item.itemCode} (plan ${item.targetMax} pcs): zero output across all ${context.elapsed} elapsed days while plan > 0`, value: 0, threshold: item.targetMax, source: "attainment" });
  }

  const noProductionItems = items.filter((i) => i.daysWithNoProduction >= thresholds.noProductionDays && i.targetMax > 0 && i.producedToDate > 0);
  for (const item of noProductionItems.slice(0, 3)) {
    warnings.push({ code: "NO_PRODUCTION", severity: "high", scope: `${item.itemCode}/${item.colour || "–"}`, message: `${item.itemCode}: no production for ${item.daysWithNoProduction} consecutive days (threshold ${thresholds.noProductionDays})`, value: item.daysWithNoProduction, threshold: thresholds.noProductionDays, source: "attainment" });
  }

  if (context.elapsed === 0 && bundle.dataAvailable) {
    warnings.push({ code: "DATA_STALE", severity: "info", scope: "Plant", message: "Production data exists but no working days elapsed yet — KPIs unavailable", value: null, threshold: null, source: "data" });
  }

  // TODAY_MISSED: today is a working day within the month but snapshot_date is behind today
  if (context.elapsed > 0 && context.snapshotDate) {
    const today = new Date().toISOString().slice(0, 10);
    const [sy, sm] = bundle.month.split("-").map(Number);
    const todayDate = new Date(today);
    const monthYear = todayDate.getFullYear() * 100 + (todayDate.getMonth() + 1);
    const bundleMonthYear = sy * 100 + sm;
    if (monthYear === bundleMonthYear && context.snapshotDate < today && todayDate.getDay() !== 0 && todayDate.getDay() !== 6) {
      warnings.push({ code: "TODAY_MISSED", severity: "medium", scope: "Plant", message: `No production data for today (${today}) — last snapshot is ${context.snapshotDate}. Today's output may not be captured yet.`, value: null, threshold: null, source: "data" });
    }
  }

  warnings.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
  return warnings;
}

export function buildPlantWeeklyWarnings(weekly: PlantWeeklySummary): PlantWarning[] {
  const warnings: PlantWarning[] = [];
  const { currentWeek, elapsedDaysInWeek } = weekly;

  if (currentWeek < 1 || currentWeek > 4) return warnings;

  const plantWk = weekly.plant.weeks.find((w) => w.week === currentWeek);
  if (!plantWk) return warnings;

  // Current week attainment behind plan
  if (plantWk.attainmentPct !== null && plantWk.target > 0 && elapsedDaysInWeek >= 3) {
    if (plantWk.attainmentPct < 80) {
      warnings.push({
        code: "WEEK_BEHIND",
        severity: "critical",
        scope: `W${currentWeek}`,
        message: `Week ${currentWeek}: at ${plantWk.attainmentPct.toFixed(1)}% of its released target after ${elapsedDaysInWeek} days (${plantWk.actual.toLocaleString()} of ${plantWk.target.toLocaleString()} pcs)`,
        value: plantWk.attainmentPct,
        threshold: 80,
        source: "weekly",
      });
    } else if (plantWk.attainmentPct < 90) {
      warnings.push({
        code: "WEEK_BEHIND",
        severity: "high",
        scope: `W${currentWeek}`,
        message: `Week ${currentWeek}: at ${plantWk.attainmentPct.toFixed(1)}% of its released target — pacing behind weekly plan`,
        value: plantWk.attainmentPct,
        threshold: 90,
        source: "weekly",
      });
    }
  }

  // Large carryover from prior week
  if (plantWk.carryover > 0 && plantWk.target > 0) {
    const carryPct = (plantWk.carryover / plantWk.target) * 100;
    if (carryPct >= 20) {
      warnings.push({
        code: "CARRYOVER_HIGH",
        severity: "high",
        scope: `W${currentWeek}`,
        message: `W${currentWeek - 1} carryover of ${plantWk.carryover.toLocaleString()} pcs (${carryPct.toFixed(0)}% of W${currentWeek} plan) — effective target elevated to ${plantWk.effectiveTarget.toLocaleString()}`,
        value: plantWk.carryover,
        threshold: plantWk.target * 0.2,
        source: "weekly",
      });
    } else if (carryPct >= 10) {
      warnings.push({
        code: "CARRYOVER_HIGH",
        severity: "medium",
        scope: `W${currentWeek}`,
        message: `W${currentWeek - 1} carryover of ${plantWk.carryover.toLocaleString()} pcs (${carryPct.toFixed(0)}% of W${currentWeek} plan) carried into this week`,
        value: plantWk.carryover,
        threshold: plantWk.target * 0.1,
        source: "weekly",
      });
    }
  }

  // Category: release not started in current week
  for (const cat of weekly.categories) {
    const catWk = cat.weeks.find((w) => w.week === currentWeek);
    if (!catWk || catWk.target === 0) continue;
    if (catWk.actual === 0 && catWk.attainmentPct !== null && elapsedDaysInWeek >= 2) {
      warnings.push({
        code: "WEEK_RELEASE_NOT_STARTED",
        severity: "high",
        scope: cat.category,
        message: `${cat.category}: W${currentWeek} target ${catWk.target.toLocaleString()} pcs — zero production after ${elapsedDaysInWeek} days elapsed in the week`,
        value: 0,
        threshold: catWk.target,
        source: "weekly",
      });
    }
  }

  warnings.sort((a, b) => severityOrder(a.severity) - severityOrder(b.severity));
  return warnings;
}
