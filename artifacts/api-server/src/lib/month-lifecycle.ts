export type PlantMonthState = "future" | "open" | "grace" | "closed";

export interface PlantMonthLifecycle {
  state: PlantMonthState;
  month: string;
  currentMonth: string;
  closedAt: Date | null;
}

function utcMonth(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function previousMonth(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, mon - 2, 1));
  return utcMonth(date);
}

export function lastWorkingDay(month: string): string {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  for (let day = last; day >= 1; day--) {
    const date = new Date(Date.UTC(year, mon - 1, day));
    if (date.getUTCDay() !== 0) return `${month}-${String(day).padStart(2, "0")}`;
  }
  return `${month}-01`;
}

export function derivedWorkingDays(month: string): number {
  const [year, mon] = month.split("-").map(Number);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  let count = 0;
  for (let day = 1; day <= last; day++) {
    if (new Date(Date.UTC(year, mon - 1, day)).getUTCDay() !== 0) count++;
  }
  return count;
}

/** UTC-only month lifecycle. Grace covers days 1–6 of the following month. */
export function resolvePlantMonthLifecycle(month: string, now = new Date()): PlantMonthLifecycle {
  const currentMonth = utcMonth(now);
  if (month > currentMonth) return { state: "future", month, currentMonth, closedAt: null };
  if (month === currentMonth) return { state: "open", month, currentMonth, closedAt: null };
  const priorMonth = previousMonth(currentMonth);
  if (month === priorMonth && now.getUTCDate() < 7) {
    return { state: "grace", month, currentMonth, closedAt: null };
  }
  const [year, mon] = month.split("-").map(Number);
  const nextMonthStart = new Date(Date.UTC(year, mon, 1));
  const closedAt = new Date(nextMonthStart.getTime() + 6 * 24 * 60 * 60 * 1000);
  return { state: "closed", month, currentMonth, closedAt };
}