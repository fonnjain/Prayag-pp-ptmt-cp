import { countWorkingDaysInMonth } from "./monitoring-calc";

export type PlantMonthState = "future" | "open" | "grace" | "closed";

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

export function lastWorkingDay(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  for (let day = lastDay; day >= 1; day--) {
    const date = new Date(Date.UTC(year, mon - 1, day));
    if (date.getUTCDay() !== 0) return `${month}-${String(day).padStart(2, "0")}`;
  }
  return `${month}-01`;
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

export function resolveWorkingDays(month: string, configuredWorkingDays: number | null | undefined) {
  if (typeof configuredWorkingDays === "number" && configuredWorkingDays > 0) {
    return { workingDays: configuredWorkingDays, workingDaysSource: "configured" as const };
  }
  return { workingDays: derivedWorkingDays(month), workingDaysSource: "derived" as const };
}