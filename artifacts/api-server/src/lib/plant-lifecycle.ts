import { countWorkingDaysInMonth } from "./monitoring-calc";

export type PlantMonthState = "future" | "open" | "grace" | "closed";
export type WorkingDaysSource = "configured" | "observed" | "derived";

export interface PlantMonthLifecycle {
  state: PlantMonthState;
  month: string;
  currentMonth: string;
  monthStart: string;
  nextMonthStart: string;
  closedAt: string | null;
  isCompletedCalendar: boolean;
  acceptsLateActuals: boolean;
}

export function utcMonth(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function previousMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, mon - 2, 1));
  return utcMonth(date);
}

function nextMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  return utcMonth(new Date(Date.UTC(year, mon, 1)));
}

export function derivedWorkingDays(month: string): number {
  return countWorkingDaysInMonth(month);
}

/**
 * Returns the last day that belongs in a month-end snapshot.
 *
 * Calendar non-Sundays are the base. A worked Sunday is also eligible so a
 * closed month cannot permanently lose production recorded on its final day.
 */
export function lastProductionDay(month: string, observedProductionDates: string[] = []): string {
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const worked = new Set(observedProductionDates.filter((date) => date.startsWith(month)));
  for (let day = lastDay; day >= 1; day--) {
    const iso = `${month}-${String(day).padStart(2, "0")}`;
    const date = new Date(`${iso}T00:00:00Z`);
    if (date.getUTCDay() !== 0 || worked.has(iso)) return iso;
  }
  return `${month}-01`;
}

/** Backward-compatible name for callers that only need the calendar fallback. */
export function lastWorkingDay(month: string, observedProductionDates: string[] = []): string {
  return lastProductionDay(month, observedProductionDates);
}

/** The monitoring lifecycle is deliberately UTC-based so it is stable across deployments. */
export function resolvePlantMonthLifecycle(month: string, now = new Date()): PlantMonthLifecycle {
  const currentMonth = utcMonth(now);
  const monthStart = `${month}-01`;
  const nextMonthStart = `${nextMonth(month)}-01`;
  const closedAt = `${nextMonth(month)}-08T00:00:00.000Z`;
  if (month > currentMonth) {
    return { state: "future", month, currentMonth, monthStart, nextMonthStart, closedAt: null, isCompletedCalendar: false, acceptsLateActuals: false };
  }
  if (month === currentMonth) {
    return { state: "open", month, currentMonth, monthStart, nextMonthStart, closedAt: null, isCompletedCalendar: false, acceptsLateActuals: true };
  }
  const isGrace = month === previousMonth(currentMonth) && now.getUTCDate() <= 7;
  return {
    state: isGrace ? "grace" : "closed",
    month,
    currentMonth,
    monthStart,
    nextMonthStart,
    closedAt,
    isCompletedCalendar: true,
    acceptsLateActuals: isGrace,
  };
}

export function resolveWorkingDays(
  month: string,
  configuredWorkingDays: number | null | undefined,
  observedProductionDates: string[] = [],
  snapshotDate: string | null = null,
  lifecycle: PlantMonthState = "open",
): { workingDays: number; workingDaysSource: WorkingDaysSource } {
  const hasConfiguredWorkingDays = typeof configuredWorkingDays === "number" && configuredWorkingDays > 0;
  const isCompletedLifecycle = lifecycle === "closed" || lifecycle === "grace";
  if (hasConfiguredWorkingDays && !isCompletedLifecycle) {
    return { workingDays: configuredWorkingDays, workingDaysSource: "configured" as const };
  }

  const calendarDays = derivedWorkingDays(month);
  const calendarNonSundays = new Set<string>();
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  for (let day = 1; day <= lastDay; day++) {
    const iso = `${month}-${String(day).padStart(2, "0")}`;
    if (new Date(`${iso}T00:00:00Z`).getUTCDay() !== 0) calendarNonSundays.add(iso);
  }

  const positiveDates = [...new Set(observedProductionDates)]
    .filter((date) => date.startsWith(month))
    .sort();
  if (positiveDates.length === 0) {
    return hasConfiguredWorkingDays
      ? { workingDays: configuredWorkingDays, workingDaysSource: "configured" as const }
      : { workingDays: calendarDays, workingDaysSource: "derived" as const };
  }

  const effectiveSnapshot = snapshotDate ?? positiveDates.at(-1)!;
  if (isCompletedLifecycle) {
    const extraWorkedDays = positiveDates.filter((date) => !calendarNonSundays.has(date)).length;
    return { workingDays: calendarDays + extraWorkedDays, workingDaysSource: "observed" as const };
  }

  const elapsedObservedDays = new Set([
    ...[...calendarNonSundays].filter((date) => date <= effectiveSnapshot),
    ...positiveDates.filter((date) => date <= effectiveSnapshot),
  ]);
  const futureCalendarDays = [...calendarNonSundays].filter((date) => date > effectiveSnapshot).length;
  return {
    workingDays: elapsedObservedDays.size + futureCalendarDays,
    workingDaysSource: "observed" as const,
  };
}