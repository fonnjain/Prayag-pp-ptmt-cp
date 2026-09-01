import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export const MONTH_QUERY_PARAM = "month";
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

export interface MonthFilterOptions {
  availableMonths?: readonly string[];
  availableMonthsLoading?: boolean;
}

export interface MonthFilterState {
  month: string;
  setMonth: (month: string) => void;
  currentMonth: string;
  availableMonths: string[];
  isAvailableMonthsLoading: boolean;
  isMonthAvailable: boolean;
  isFallback: boolean;
  fallbackFrom: string | null;
  invalidMonth: string | null;
}

const MonthContext = createContext<MonthFilterState | null>(null);

function todayMonth(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
}

export function currentMonth(): string {
  return todayMonth();
}

export function isValidMonth(value: string | null | undefined): value is string {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

export function formatMonthLabel(month: string): string {
  if (!isValidMonth(month)) return month;
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function readMonthFromUrl(): { raw: string | null; valid: string | null } {
  if (typeof window === "undefined") return { raw: null, valid: null };
  const raw = new URLSearchParams(window.location.search).get(MONTH_QUERY_PARAM);
  return { raw, valid: isValidMonth(raw) ? raw : null };
}

function replaceMonthInUrl(month: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set(MONTH_QUERY_PARAM, month);
  window.history.replaceState(window.history.state, "", url);
  window.dispatchEvent(new Event("monthchange"));
}

function pushMonthInUrl(month: string): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.set(MONTH_QUERY_PARAM, month);
  window.history.pushState(window.history.state, "", url);
  window.dispatchEvent(new Event("monthchange"));
}

export function preserveMonthInUrl(month: string, persist = true): void {
  if (!persist || typeof window === "undefined" || !isValidMonth(month)) return;
  const current = new URLSearchParams(window.location.search).get(MONTH_QUERY_PARAM);
  if (current !== month) replaceMonthInUrl(month);
}

export function useMonthFilter({
  availableMonths = [],
  availableMonthsLoading = false,
}: MonthFilterOptions = {}): MonthFilterState {
  const initial = readMonthFromUrl();
  const current = todayMonth();
  const [month, setMonthState] = useState(initial.valid ?? current);
  const [invalidMonth, setInvalidMonth] = useState(
    initial.raw !== null && !initial.valid ? initial.raw : null,
  );
  const [fallbackFrom, setFallbackFrom] = useState<string | null>(null);
  const [isFallback, setIsFallback] = useState(false);
  // A missing month uses the current-month fallback policy. A month present
  // in the URL is an explicit user choice, including the current month, and
  // must remain visible as an empty state when no run exists.
  const [autoSelect, setAutoSelect] = useState(initial.valid === null);
  const [urlVersion, setUrlVersion] = useState(0);

  useEffect(() => {
    const onUrlChange = () => setUrlVersion((version: number) => version + 1);
    window.addEventListener("popstate", onUrlChange);
    window.addEventListener("monthchange", onUrlChange);
    return () => {
      window.removeEventListener("popstate", onUrlChange);
      window.removeEventListener("monthchange", onUrlChange);
    };
  }, []);

  const normalizedAvailableMonths = useMemo(
    () => [...new Set(availableMonths.filter(isValidMonth))].sort((a, b) => b.localeCompare(a)),
    [availableMonths],
  );

  useEffect(() => {
    const fromUrl = readMonthFromUrl();
    if (fromUrl.valid) {
      if (!autoSelect) {
        if (fromUrl.valid !== month) setMonthState(fromUrl.valid);
        setInvalidMonth(null);
        setIsFallback(false);
        setFallbackFrom(null);
      }
      return;
    }
    if (fromUrl.raw !== null) {
      setInvalidMonth(fromUrl.raw);
      if (month !== current) setMonthState(current);
    }
    void urlVersion;
  }, [autoSelect, current, month, urlVersion]);

  useEffect(() => {
    if (!autoSelect || availableMonthsLoading || normalizedAvailableMonths.length === 0) return;
    const fromUrl = readMonthFromUrl();
    if (normalizedAvailableMonths.includes(current)) {
      if (month !== current) setMonthState(current);
      setIsFallback(false);
      setFallbackFrom(null);
      if (fromUrl.raw !== null && !fromUrl.valid) replaceMonthInUrl(current);
      return;
    }
    const fallback = normalizedAvailableMonths.find((availableMonth) => availableMonth <= current)
      ?? normalizedAvailableMonths[0];
    if (!fallback) return;
    if (month !== fallback) setMonthState(fallback);
    setIsFallback(true);
    setFallbackFrom(current);
    replaceMonthInUrl(fallback);
  }, [autoSelect, availableMonthsLoading, current, month, normalizedAvailableMonths]);

  const setMonth = useCallback((nextMonth: string) => {
    if (!isValidMonth(nextMonth)) return;
    setAutoSelect(false);
    setMonthState(nextMonth);
    setIsFallback(false);
    setFallbackFrom(null);
    setInvalidMonth(null);
    pushMonthInUrl(nextMonth);
  }, []);

  const isMonthAvailable = normalizedAvailableMonths.includes(month);

  return {
    month,
    setMonth,
    currentMonth: current,
    availableMonths: normalizedAvailableMonths,
    isAvailableMonthsLoading: availableMonthsLoading,
    isMonthAvailable,
    isFallback,
    fallbackFrom,
    invalidMonth,
  };
}

export function MonthProvider({
  children,
  availableMonths,
  availableMonthsLoading,
}: MonthFilterOptions & { children: ReactNode }) {
  const state = useMonthFilter({ availableMonths, availableMonthsLoading });
  return <MonthContext.Provider value={state}>{children}</MonthContext.Provider>;
}

export function useMonth(): MonthFilterState {
  const state = useContext(MonthContext);
  if (!state) throw new Error("useMonth must be used inside MonthProvider");
  return state;
}