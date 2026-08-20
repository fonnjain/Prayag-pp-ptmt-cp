import { normalizeCode } from "./sheets";
import { versionForDate, type PlanVersion, type VersionTarget } from "./plant-plan-timeline";

export interface WeekWindow {
  week: 1 | 2 | 3 | 4;
  startDay: number;
  endDay: number;
  startDate: string;
  endDate: string;
  label: string;
}

export interface WeeklyStats {
  week: number;
  target: number;
  actual: number;
  carryover: number;
  effectiveTarget: number;
  gap: number;
  attainmentPct: number | null;
  attainmentEffectivePct: number | null;
  ragBand: "green" | "amber" | "red" | null;
  planVersions?: string[];
}

export interface WeeklyReleaseCategoryRow {
  category: string;
  weeks: WeeklyStats[];
}

export interface PlantWeeklySummary {
  month: string;
  snapshotDate: string | null;
  weekCalendar: WeekWindow[];
  currentWeek: number;
  elapsedDaysInWeek: number;
  plant: { weeks: WeeklyStats[] };
  categories: WeeklyReleaseCategoryRow[];
}

function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

function pad2(n: number): string { return String(n).padStart(2, "0"); }

export function buildWeekCalendar(month: string): WeekWindow[] {
  const lastDay = daysInMonth(month);
  const [y, m] = month.split("-").map(Number);
  return [
    { week: 1, startDay: 1, endDay: 7, startDate: `${y}-${pad2(m)}-01`, endDate: `${y}-${pad2(m)}-07`, label: `W1 (${m}/1–7)` },
    { week: 2, startDay: 8, endDay: 14, startDate: `${y}-${pad2(m)}-08`, endDate: `${y}-${pad2(m)}-14`, label: `W2 (${m}/8–14)` },
    { week: 3, startDay: 15, endDay: 21, startDate: `${y}-${pad2(m)}-15`, endDate: `${y}-${pad2(m)}-21`, label: `W3 (${m}/15–21)` },
    { week: 4, startDay: 22, endDay: lastDay, startDate: `${y}-${pad2(m)}-22`, endDate: `${y}-${pad2(m)}-${pad2(lastDay)}`, label: `W4 (${m}/22–${lastDay})` },
  ] as WeekWindow[];
}

function dateToWeekIndex(dateIso: string, calendar: WeekWindow[]): number | null {
  const day = parseInt(dateIso.slice(8), 10);
  for (let i = 0; i < calendar.length; i++) {
    if (day >= calendar[i].startDay && day <= calendar[i].endDay) return i;
  }
  return null;
}

function weekRagBand(pct: number | null): "green" | "amber" | "red" | null {
  if (pct === null) return null;
  if (pct >= 95) return "green";
  if (pct >= 85) return "amber";
  return "red";
}

function r1(n: number): number { return Math.round(n * 10) / 10; }

export interface WeeklyInputPlanItem {
  itemCode: string;
  colour: string;
  category: string;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
  maxProduction: number;
}

export interface WeeklyInputTarget {
  itemCode: string;
  colour: string;
  category: string;
}

export interface WeeklyInputActual {
  date: string;
  itemCode: string;
  colour: string;
  qty: number;
}

export function formatPlanVersionAuditLabel(version: PlanVersion): string {
  const label = version.sourceLabel ?? `${version.kind} #${version.sourceId}`;
  if (!version.selection || version.selection.candidateCount <= 1) {
    return `${label} · effective ${version.effectiveFrom}`;
  }
  const reason = version.selection.reason === "latest_source_issuance"
    ? "latest source issuance"
    : "source-id tie-breaker after equal issuance time";
  return `${label} · effective ${version.effectiveFrom} · canonical: ${reason}; ${version.selection.superseded.length} same-day revision superseded`;
}

function buildWeeklyStats(
  targets: [number, number, number, number],
  actuals: [number, number, number, number],
  calendar: WeekWindow[],
  today: string,
  month: string,
  resetCarryBeforeWeek: boolean[] = [],
  planVersionsByWeek: string[][] = [],
): WeeklyStats[] {
  let carry = 0;
  return calendar.map((wk, i) => {
    if (resetCarryBeforeWeek[i]) carry = 0;
    const target = targets[i];
    const actual = actuals[i];
    const carryover = carry;
    const effectiveTarget = target + carryover;
    const gap = Math.max(0, effectiveTarget - actual);

    const wkStarted = today.slice(0, 7) === month && today >= wk.startDate;
    const wkElapsed = today > wk.endDate;

    const attainmentPct = target > 0 && wkStarted ? r1((actual / target) * 100) : null;
    const attainmentEffectivePct = effectiveTarget > 0 && wkStarted ? r1((actual / effectiveTarget) * 100) : null;

    carry = wkElapsed ? gap : 0;

    return {
      week: wk.week,
      target,
      actual,
      carryover,
      effectiveTarget,
      gap,
      attainmentPct,
      attainmentEffectivePct,
      ragBand: weekRagBand(attainmentPct),
      planVersions: planVersionsByWeek[i] ?? [],
    };
  });
}

export function buildPlantWeeklySummary(
  month: string,
  actuals: WeeklyInputActual[],
  planItems: WeeklyInputPlanItem[],
  targets: WeeklyInputTarget[],
  snapshotDate: string | null,
  completedCalendar = false,
  versionTimeline: PlanVersion[] = [],
): PlantWeeklySummary {
  const calendar = buildWeekCalendar(month);

  // Always use the real wall-clock date for "which week are we in" — never let
  // a stale snapshotDate cause the current-week badge to fall behind.
  const realToday = completedCalendar
    ? `${month}-${String(daysInMonth(month)).padStart(2, "0")}`
    : new Date().toISOString().slice(0, 10);
  const calToday = realToday.slice(0, 7) === month ? parseInt(realToday.slice(8), 10) : 0;

  // For data-elapsed calculations keep using snapshotDate (last data day)
  const dataDay = completedCalendar ? daysInMonth(month) : (snapshotDate ?? realToday).slice(0, 7) === month
    ? parseInt((snapshotDate ?? realToday).slice(8), 10) : 0;
  const todayInMonth = calToday; // alias used below

  const currentWeek: number =
    todayInMonth === 0 ? 0
    : todayInMonth <= 7 ? 1
    : todayInMonth <= 14 ? 2
    : todayInMonth <= 21 ? 3 : 4;

  let elapsedDaysInWeek = 0;
  if (currentWeek >= 1) {
    const wk = calendar[currentWeek - 1];
    // Use dataDay (snapshotDate) for elapsed — reflects how much of this week has actual data
    elapsedDaysInWeek = Math.max(0, Math.min(dataDay - wk.startDay + 1, wk.endDay - wk.startDay + 1));
  }

  const makeCategoryLookup = (rows: Array<WeeklyInputTarget | VersionTarget>) => {
    const byKey = new Map<string, string>();
    const byCode = new Map<string, string>();
    for (const t of rows) {
      byKey.set(`${t.itemCode}|${t.colour}`, t.category);
      const nc = normalizeCode(t.itemCode);
      if (!byCode.has(nc)) byCode.set(nc, t.category);
    }
    return { byKey, byCode };
  };
  const staticLookup = makeCategoryLookup(targets);
  const categoryForDate = (date: string, itemCode: string, colour: string) => {
    const version = versionForDate(versionTimeline, date);
    const lookup = version ? makeCategoryLookup(version.targets) : staticLookup;
    return lookup.byKey.get(`${itemCode}|${colour}`) ?? lookup.byCode.get(normalizeCode(itemCode)) ?? null;
  };

  const catByKey = new Map<string, string>();
  const catByCode = new Map<string, string>();
  for (const t of targets) {
    catByKey.set(`${t.itemCode}|${t.colour}`, t.category);
    const nc = normalizeCode(t.itemCode);
    if (!catByCode.has(nc)) catByCode.set(nc, t.category);
  }

  const catW = new Map<string, [number, number, number, number]>();
  const timelineItems: WeeklyInputPlanItem[] = [];
  const planVersionsByWeek = calendar.map(() => new Set<string>());
  const resetCarryBeforeWeek = calendar.map((week) =>
    versionTimeline.some((version) => version.effectiveFrom >= week.startDate && version.effectiveFrom <= week.endDate),
  );
  if (versionTimeline.length > 0) {
    for (const version of versionTimeline) {
      for (let weekIndex = 0; weekIndex < calendar.length; weekIndex++) {
        const week = calendar[weekIndex];
        const dates: string[] = [];
        for (let day = week.startDay; day <= week.endDay; day++) {
          const date = `${month}-${pad2(day)}`;
          if (versionForDate(versionTimeline, date)?.sourceId === version.sourceId &&
              versionForDate(versionTimeline, date)?.kind === version.kind) dates.push(date);
        }
        if (dates.length === 0) continue;
        planVersionsByWeek[weekIndex].add(formatPlanVersionAuditLabel(version));
        const ratio = dates.length / (week.endDay - week.startDay + 1);
        for (const target of version.targets) {
          const release = [target.w1, target.w2, target.w3, target.w4][weekIndex] ?? 0;
          timelineItems.push({
            itemCode: target.itemCode,
            colour: target.colour,
            category: target.category,
            maxProduction: target.maxPcs,
            w1: weekIndex === 0 ? release * ratio : 0,
            w2: weekIndex === 1 ? release * ratio : 0,
            w3: weekIndex === 2 ? release * ratio : 0,
            w4: weekIndex === 3 ? release * ratio : 0,
          });
        }
      }
    }
  }
  for (const item of versionTimeline.length > 0 ? timelineItems : planItems) {
    if (item.maxProduction <= 0) continue;
    const arr = catW.get(item.category) ?? [0, 0, 0, 0];
    arr[0] += item.w1;
    arr[1] += item.w2;
    arr[2] += item.w3;
    arr[3] += item.w4;
    catW.set(item.category, arr);
  }

  const catA = new Map<string, [number, number, number, number]>();
  for (const row of actuals) {
    if (row.date.slice(0, 7) !== month) continue;
    const wkIdx = dateToWeekIndex(row.date, calendar);
    if (wkIdx === null) continue;
    const cat = categoryForDate(row.date, row.itemCode, row.colour);
    if (!cat) continue;
    const arr = catA.get(cat) ?? [0, 0, 0, 0];
    arr[wkIdx] += row.qty;
    catA.set(cat, arr);
  }

  const allCats = new Set([...catW.keys(), ...catA.keys()]);
  const plantTargets: [number, number, number, number] = [0, 0, 0, 0];
  const plantActuals: [number, number, number, number] = [0, 0, 0, 0];
  const categoryRows: WeeklyReleaseCategoryRow[] = [];

  for (const cat of allCats) {
    const tgts = catW.get(cat) ?? [0, 0, 0, 0];
    const acts = catA.get(cat) ?? [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      plantTargets[i] += tgts[i];
      plantActuals[i] += acts[i];
    }
    categoryRows.push({
      category: cat,
      weeks: buildWeeklyStats(tgts, acts, calendar, realToday, month, resetCarryBeforeWeek, planVersionsByWeek.map((x) => [...x])),
    });
  }

  categoryRows.sort((a, b) => {
    const aTotal = (catW.get(a.category) ?? [0, 0, 0, 0]).reduce((s, v) => s + v, 0);
    const bTotal = (catW.get(b.category) ?? [0, 0, 0, 0]).reduce((s, v) => s + v, 0);
    return bTotal - aTotal;
  });

  return {
    month,
    snapshotDate,
    weekCalendar: calendar,
    currentWeek,
    elapsedDaysInWeek,
    plant: {
      weeks: buildWeeklyStats(
        plantTargets,
        plantActuals,
        calendar,
        realToday,
        month,
        resetCarryBeforeWeek,
        planVersionsByWeek.map((x) => [...x]),
      ),
    },
    categories: categoryRows,
  };
}
