import { useState } from "react";
import type { MonthFilterState } from "@workspace/month-filter";

export type DatePreset = "7d" | "15d" | "30d" | "mtd" | "month";

export interface DateRange {
  start: string;
  end: string;
  month: string;
}

function toISO(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthOf(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function computeDateRange(preset: DatePreset, customMonth: string): DateRange {
  const today = new Date();
  const todayStr = toISO(today);

  if (preset === "7d") {
    const start = new Date(today);
    start.setDate(today.getDate() - 6);
    return { start: toISO(start), end: todayStr, month: monthOf(today) };
  }
  if (preset === "15d") {
    const start = new Date(today);
    start.setDate(today.getDate() - 14);
    return { start: toISO(start), end: todayStr, month: monthOf(today) };
  }
  if (preset === "30d") {
    const start = new Date(today);
    start.setDate(today.getDate() - 29);
    return { start: toISO(start), end: todayStr, month: monthOf(today) };
  }
  if (preset === "mtd") {
    const start = new Date(today.getFullYear(), today.getMonth(), 1);
    return { start: toISO(start), end: todayStr, month: monthOf(today) };
  }
  const safeMonth = /^\d{4}-(0[1-9]|1[0-2])$/.test(customMonth) ? customMonth : monthOf(today);
  const [y, m] = safeMonth.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  return { start: toISO(start), end: toISO(end), month: safeMonth };
}

export function useDateFilter(sharedMonth?: Pick<MonthFilterState, "month" | "setMonth">) {
  const [preset, setPreset] = useState<DatePreset>("month");
  const [localMonth, setLocalMonth] = useState<string>(() => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}`;
  });

  const customMonth = sharedMonth?.month ?? localMonth;
  const setCustomMonth = (nextMonth: string) => {
    if (sharedMonth) sharedMonth.setMonth(nextMonth);
    else setLocalMonth(nextMonth);
  };
  const dateRange = computeDateRange(preset, customMonth);

  return { preset, setPreset, customMonth, setCustomMonth, dateRange, month: dateRange.month };
}
