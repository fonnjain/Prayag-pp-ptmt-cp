/**
 * Canonical plant calendar.
 *
 * Sundays are non-working by default. A Sunday with positive production is
 * treated as worked by the callers that have observed actuals, so capacity,
 * planning, and monitoring can use the same calendar primitives.
 */
export function isSunday(dateIso: string): boolean {
  return new Date(`${dateIso}T00:00:00Z`).getUTCDay() === 0;
}

export function calendarDates(month: string, throughDay?: number): string[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const endDay = Math.min(Math.max(throughDay ?? lastDay, 0), lastDay);
  return Array.from({ length: endDay }, (_, index) =>
    `${month}-${String(index + 1).padStart(2, "0")}`,
  );
}

export function countCalendarWorkingDays(
  month: string,
  throughDay?: number,
  workedSundays: Iterable<string> = [],
): number {
  const worked = new Set(workedSundays);
  return calendarDates(month, throughDay)
    .filter((date) => !isSunday(date) || worked.has(date))
    .length;
}

export function countWorkingDaysInMonth(
  month: string,
  workedSundays: Iterable<string> = [],
): number {
  return countCalendarWorkingDays(month, undefined, workedSundays);
}

export function countWorkingDaysBetween(
  startDate: string,
  endDate: string,
  workedSundays: Iterable<string> = [],
): number {
  const worked = new Set(workedSundays);
  let cursor = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  let count = 0;
  while (cursor <= end) {
    const date = cursor.toISOString().slice(0, 10);
    if (!isSunday(date) || worked.has(date)) count++;
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return count;
}

/**
 * Splits a calendar month into the four planning buckets used by the
 * production plan. The Sunday rule stays in countCalendarWorkingDays so
 * callers cannot accidentally create a second calendar implementation.
 */
export function countWorkingDaysInWeek(
  month: string,
  week: 1 | 2 | 3 | 4,
  workedSundays: Iterable<string> = [],
): number {
  const [year, monthNumber] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const startDay = week === 1 ? 1 : week === 2 ? 8 : week === 3 ? 15 : 22;
  const endDay = week === 4 ? daysInMonth : Math.min(startDay + 6, daysInMonth);
  if (startDay > daysInMonth) return 0;

  const beforeWeek = countCalendarWorkingDays(month, startDay - 1, workedSundays);
  const throughWeek = countCalendarWorkingDays(month, endDay, workedSundays);
  return throughWeek - beforeWeek;
}