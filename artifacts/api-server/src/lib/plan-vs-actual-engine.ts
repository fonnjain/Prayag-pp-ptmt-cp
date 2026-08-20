/**
 * Plan-versus-Actual Report Engine (task #134)
 *
 * Architecture:
 *  - PTMT closed months → immutable plantMonitoringSnapshots actuals + frozen version timeline.
 *  - PTMT open/grace    → getPlanVersionTimeline + versionForDate + fetchDailyActuals.
 *  - Plumbing           → if issued timeline exists use buildVersionAwarePlanMap for plan;
 *                         actuals from getPlumbingMonitoringPayloadCached items (strict-normCode).
 *                         Fall back to payload plan when no issued versions.
 *  - Orders             → Order Sheet 26-27 (per-month tab or Combined), dated rows → W1-W4.
 *  - Sales              → SALE SHEET 26-27 per-month tab, dated rows → W1-W4.
 *
 * Transaction matching rules (audit gap fixes):
 *  - Always match by exact itemKey(code, colour). NEVER fall back to byCode.
 *  - GROUP column in orders is NOT used to pre-filter transactions before matching.
 *    GROUP is only used AFTER the match fails to classify an unmatched order as
 *    a Plumbing group (CPVC/UPVC/SWR/AGRI) for the unmatched-orders tally.
 *  - Sales has no segment column; only exact roster matches are reported.
 *
 * Achievement boundary (integer cross-multiplication, no float traps):
 *  UNDER:      produced*100 <  plan*80
 *  ON TARGET:  produced*100 >= plan*80 AND produced*100 <= plan*110
 *  OVER:       produced*100 >  plan*110
 *  null:       plan = 0
 */

import {
  db,
  plantMonitoringSnapshotsTable,
  plantConfigsTable,
} from "@workspace/db";
import type { WorkingDaysSource } from "./plant-lifecycle";
import { eq } from "drizzle-orm";
import { logger as rootLogger } from "./logger";
import {
  getPlanVersionTimeline,
  versionForDate,
  type PlanVersion,
} from "./plant-plan-timeline";
import { buildWeekCalendar } from "./plant-weekly-engine";
import { resolvePlantMonthLifecycle, resolveWorkingDays } from "./plant-lifecycle";
import { fetchDailyActuals, type DailyActualRow } from "./plant-ingestion";
import type { PlantSnapshotSourceInfo } from "./plant-monitoring";
import { backfillLegacyPlantMonitoringSnapshot } from "./plant-monitoring";
import { getPlumbingMonitoringPayloadCached } from "../routes/plan";
import {
  normalizeCode,
  normalizeCodeStrict,
  itemKey,
  SHEET_IDS,
  listTabs,
  throttledGetTabValues,
} from "./sheets";

const logger = rootLogger.child({ module: "plan-vs-actual-engine" });

// ── Public types ──────────────────────────────────────────────────────────────

export type AchievementRemark = "UNDER" | "ON TARGET" | "OVER" | null;

export interface PlanVersionSummary {
  kind: PlanVersion["kind"];
  sourceId: number;
  sourceLabel: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  auditLabel: string;
}

export interface WeekCalendarEntry {
  week: 1 | 2 | 3 | 4;
  startDate: string;
  endDate: string;
  label: string;
}

export interface ItemWeekDetail {
  week: 1 | 2 | 3 | 4;
  plan: number;
  production: number;
  orders: number | null;
  sales: number | null;
}

export interface ReportItem {
  itemCode: string;
  colour: string;
  category: string;
  plan: number;
  production: number;
  orders: number | null;
  sales: number | null;
  variance: number;
  achievementPct: number | null;
  achievementRemark: AchievementRemark;
  weeks: ItemWeekDetail[];
}

export interface ReportCategory {
  category: string;
  itemCount: number;
  plan: number;
  production: number;
  orders: number | null;
  sales: number | null;
  variance: number;
  achievementPct: number | null;
  achievementRemark: AchievementRemark;
  weeks: {
    week: 1 | 2 | 3 | 4;
    plan: number;
    production: number;
    orders: number | null;
    sales: number | null;
  }[];
  items: ReportItem[];
}

export interface OutOfPlanRow {
  itemCode: string;
  colour: string;
  category: string | null;
  totalProduction: number;
  weeks: number[];
}

export interface ReportInvariant {
  code: string;
  ok: boolean;
  expected: number;
  actual: number;
  detail: string;
}

export interface ReportKPIs {
  totalPlan: number;
  mappedProduction: number;
  totalProduction: number;
  unmappedProduction: number;
  orderQty: number | null;
  saleQty: number | null;
  variance: number;
  achievementPct: number | null;
  achievementRemark: AchievementRemark;
  plannedItemCount: number;
  categoryCount: number;
}

export interface SourceAvailability {
  available: boolean;
  label: string;
  note: string;
}

export interface PlanVsActualReport {
  month: string;
  segment: "PTMT" | "Plumbing";
  lifecycle: string;
  generatedAt: string;
  dataAvailable: boolean;
  unavailableReason: string | null;
  workingDays: number;
  workingDaysSource: WorkingDaysSource;
  lastDataDate: string | null;
  planVersions: PlanVersionSummary[];
  sources: {
    plan: string;
    production: string;
    orders: SourceAvailability;
    sales: SourceAvailability;
  };
  weekCalendar: WeekCalendarEntry[];
  kpis: ReportKPIs;
  categories: ReportCategory[];
  outOfPlan: OutOfPlanRow[];
  invariants: ReportInvariant[];
}

// ── Internal types ────────────────────────────────────────────────────────────

/** Week-indexed exact-key transaction totals. */
export interface DatedTotals {
  /** exact[week][itemKey(code,colour)] → qty for that week */
  exact: [Map<string, number>, Map<string, number>, Map<string, number>, Map<string, number>];
  /** monthly totals: exact key → total across all weeks */
  monthlyExact: Map<string, number>;
  /** true when date information was present and per-week allocation is trustworthy */
  hasWeeklyDates: boolean;
  rowCount: number;
}

export interface TransactionReadResult {
  totals: DatedTotals;
  /** True when the requested source/tab was read successfully, even if it had zero rows. */
  available: boolean;
  note: string;
}

interface TransactionReaderDeps {
  listTabs: (sheetId: string) => Promise<string[]>;
  getTabValues: (sheetId: string, tab: string, range?: string) => Promise<string[][]>;
}

type PlanMapEntry = {
  itemCode: string;
  colour: string;
  category: string;
  plan: number;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
};

// ── Achievement boundary (integer cross-multiplication) ───────────────────────

/**
 * Achievement classification via integer cross-multiplication to avoid float traps.
 * UNDER:      produced*100 <  plan*80
 * ON TARGET:  produced*100 >= plan*80  AND  produced*100 <= plan*110
 * OVER:       produced*100 >  plan*110
 * null:       plan = 0
 */
export function achievementRemark(plan: number, produced: number): AchievementRemark {
  if (plan === 0) return null;
  const p100 = produced * 100;
  const p80 = plan * 80;
  const p110 = plan * 110;
  if (p100 < p80) return "UNDER";
  if (p100 > p110) return "OVER";
  return "ON TARGET";
}

export function achievementPct(plan: number, produced: number): number | null {
  if (plan === 0) return null;
  return Math.round((produced / plan) * 10000) / 100; // 2 dp
}

// ── Plumbing unmatched group classifier ──────────────────────────────────────

/**
 * The allow-list of Plumbing ORDER groups for classifying an UNMATCHED order row
 * as belonging to the Plumbing segment.
 * Used only AFTER a transaction has failed to exact-match a planned roster key.
 * Exact string equality only — no trimming, no prefix matching.
 */
const PLUMBING_UNMATCHED_GROUPS = new Set(["CPVC", "UPVC", "SWR", "AGRI"]);

/**
 * Returns true when a GROUP value identifies an unmatched order row as Plumbing.
 * Exported so it can be tested in isolation.
 */
export function isPlumbingUnmatchedGroup(group: string): boolean {
  return PLUMBING_UNMATCHED_GROUPS.has(group);
}

// ── Plan map builder (version-aware, date-proportional) ─────────────────────

/**
 * Build a per-item plan map using the same date-proportional week semantics as
 * plant-weekly-engine. Each calendar day is attributed to the version whose
 * effectiveFrom <= day. The target's w1-w4 values are scaled by the fraction of
 * that week's days governed by that version.
 *
 * The plan-map key is itemKey(itemCode, colour) — identical normalisation used
 * by the transaction lookup so keys always match.
 */
export function buildVersionAwarePlanMap(
  month: string,
  versionTimeline: PlanVersion[],
): Map<string, PlanMapEntry> {
  const calendar = buildWeekCalendar(month);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const [y, m] = month.split("-").map(Number);

  const byKey = new Map<string, PlanMapEntry>();

  if (versionTimeline.length === 0) return byKey;

  for (let weekIdx = 0; weekIdx < 4; weekIdx++) {
    const wk = calendar[weekIdx]!;
    const totalDays = wk.endDay - wk.startDay + 1;

    // Group calendar days by the version that governs each day.
    const daysByVersion = new Map<string, { count: number; version: PlanVersion }>();
    for (let day = wk.startDay; day <= wk.endDay; day++) {
      const date = `${y}-${pad2(m)}-${pad2(day)}`;
      const version = versionForDate(versionTimeline, date);
      if (!version) continue;
      const vkey = `${version.kind}:${version.sourceId}`;
      const existing = daysByVersion.get(vkey);
      if (existing) {
        existing.count++;
      } else {
        daysByVersion.set(vkey, { count: 1, version });
      }
    }

    for (const { count, version } of daysByVersion.values()) {
      const ratio = count / totalDays;

      for (const target of version.targets) {
        const codeUpper = normalizeCode(target.itemCode);
        // Omit Opening Stock and DUMMY rows
        if (codeUpper === "OPENING STOCK" || codeUpper.startsWith("DUMMY")) continue;

        const weekPlan = [target.w1, target.w2, target.w3, target.w4][weekIdx] ?? 0;
        const weekContrib = weekPlan * ratio;

        // Use itemKey for the plan-map key — same normalisation as transaction lookup.
        const ck = itemKey(target.itemCode, target.colour);
        const existing = byKey.get(ck);
        if (existing) {
          existing.plan += weekContrib;
          if (weekIdx === 0) existing.w1 += weekContrib;
          else if (weekIdx === 1) existing.w2 += weekContrib;
          else if (weekIdx === 2) existing.w3 += weekContrib;
          else existing.w4 += weekContrib;
        } else {
          byKey.set(ck, {
            itemCode: target.itemCode,
            colour: target.colour,
            category: target.category,
            plan: weekContrib,
            w1: weekIdx === 0 ? weekContrib : 0,
            w2: weekIdx === 1 ? weekContrib : 0,
            w3: weekIdx === 2 ? weekContrib : 0,
            w4: weekIdx === 3 ? weekContrib : 0,
          });
        }
      }
    }
  }

  // Round each weekly contribution first, then derive the item total from those
  // exact integers. This keeps item/category/report reconciliation invariant:
  // total plan must always equal W1 + W2 + W3 + W4.
  for (const v of byKey.values()) {
    v.w1 = Math.round(v.w1);
    v.w2 = Math.round(v.w2);
    v.w3 = Math.round(v.w3);
    v.w4 = Math.round(v.w4);
    v.plan = v.w1 + v.w2 + v.w3 + v.w4;
  }
  return byKey;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTH_ABBREVS: Record<string, string[]> = {
  "01": ["Jan", "January"],
  "02": ["Feb", "February"],
  "03": ["Mar", "March"],
  "04": ["Apr", "April"],
  "05": ["May"],
  "06": ["Jun", "June"],
  "07": ["Jul", "July"],
  "08": ["Aug", "August"],
  "09": ["Sep", "September"],
  "10": ["Oct", "October"],
  "11": ["Nov", "November"],
  "12": ["Dec", "December"],
};

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  const n = parseFloat(String(v ?? "0").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function emptyDatedTotals(): DatedTotals {
  return {
    exact: [new Map(), new Map(), new Map(), new Map()],
    monthlyExact: new Map(),
    hasWeeklyDates: false,
    rowCount: 0,
  };
}

/**
 * Add qty to a DatedTotals bucket.
 * @param weekIdx 0-3; pass -1 when the date is unknown (monthly-only accumulation).
 */
function addToDated(
  totals: DatedTotals,
  code: unknown,
  colour: unknown,
  qty: number,
  weekIdx: 0 | 1 | 2 | 3 | -1,
): void {
  const key = itemKey(code, colour);
  totals.monthlyExact.set(key, (totals.monthlyExact.get(key) ?? 0) + qty);
  totals.rowCount++;
  if (weekIdx >= 0 && weekIdx <= 3) {
    const wm = totals.exact[weekIdx as 0 | 1 | 2 | 3];
    wm.set(key, (wm.get(key) ?? 0) + qty);
  }
}

/**
 * Determine week index (0-3) from a date string "YYYY-MM-DD" within the given month.
 * Returns -1 if the date is not in the expected month.
 */
function weekIdxFromDate(dateStr: string, month: string): 0 | 1 | 2 | 3 | -1 {
  if (!dateStr || dateStr.slice(0, 7) !== month) return -1;
  const day = parseInt(dateStr.slice(8), 10);
  if (!day) return -1;
  if (day <= 7) return 0;
  if (day <= 14) return 1;
  if (day <= 21) return 2;
  return 3;
}

/**
 * Parse and classify a transaction date. `null` means the date is untrustworthy;
 * `-1` means it is a valid date outside the requested report month.
 */
export function transactionWeekFromCell(
  cell: unknown,
  month: string,
): 0 | 1 | 2 | 3 | -1 | null {
  const parsed = parseDateCell(cell);
  return parsed === null ? null : weekIdxFromDate(parsed, month);
}

/** Strict Combined-tab month/year matching, e.g. Aug-26 matches only 2026-08. */
export function matchesTransactionMonthLabel(value: unknown, month: string): boolean {
  const [year, monthNumber] = month.split("-");
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!year || !monthNumber || !normalized) return false;
  const monthTokens = MONTH_ABBREVS[monthNumber] ?? [];
  const monthMatches = monthTokens.some((token) =>
    normalized.includes(token.toLowerCase().replace(/[^a-z0-9]/g, "")),
  );
  const yearMatches = normalized.includes(year) || normalized.includes(year.slice(2));
  return monthMatches && yearMatches;
}

function formatValidIsoDate(yearText: string, monthText: string, dayText: string): string | null {
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    year < 1900 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parse a cell that may be a date serial, ISO string, or display-formatted date.
 * Returns "YYYY-MM-DD" or null.
 */
export function parseDateCell(cell: unknown): string | null {
  if (!cell) return null;
  const s = String(cell).trim();

  // ISO date: 2025-07-14 or 2025-07-14T...
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T|$)/);
  if (iso) return formatValidIsoDate(iso[1]!, iso[2]!, iso[3]!);

  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const year = y!.length === 2 ? `20${y}` : y;
    return formatValidIsoDate(year!, m!, d!);
  }

  // Display dates used by the live Order and Sale sheets, e.g. "3-Aug-2026".
  const dMonY = s.match(/^(\d{1,2})[\s\-\/]([A-Za-z]{3,9})[\s\-\/](\d{2,4})$/);
  if (dMonY) {
    const [, day, monthName, rawYear] = dMonY;
    const normalizedMonth = monthName!.slice(0, 3).toLowerCase();
    const monthNumber = [
      "jan", "feb", "mar", "apr", "may", "jun",
      "jul", "aug", "sep", "oct", "nov", "dec",
    ].indexOf(normalizedMonth) + 1;
    if (monthNumber > 0) {
      const year = rawYear!.length === 2 ? `20${rawYear}` : rawYear;
      return formatValidIsoDate(year!, String(monthNumber), day!);
    }
  }

  // Excel date serial (number >= 1)
  const n = Number(cell);
  if (Number.isFinite(n) && n > 1) {
    // Excel epoch: 1900-01-01 = serial 1, but has a leap-year bug for 1900
    const msPerDay = 86400000;
    const excelEpoch = new Date("1899-12-30T00:00:00Z").getTime();
    const d = new Date(excelEpoch + n * msPerDay);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

// ── Order sheet reader ────────────────────────────────────────────────────────

/**
 * Fetch Order Sheet 26-27 transaction rows for the given month.
 *
 * KEY RULES (audit gap #1 & #2):
 *  - All transaction rows are loaded. GROUP is NOT used to pre-filter rows
 *    before they enter the map. GROUP is stored per-row and exposed to callers
 *    who may use it to classify UNMATCHED orders.
 *  - Date column is detected and used to place each row in W1-W4.
 *  - If dates are untrustworthy/absent, hasWeeklyDates = false and weekly maps
 *    stay empty; monthly totals are still populated.
 *  - Always keys on itemKey(code, colour) via addToDated → no byCode fallback.
 */
export async function fetchOrderDatedTotals(
  month: string,
  deps: TransactionReaderDeps = { listTabs, getTabValues: throttledGetTabValues },
): Promise<{
  totals: DatedTotals;
  groupByKey: Map<string, string>; // itemKey → last GROUP value seen
  available: boolean;
  note: string;
}> {
  const [, mNum] = month.split("-").map(Number);
  const abbrevs = MONTH_ABBREVS[String(mNum).padStart(2, "0")] ?? [];
  const [yStr] = month.split("-");
  const yearShort = yStr!.slice(2);

  try {
    const tabs = await deps.listTabs(SHEET_IDS.orderSheet);

    // Prefer per-month tab with year+month in name.
    const monthTab =
      tabs.find((t) => {
        const lower = t.toLowerCase().replace(/[\s'`\-]/g, "");
        const monthMatch = abbrevs.some((a) => lower.includes(a.toLowerCase()));
        const yearMatch = lower.includes(yearShort) || lower.includes(yStr!);
        return monthMatch && yearMatch;
      }) ??
      tabs.find((t) => {
        const lower = t.toLowerCase().replace(/[\s'`\-]/g, "");
        return abbrevs.some((a) => lower.includes(a.toLowerCase()));
      });

    const totals = emptyDatedTotals();
    const groupByKey = new Map<string, string>();

    if (monthTab) {
      // Read per-month tab — try wide range to capture date column if present.
      const values = await deps.getTabValues(SHEET_IDS.orderSheet, monthTab, "A1:N50000");

      // Find header row.
      const headerRowIdx = values.findIndex((row) =>
        row.some(
          (cell) =>
            /old.*erp|erp.*code|item.?code/i.test(String(cell)) ||
            /colou?r/i.test(String(cell)),
        ),
      );
      if (headerRowIdx < 0) {
        logger.warn({ monthTab }, "plan-vs-actual: order per-month tab: no header row");
        return {
          totals,
          groupByKey,
          available: false,
          note: `Tab "${monthTab}" found but its transaction header could not be detected`,
        };
      }

      const header = values[headerRowIdx].map((h) => String(h ?? "").trim());
      const codeIdx   = header.findIndex((h) => /old.*erp|erp.*code|item.?code/i.test(h));
      const colourIdx = header.findIndex((h) => /colou?r/i.test(h));
      const qtyIdx    = header.findIndex((h) => /^qty$|quantity/i.test(h));
      const groupIdx  = header.findIndex((h) => /^group$/i.test(h));
      const dateIdx   = header.findIndex((h) => /^date$|order.*date|dispatch.*date/i.test(h));

      if (dateIdx < 0) {
        return {
          totals,
          groupByKey,
          available: false,
          note: `Tab "${monthTab}" found but its transaction date column could not be detected`,
        };
      }

      let datesTrustworthy = dateIdx >= 0;
      let skippedUnparseableDates = 0;

      for (let i = headerRowIdx + 1; i < values.length; i++) {
        const row = values[i];
        const code = codeIdx >= 0 ? row[codeIdx] : row[1];
        if (!code || String(code).trim() === "") continue;
        const colour = colourIdx >= 0 ? row[colourIdx] : row[3];
        const qty = toNum(qtyIdx >= 0 ? row[qtyIdx] : row[5]);
        if (qty <= 0) continue;

        let wkIdx: 0 | 1 | 2 | 3 | -1 = -1;
        if (dateIdx >= 0) {
          const classified = transactionWeekFromCell(row[dateIdx], month);
          if (classified === null) {
            datesTrustworthy = false;
            skippedUnparseableDates++;
            continue;
          }
          if (classified < 0) continue;
          wkIdx = classified;
        }

        addToDated(totals, code, colour, qty, wkIdx);

        // Store GROUP for post-match unmatched classification.
        if (groupIdx >= 0) {
          const grp = String(row[groupIdx] ?? "").trim().toUpperCase();
          if (grp) {
            const key = itemKey(code, colour);
            if (!groupByKey.has(key)) groupByKey.set(key, grp);
          }
        }
      }

      totals.hasWeeklyDates = dateIdx >= 0 && datesTrustworthy;
      logger.info(
        {
          month,
          tab: monthTab,
          rows: totals.rowCount,
          hasWeeklyDates: totals.hasWeeklyDates,
          skippedUnparseableDates,
        },
        "plan-vs-actual: orders from per-month tab",
      );
      return {
        totals,
        groupByKey,
        available: true,
        note: totals.hasWeeklyDates
          ? `Tab "${monthTab}" (${totals.rowCount} rows, dates parsed → W1-W4)`
          : `Tab "${monthTab}" (${totals.rowCount} rows, weekly dates unavailable${skippedUnparseableDates > 0 ? `; ${skippedUnparseableDates} unparseable dated rows omitted` : ""})`,
      };
    }

    // Fallback: Combined tab — filter rows by month column.
    logger.info({ month, tabs }, "plan-vs-actual: no per-month order tab, trying Combined");
    const values = await deps.getTabValues(SHEET_IDS.orderSheet, "Combined");
    if (!values.length) {
      return {
        totals,
        groupByKey,
        available: false,
        note: "Order sheet unavailable (no per-month tab and Combined is empty)",
      };
    }

    const header = values[0].map((h) => String(h ?? "").trim());
    const codeIdx   = header.findIndex((h) => /old.*erp|erp.*code|item.?code/i.test(h));
    const colourIdx = header.findIndex((h) => /colou?r/i.test(h));
    const qtyIdx    = header.findIndex((h) => /^qty$|quantity/i.test(h));
    const groupIdx  = header.findIndex((h) => /^group$/i.test(h));
    const dateIdx   = header.findIndex((h) => /^date$|order.*date/i.test(h));
    const monthIdx  = header.findIndex((h) => /^month$/i.test(h));

    if (dateIdx < 0 && monthIdx < 0) {
      return {
        totals,
        groupByKey,
        available: false,
        note: "Combined order tab has neither a date nor a month/year column",
      };
    }

    let datesTrustworthy = dateIdx >= 0;
    let skippedUnparseableDates = 0;

    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const code = codeIdx >= 0 ? row[codeIdx] : undefined;
      if (!code || String(code).trim() === "") continue;

      const colour = colourIdx >= 0 ? row[colourIdx] : undefined;
      const qty = toNum(qtyIdx >= 0 ? row[qtyIdx] : undefined);
      if (qty <= 0) continue;

      let wkIdx: 0 | 1 | 2 | 3 | -1 = -1;
      if (dateIdx >= 0) {
        const classified = transactionWeekFromCell(row[dateIdx], month);
        if (classified === null) {
          datesTrustworthy = false;
          skippedUnparseableDates++;
          continue;
        }
        if (classified < 0) continue;
        wkIdx = classified;
      } else if (!matchesTransactionMonthLabel(row[monthIdx], month)) {
        continue;
      }

      addToDated(totals, code, colour, qty, wkIdx);

      if (groupIdx >= 0) {
        const grp = String(row[groupIdx] ?? "").trim().toUpperCase();
        if (grp) {
          const key = itemKey(code, colour);
          if (!groupByKey.has(key)) groupByKey.set(key, grp);
        }
      }
    }

    totals.hasWeeklyDates = dateIdx >= 0 && datesTrustworthy;
    logger.info(
      {
        month,
        rows: totals.rowCount,
        hasWeeklyDates: totals.hasWeeklyDates,
        skippedUnparseableDates,
      },
      "plan-vs-actual: orders from Combined tab",
    );
    return {
      totals,
      groupByKey,
      available: true,
      note: totals.hasWeeklyDates
        ? `Combined tab (${totals.rowCount} rows, dates parsed → W1-W4)`
        : `Combined tab (${totals.rowCount} rows, weekly dates unavailable${skippedUnparseableDates > 0 ? `; ${skippedUnparseableDates} unparseable dated rows omitted` : ""})`,
    };
  } catch (err) {
    logger.warn({ month, err: String(err) }, "plan-vs-actual: order sheet unavailable");
    return {
      totals: emptyDatedTotals(),
      groupByKey: new Map(),
      available: false,
      note: `Order sheet unavailable: ${String(err)}`,
    };
  }
}

// ── Sale sheet reader ─────────────────────────────────────────────────────────

/**
 * Fetch SALE SHEET 26-27 transactions for the given month.
 *
 * KEY RULES (audit gap #3):
 *  - No GROUP column in sales — all rows are loaded, keyed on itemKey(code, colour).
 *  - Only exact roster matches will be reported; the engine never infers unmatched
 *    Plumbing sales.
 *  - Date column detected and used to place rows in W1-W4.
 */
export async function fetchSaleDatedTotals(
  month: string,
  deps: TransactionReaderDeps = { listTabs, getTabValues: throttledGetTabValues },
): Promise<TransactionReadResult> {
  const [, mNum] = month.split("-").map(Number);
  const abbrevs = MONTH_ABBREVS[String(mNum).padStart(2, "0")] ?? [];

  try {
    const tabs = await deps.listTabs(SHEET_IDS.saleSheet2627);
    const matchTab = tabs.find((t) => {
      const n = t.toLowerCase().replace(/[\s'`]/g, "");
      return abbrevs.some((a) => n.includes(a.toLowerCase()));
    });

    if (!matchTab) {
      logger.warn({ month, tabs }, "plan-vs-actual: no SALE SHEET tab for month");
      return {
        totals: emptyDatedTotals(),
        available: false,
        note: "No SALE SHEET tab found for month",
      };
    }

    const raw = await deps.getTabValues(SHEET_IDS.saleSheet2627, matchTab, "A1:N300000");
    if (raw.length === 0) {
      return {
        totals: emptyDatedTotals(),
        available: false,
        note: `Tab "${matchTab}" is empty and has no transaction header`,
      };
    }

    const hdr = raw[0].map((h) => String(h ?? "").trim());
    const codeCol = (() => {
      const i = hdr.findIndex((h) => /item.?code|cat.?no|old.?item|^code$/i.test(h));
      return i >= 0 ? i : 7;
    })();
    const colourCol = (() => {
      const i = hdr.findIndex((h) => /colou?r/i.test(h));
      return i >= 0 ? i : 8;
    })();
    const qtyCol = (() => {
      const i = hdr.findIndex((h) => /^qty$|^quantity$|^sale.?qty/i.test(h));
      return i >= 0 ? i : 9;
    })();
    const dateCol = hdr.findIndex((h) => /^date$|sale.*date|invoice.*date|dispatch.*date/i.test(h));

    if (dateCol < 0) {
      return {
        totals: emptyDatedTotals(),
        available: false,
        note: `Tab "${matchTab}" found but its transaction date column could not be detected`,
      };
    }

    if (raw.length < 2) {
      return {
        totals: emptyDatedTotals(),
        available: true,
        note: `Tab "${matchTab}" is available with 0 transaction rows`,
      };
    }

    const totals = emptyDatedTotals();
    let datesTrustworthy = dateCol >= 0;
    let skippedUnparseableDates = 0;

    for (let r = 1; r < raw.length; r++) {
      const row = raw[r];
      const code = row[codeCol];
      if (!code || String(code).trim() === "") continue;
      const colour = row[colourCol];
      const qtyRaw = row[qtyCol];
      if (qtyRaw == null || qtyRaw === "") continue;
      const qty = toNum(qtyRaw);
      if (qty <= 0) continue;

      let wkIdx: 0 | 1 | 2 | 3 | -1 = -1;
      if (dateCol >= 0) {
        const classified = transactionWeekFromCell(row[dateCol], month);
        if (classified === null) {
          datesTrustworthy = false;
          skippedUnparseableDates++;
          continue;
        }
        if (classified < 0) continue;
        wkIdx = classified;
      }

      addToDated(totals, code, colour, qty, wkIdx);
    }

    totals.hasWeeklyDates = dateCol >= 0 && datesTrustworthy;
    logger.info(
      {
        month,
        tab: matchTab,
        rows: totals.rowCount,
        hasWeeklyDates: totals.hasWeeklyDates,
        skippedUnparseableDates,
      },
      "plan-vs-actual: sales loaded",
    );
    return {
      totals,
      available: true,
      note: totals.hasWeeklyDates
        ? `Tab "${matchTab}" (${totals.rowCount} rows, dates parsed → W1-W4)`
        : `Tab "${matchTab}" (${totals.rowCount} rows, weekly dates unavailable${skippedUnparseableDates > 0 ? `; ${skippedUnparseableDates} unparseable dated rows omitted` : ""})`,
    };
  } catch (err) {
    logger.warn({ month, err: String(err) }, "plan-vs-actual: sale sheet unavailable");
    return {
      totals: emptyDatedTotals(),
      available: false,
      note: `SALE SHEET unavailable: ${String(err)}`,
    };
  }
}

// ── Transaction lookup against plan roster ────────────────────────────────────

/**
 * Look up the transaction qty for an exact roster itemKey.
 * Returns 0 when the source is available but the key has no transactions.
 * If the DatedTotals has weekly date data, returns per-week; otherwise null per-week.
 */
function resolveTransactionQty(
  totals: DatedTotals,
  ck: string, // already-normalised itemKey
): { monthly: number; weeks: [number | null, number | null, number | null, number | null] } {
  const monthly = totals.monthlyExact.get(ck) ?? 0;
  if (!totals.hasWeeklyDates) {
    return { monthly, weeks: [null, null, null, null] };
  }
  const weeks: [number | null, number | null, number | null, number | null] = [
    totals.exact[0].get(ck) ?? 0,
    totals.exact[1].get(ck) ?? 0,
    totals.exact[2].get(ck) ?? 0,
    totals.exact[3].get(ck) ?? 0,
  ];
  return { monthly, weeks };
}

// ── Plan version audit label ──────────────────────────────────────────────────

function buildAuditLabel(version: PlanVersion): string {
  const label = version.sourceLabel ?? `${version.kind} #${version.sourceId}`;
  const base = `${label} · effective ${version.effectiveFrom}`;
  if (!version.selection || version.selection.candidateCount <= 1) return base;
  const reason =
    version.selection.reason === "latest_source_issuance"
      ? "latest source issuance"
      : "source-id tie-breaker after equal issuance time";
  return `${base} · canonical: ${reason}; ${version.selection.superseded.length} same-day revision superseded`;
}

// ── Invariant checks ──────────────────────────────────────────────────────────

function buildInvariants(
  planMap: Map<string, PlanMapEntry>,
  categories: ReportCategory[],
  kpis: ReportKPIs,
  _weekCalendar: WeekCalendarEntry[],
): ReportInvariant[] {
  const inv: ReportInvariant[] = [];

  inv.push({
    code: "PROD_CONSERVATION",
    ok: kpis.mappedProduction + kpis.unmappedProduction === kpis.totalProduction,
    expected: kpis.totalProduction,
    actual: kpis.mappedProduction + kpis.unmappedProduction,
    detail: `mapped(${kpis.mappedProduction}) + unmapped(${kpis.unmappedProduction}) = total(${kpis.totalProduction})`,
  });

  const catPlanSum = categories.reduce((s, c) => s + c.plan, 0);
  inv.push({
    code: "CAT_PLAN_SUM",
    ok: catPlanSum === kpis.totalPlan,
    expected: kpis.totalPlan,
    actual: catPlanSum,
    detail: "sum of category plans equals total plan",
  });

  const catProdSum = categories.reduce((s, c) => s + c.production, 0);
  inv.push({
    code: "CAT_PROD_SUM",
    ok: catProdSum === kpis.mappedProduction,
    expected: kpis.mappedProduction,
    actual: catProdSum,
    detail: "sum of category production equals mapped production",
  });

  let itemWeeklyMismatch = 0;
  for (const cat of categories) {
    for (const item of cat.items) {
      const wPlanSum = item.weeks.reduce((s, w) => s + w.plan, 0);
      const wProdSum = item.weeks.reduce((s, w) => s + w.production, 0);
      if (wPlanSum !== item.plan || wProdSum !== item.production) itemWeeklyMismatch++;
    }
  }
  inv.push({
    code: "ITEM_WEEKLY_SUMS",
    ok: itemWeeklyMismatch === 0,
    expected: 0,
    actual: itemWeeklyMismatch,
    detail: "items where weekly plan+prod sums differ from item totals",
  });

  let catWeeklyMismatch = 0;
  for (const cat of categories) {
    const wPlanSum = cat.weeks.reduce((s, w) => s + w.plan, 0);
    const wProdSum = cat.weeks.reduce((s, w) => s + w.production, 0);
    if (wPlanSum !== cat.plan || wProdSum !== cat.production) catWeeklyMismatch++;
  }
  inv.push({
    code: "CAT_WEEKLY_SUMS",
    ok: catWeeklyMismatch === 0,
    expected: 0,
    actual: catWeeklyMismatch,
    detail: "categories where weekly plan+prod sums differ from category totals",
  });

  let orderWeeklyMismatch = 0;
  let saleWeeklyMismatch = 0;
  for (const cat of categories) {
    if (cat.orders !== null && cat.weeks.every((week) => week.orders !== null)) {
      const weeklyOrders = cat.weeks.reduce((sum, week) => sum + (week.orders ?? 0), 0);
      if (weeklyOrders !== cat.orders) orderWeeklyMismatch++;
    }
    if (cat.sales !== null && cat.weeks.every((week) => week.sales !== null)) {
      const weeklySales = cat.weeks.reduce((sum, week) => sum + (week.sales ?? 0), 0);
      if (weeklySales !== cat.sales) saleWeeklyMismatch++;
    }
  }
  inv.push({
    code: "ORDER_WEEKLY_SUMS",
    ok: orderWeeklyMismatch === 0,
    expected: 0,
    actual: orderWeeklyMismatch,
    detail: "categories where dated W1-W4 orders differ from monthly matched orders",
  });
  inv.push({
    code: "SALES_WEEKLY_SUMS",
    ok: saleWeeklyMismatch === 0,
    expected: 0,
    actual: saleWeeklyMismatch,
    detail: "categories where dated W1-W4 sales differ from monthly matched sales",
  });

  const rosterCount = [...planMap.values()].filter((v) => v.plan > 0).length;
  inv.push({
    code: "PLANNED_ITEM_COUNT",
    ok: rosterCount === kpis.plannedItemCount,
    expected: kpis.plannedItemCount,
    actual: rosterCount,
    detail: "items with plan > 0 in roster",
  });

  inv.push({
    code: "CATEGORY_COUNT",
    ok: categories.length === kpis.categoryCount,
    expected: kpis.categoryCount,
    actual: categories.length,
    detail: "distinct categories in report",
  });

  const expectedVariance = kpis.mappedProduction - kpis.totalPlan;
  inv.push({
    code: "VARIANCE_FORMULA",
    ok: kpis.variance === expectedVariance,
    expected: expectedVariance,
    actual: kpis.variance,
    detail: "variance = mappedProduction - totalPlan",
  });

  return inv;
}

// ── Build item/category rows from plan map + production + transactions ────────

interface TransactionSources {
  orders: { totals: DatedTotals | null; note: string };
  sales: { totals: DatedTotals | null; note: string };
}

function buildCategoriesFromPlanMap(
  planMap: Map<string, PlanMapEntry>,
  productionByKey: Map<string, [number, number, number, number]>,
  tx: TransactionSources,
): ReportCategory[] {
  const categoryMap = new Map<string, ReportItem[]>();

  for (const [ck, pv] of planMap) {
    const codeUpper = normalizeCode(pv.itemCode);
    if (codeUpper === "OPENING STOCK" || codeUpper.startsWith("DUMMY")) continue;
    if (pv.plan <= 0) continue;

    const prodArr = productionByKey.get(ck) ?? [0, 0, 0, 0];
    const totalProduction = prodArr.reduce((s, v) => s + v, 0);

    // Transaction lookup — ALWAYS exact key only.
    const orderResult = tx.orders.totals
      ? resolveTransactionQty(tx.orders.totals, ck)
      : null;
    const saleResult = tx.sales.totals
      ? resolveTransactionQty(tx.sales.totals, ck)
      : null;

    const planWeeks = [pv.w1, pv.w2, pv.w3, pv.w4];
    const weeks: ItemWeekDetail[] = [1, 2, 3, 4].map((wk, i) => ({
      week: wk as 1 | 2 | 3 | 4,
      plan: planWeeks[i]!,
      production: prodArr[i]!,
      orders: orderResult ? (orderResult.weeks[i] !== null ? orderResult.weeks[i] : null) : null,
      sales: saleResult ? (saleResult.weeks[i] !== null ? saleResult.weeks[i] : null) : null,
    }));

    const item: ReportItem = {
      itemCode: pv.itemCode,
      colour: pv.colour,
      category: pv.category,
      plan: pv.plan,
      production: totalProduction,
      orders: orderResult !== null ? orderResult.monthly : null,
      sales: saleResult !== null ? saleResult.monthly : null,
      variance: totalProduction - pv.plan,
      achievementPct: achievementPct(pv.plan, totalProduction),
      achievementRemark: achievementRemark(pv.plan, totalProduction),
      weeks,
    };

    const catItems = categoryMap.get(pv.category) ?? [];
    catItems.push(item);
    categoryMap.set(pv.category, catItems);
  }

  const categories: ReportCategory[] = [];
  for (const [category, items] of categoryMap) {
    const catPlan = items.reduce((s, i) => s + i.plan, 0);
    const catProd = items.reduce((s, i) => s + i.production, 0);

    const catOrders = tx.orders.totals !== null
      ? items.reduce((s, i) => s + (i.orders ?? 0), 0)
      : null;
    const catSales = tx.sales.totals !== null
      ? items.reduce((s, i) => s + (i.sales ?? 0), 0)
      : null;

    const catWeeks: ReportCategory["weeks"] = [1, 2, 3, 4].map((wk, i) => {
      const wPlanSum = items.reduce((s, it) => s + it.weeks[i]!.plan, 0);
      const wProdSum = items.reduce((s, it) => s + it.weeks[i]!.production, 0);

      // Weekly orders: sum only when at least one item has a non-null weekly order
      const wOrders = tx.orders.totals !== null
        ? (tx.orders.totals.hasWeeklyDates
            ? items.reduce((s, it) => s + (it.weeks[i]!.orders ?? 0), 0)
            : null)
        : null;
      const wSales = tx.sales.totals !== null
        ? (tx.sales.totals.hasWeeklyDates
            ? items.reduce((s, it) => s + (it.weeks[i]!.sales ?? 0), 0)
            : null)
        : null;

      return {
        week: wk as 1 | 2 | 3 | 4,
        plan: wPlanSum,
        production: wProdSum,
        orders: wOrders,
        sales: wSales,
      };
    });

    categories.push({
      category,
      itemCount: items.length,
      plan: catPlan,
      production: catProd,
      orders: catOrders,
      sales: catSales,
      variance: catProd - catPlan,
      achievementPct: achievementPct(catPlan, catProd),
      achievementRemark: achievementRemark(catPlan, catProd),
      weeks: catWeeks,
      items: items.sort((a, b) => a.itemCode.localeCompare(b.itemCode)),
    });
  }

  categories.sort((a, b) => b.plan - a.plan);
  return categories;
}

// ── PTMT report builder ───────────────────────────────────────────────────────

async function buildPtmtReport(month: string, now: Date): Promise<PlanVsActualReport> {
  const lifecycle = resolvePlantMonthLifecycle(month, now);

  const [configRow] = await db
    .select()
    .from(plantConfigsTable)
    .where(eq(plantConfigsTable.month, month));
  const { workingDays, workingDaysSource } = resolveWorkingDays(month, configRow?.workingDays);

  const weekCalendar: WeekCalendarEntry[] = buildWeekCalendar(month).map((wk) => ({
    week: wk.week,
    startDate: wk.startDate,
    endDate: wk.endDate,
    label: wk.label,
  }));

  const buildUnavailable = (reason: string): PlanVsActualReport => ({
    month,
    segment: "PTMT",
    lifecycle: lifecycle.state,
    generatedAt: now.toISOString(),
    dataAvailable: false,
    unavailableReason: reason,
    workingDays,
    workingDaysSource,
    lastDataDate: null,
    planVersions: [],
    sources: {
      plan: "unavailable",
      production: "unavailable",
      orders: { available: false, label: "Order Sheet 26-27", note: "No plan data" },
      sales: { available: false, label: "SALE SHEET 26-27", note: "No plan data" },
    },
    weekCalendar,
    kpis: {
      totalPlan: 0,
      mappedProduction: 0,
      totalProduction: 0,
      unmappedProduction: 0,
      orderQty: null,
      saleQty: null,
      variance: 0,
      achievementPct: null,
      achievementRemark: null,
      plannedItemCount: 0,
      categoryCount: 0,
    },
    categories: [],
    outOfPlan: [],
    invariants: [],
  });

  let versionTimeline: PlanVersion[];
  let actuals: DailyActualRow[];
  let planSource: string;
  let productionSource: string;

  if (lifecycle.state === "closed") {
    let [snapshot] = await db
      .select()
      .from(plantMonitoringSnapshotsTable)
      .where(eq(plantMonitoringSnapshotsTable.month, month));

    if (!snapshot) {
      return buildUnavailable(
        "No frozen monitoring snapshot exists for this closed month. Capture the snapshot first via plant monitoring.",
      );
    }

    let sourceInfo = snapshot.sourceInfoJson as Partial<PlantSnapshotSourceInfo> | null;
    let frozenTimeline = sourceInfo?.planVersionTimeline;
    if (!Array.isArray(frozenTimeline) || frozenTimeline.length === 0) {
      const restored = await backfillLegacyPlantMonitoringSnapshot(month);
      if (restored.snapshot) {
        snapshot = restored.snapshot;
        sourceInfo = snapshot.sourceInfoJson as Partial<PlantSnapshotSourceInfo> | null;
        frozenTimeline = sourceInfo?.planVersionTimeline;
      }
      if (!Array.isArray(frozenTimeline) || frozenTimeline.length === 0) {
        return buildUnavailable(
          restored.reason
            ?? "The frozen snapshot predates item-level plan-version retention. A mutable live timeline will not be substituted for this closed month.",
        );
      }
    }

    actuals = snapshot.actualsJson as DailyActualRow[];
    versionTimeline = frozenTimeline;
    planSource = `Frozen issued plan timeline (${versionTimeline.length} version${versionTimeline.length === 1 ? "" : "s"}, captured ${snapshot.capturedAt.toISOString().slice(0, 10)})`;
    productionSource = `Frozen snapshot actuals (captured ${snapshot.capturedAt.toISOString().slice(0, 10)})`;
    logger.info({ month, planRunId: snapshot.planRunId }, "plan-vs-actual: PTMT closed month — reading from snapshot");
  } else if (lifecycle.state === "future") {
    return buildUnavailable("This is a future month — no plan or production data available.");
  } else {
    versionTimeline = await getPlanVersionTimeline(month, "PTMT");
    try {
      actuals = await fetchDailyActuals(month, {});
    } catch (err) {
      actuals = [];
      logger.warn({ month, err: String(err) }, "plan-vs-actual: PTMT actuals fetch failed, using empty");
    }
    planSource =
      versionTimeline.length > 0
        ? `Issued plan timeline (${versionTimeline.length} version${versionTimeline.length === 1 ? "" : "s"})`
        : "Live plan (no issued versions)";
    productionSource = "PTMT ANUJ Production sheet (daily actuals cache)";
  }

  if (versionTimeline.length === 0) {
    return buildUnavailable("No plan versions issued for this month.");
  }

  const planMap = buildVersionAwarePlanMap(month, versionTimeline);
  if (planMap.size === 0) {
    return buildUnavailable("Plan map is empty — no items with plan > 0 after version processing.");
  }

  // Fetch orders and sales in parallel.
  const [orderResult, saleResult] = await Promise.all([
    fetchOrderDatedTotals(month),
    fetchSaleDatedTotals(month),
  ]);
  const orderTotals = orderResult.available ? orderResult.totals : null;
  const saleTotals = saleResult.available ? saleResult.totals : null;
  const tx: TransactionSources = {
    orders: { totals: orderTotals, note: orderResult.note },
    sales: { totals: saleTotals, note: saleResult.note },
  };

  // ── Aggregate actuals by roster key + week ──────────────────────────────────
  const productionByKey = new Map<string, [number, number, number, number]>();
  const unmappedByWeek: [number, number, number, number] = [0, 0, 0, 0];
  const unmappedRows = new Map<
    string,
    { itemCode: string; colour: string; category: string | null; weeks: [number, number, number, number] }
  >();

  for (const row of actuals) {
    if (row.date.slice(0, 7) !== month) continue;
    const day = parseInt(row.date.slice(8), 10);
    const wkIdx: 0 | 1 | 2 | 3 = day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3;

    // Exact itemKey match first.
    const ck = itemKey(row.itemCode, row.colour);
    if ((planMap.get(ck)?.plan ?? 0) > 0) {
      const arr = productionByKey.get(ck) ?? [0, 0, 0, 0];
      arr[wkIdx] += row.qty;
      productionByKey.set(ck, arr);
      continue;
    }

    // If exact match fails, try strict-norm code match across the roster.
    // This handles "A465" vs "A-465" discrepancies in production sheets.
    const strictCode = normalizeCodeStrict(row.itemCode);
    let matched = false;
    for (const [pk, pv] of planMap) {
      if (pv.plan <= 0) continue;
      if (normalizeCodeStrict(pv.itemCode) === strictCode) {
        const arr = productionByKey.get(pk) ?? [0, 0, 0, 0];
        arr[wkIdx] += row.qty;
        productionByKey.set(pk, arr);
        matched = true;
        break;
      }
    }

    if (!matched) {
      unmappedByWeek[wkIdx] += row.qty;
      const umKey = itemKey(row.itemCode, row.colour);
      const umRow = unmappedRows.get(umKey) ?? {
        itemCode: row.itemCode,
        colour: row.colour,
        category:
          planMap.get(ck)?.category ??
          [...planMap.values()].find((pv) => normalizeCodeStrict(pv.itemCode) === strictCode)?.category ??
          null,
        weeks: [0, 0, 0, 0] as [number, number, number, number],
      };
      umRow.weeks[wkIdx] += row.qty;
      unmappedRows.set(umKey, umRow);
    }
  }

  // Build categories.
  const categories = buildCategoriesFromPlanMap(planMap, productionByKey, tx);

  // Out-of-plan rows.
  const outOfPlan: OutOfPlanRow[] = [...unmappedRows.values()]
    .map((r) => ({
      itemCode: r.itemCode,
      colour: r.colour,
      category: r.category,
      totalProduction: r.weeks.reduce((s, v) => s + v, 0),
      weeks: [...r.weeks],
    }))
    .filter((r) => r.totalProduction > 0)
    .sort((a, b) => b.totalProduction - a.totalProduction);

  const totalPlan = categories.reduce((s, c) => s + c.plan, 0);
  const mappedProduction = categories.reduce((s, c) => s + c.production, 0);
  const unmappedProduction = unmappedByWeek.reduce((s, v) => s + v, 0);
  const totalProduction = mappedProduction + unmappedProduction;

  const totalOrders =
    orderTotals !== null ? categories.reduce((s, c) => s + (c.orders ?? 0), 0) : null;
  const totalSales =
    saleTotals !== null ? categories.reduce((s, c) => s + (c.sales ?? 0), 0) : null;

  const kpis: ReportKPIs = {
    totalPlan,
    mappedProduction,
    totalProduction,
    unmappedProduction,
    orderQty: totalOrders,
    saleQty: totalSales,
    variance: mappedProduction - totalPlan,
    achievementPct: achievementPct(totalPlan, mappedProduction),
    achievementRemark: achievementRemark(totalPlan, mappedProduction),
    plannedItemCount: [...planMap.values()].filter((v) => v.plan > 0).length,
    categoryCount: categories.length,
  };

  const planVersions: PlanVersionSummary[] = versionTimeline.map((v) => ({
    kind: v.kind,
    sourceId: v.sourceId,
    sourceLabel: v.sourceLabel,
    effectiveFrom: v.effectiveFrom,
    effectiveTo: v.effectiveTo,
    auditLabel: buildAuditLabel(v),
  }));

  const lastDataDate =
    actuals.length > 0
      ? actuals
          .map((r) => r.date)
          .filter((d) => d.startsWith(month))
          .sort()
          .pop() ?? null
      : null;

  const invariants = buildInvariants(planMap, categories, kpis, weekCalendar);

  return {
    month,
    segment: "PTMT",
    lifecycle: lifecycle.state,
    generatedAt: now.toISOString(),
    dataAvailable: true,
    unavailableReason: null,
    workingDays,
    workingDaysSource,
    lastDataDate,
    planVersions,
    sources: {
      plan: planSource,
      production: productionSource,
      orders: {
        available: orderResult.available,
        label: "Order Sheet 26-27",
        note: orderResult.note,
      },
      sales: {
        available: saleResult.available,
        label: "SALE SHEET 26-27",
        note: saleResult.note,
      },
    },
    weekCalendar,
    kpis,
    categories,
    outOfPlan,
    invariants,
  };
}

// ── Plumbing report builder ───────────────────────────────────────────────────

async function buildPlumbingReport(month: string, now: Date): Promise<PlanVsActualReport> {
  const lifecycle = resolvePlantMonthLifecycle(month, now);

  const [configRow] = await db
    .select()
    .from(plantConfigsTable)
    .where(eq(plantConfigsTable.month, month));
  const { workingDays, workingDaysSource } = resolveWorkingDays(month, configRow?.workingDays);

  const weekCalendar: WeekCalendarEntry[] = buildWeekCalendar(month).map((wk) => ({
    week: wk.week,
    startDate: wk.startDate,
    endDate: wk.endDate,
    label: wk.label,
  }));

  const buildUnavailable = (reason: string): PlanVsActualReport => ({
    month,
    segment: "Plumbing",
    lifecycle: lifecycle.state,
    generatedAt: now.toISOString(),
    dataAvailable: false,
    unavailableReason: reason,
    workingDays,
    workingDaysSource,
    lastDataDate: null,
    planVersions: [],
    sources: {
      plan: "unavailable",
      production: "unavailable",
      orders: { available: false, label: "Order Sheet 26-27", note: "No plan data" },
      sales: { available: false, label: "SALE SHEET 26-27", note: "No plan data" },
    },
    weekCalendar,
    kpis: {
      totalPlan: 0,
      mappedProduction: 0,
      totalProduction: 0,
      unmappedProduction: 0,
      orderQty: null,
      saleQty: null,
      variance: 0,
      achievementPct: null,
      achievementRemark: null,
      plannedItemCount: 0,
      categoryCount: 0,
    },
    categories: [],
    outOfPlan: [],
    invariants: [],
  });

  if (lifecycle.state === "future") {
    return buildUnavailable("This is a future month — no plan or production data available.");
  }

  // Fetch Plumbing monitoring payload (cached) and version timeline in parallel.
  const [rawPayload, versionTimeline, orderResult, saleResult] = await Promise.all([
    getPlumbingMonitoringPayloadCached(month).catch((err: unknown) => {
      logger.warn({ month, err: String(err) }, "plan-vs-actual: Plumbing monitoring payload failed");
      return null;
    }),
    getPlanVersionTimeline(month, "Plumbing"),
    fetchOrderDatedTotals(month),
    fetchSaleDatedTotals(month),
  ]);

  if (!rawPayload) {
    return buildUnavailable("Plumbing production data unavailable.");
  }

  // Cast to the known shape from computePlumbingMonitoringPayload.
  type PlumbingPayload = Awaited<ReturnType<typeof import("../routes/plan").computePlumbingMonitoringPayload>>;
  const payload = rawPayload as PlumbingPayload;

  const orderTotals = orderResult.available ? orderResult.totals : null;
  const saleTotals = saleResult.available ? saleResult.totals : null;

  const tx: TransactionSources = {
    orders: { totals: orderTotals, note: orderResult.note },
    sales: { totals: saleTotals, note: saleResult.note },
  };

  // ── Decide plan source (audit gap #4) ────────────────────────────────────
  // If issued versions exist, use buildVersionAwarePlanMap for plan quantities.
  // Otherwise fall back to the monitoring payload's per-item release values.

  let planMap: Map<string, PlanMapEntry>;
  let planSource: string;

  if (versionTimeline.length > 0) {
    // Build version-aware plan map from issued timeline.
    planMap = buildVersionAwarePlanMap(month, versionTimeline);
    planSource = `Issued plan timeline (${versionTimeline.length} version${versionTimeline.length === 1 ? "" : "s"})`;

    // Reconcile actuals from the payload's items array using strict normCode matching.
    // payload.items has { itemCode, category, w1Actual, w2Actual, w3Actual, w4Actual, totalActual }.
    const productionByKey = new Map<string, [number, number, number, number]>();
    const timelineOutOfPlan = new Map<
      string,
      { itemCode: string; category: string | null; weeks: [number, number, number, number] }
    >();

    for (const item of payload.items as Array<{
      itemCode: string;
      category: string;
      w1Actual: number;
      w2Actual: number;
      w3Actual: number;
      w4Actual: number;
      totalActual: number;
    }>) {
      const itemNorm = normalizeCodeStrict(item.itemCode);

      // Find the plan-map entry by strict normCode (handles A465 vs A-465).
      let matched = false;
      for (const [pk, pv] of planMap) {
        if (pv.plan <= 0) continue;
        if (normalizeCodeStrict(pv.itemCode) === itemNorm) {
          const arr = productionByKey.get(pk) ?? [0, 0, 0, 0];
          arr[0] += item.w1Actual;
          arr[1] += item.w2Actual;
          arr[2] += item.w3Actual;
          arr[3] += item.w4Actual;
          productionByKey.set(pk, arr);
          matched = true;
          break;
        }
      }
      if (!matched && item.totalActual > 0) {
        const knownCategory =
          [...planMap.values()].find((pv) => normalizeCodeStrict(pv.itemCode) === itemNorm)?.category ??
          item.category ??
          null;
        const existing = timelineOutOfPlan.get(itemNorm) ?? {
          itemCode: item.itemCode,
          category: knownCategory,
          weeks: [0, 0, 0, 0],
        };
        existing.weeks[0] += item.w1Actual;
        existing.weeks[1] += item.w2Actual;
        existing.weeks[2] += item.w3Actual;
        existing.weeks[3] += item.w4Actual;
        timelineOutOfPlan.set(itemNorm, existing);
      }
    }

    // Codes the current monitoring roster could not map may still belong to an
    // issued version. Reconcile those against the same positive-plan timeline
    // before classifying them as out of plan.
    for (const entry of payload.unmapped.allCodes as Array<{
      code: string;
      qty: number;
      byWeek: [number, number, number, number];
    }>) {
      const itemNorm = normalizeCodeStrict(entry.code);
      let matched = false;
      for (const [pk, pv] of planMap) {
        if (pv.plan <= 0) continue;
        if (normalizeCodeStrict(pv.itemCode) !== itemNorm) continue;
        const arr = productionByKey.get(pk) ?? [0, 0, 0, 0];
        for (let index = 0; index < 4; index += 1) arr[index] += entry.byWeek[index]!;
        productionByKey.set(pk, arr);
        matched = true;
        break;
      }
      if (!matched) {
        timelineOutOfPlan.set(itemNorm, {
          itemCode: entry.code,
          category: null,
          weeks: [...entry.byWeek],
        });
      }
    }

    const categories = buildCategoriesFromPlanMap(planMap, productionByKey, tx);

    const outOfPlan: OutOfPlanRow[] = [
      ...[...timelineOutOfPlan.values()].map((entry) => ({
        itemCode: entry.itemCode,
        colour: "",
        category: entry.category,
        totalProduction: entry.weeks.reduce((sum, value) => sum + value, 0),
        weeks: [...entry.weeks],
      })),
    ].sort((a, b) => b.totalProduction - a.totalProduction);

    const totalPlan = categories.reduce((s, c) => s + c.plan, 0);
    const mappedProduction = categories.reduce((s, c) => s + c.production, 0);
    const unmappedProduction = outOfPlan.reduce((sum, row) => sum + row.totalProduction, 0);
    const totalProduction = mappedProduction + unmappedProduction;

    const totalOrders =
      orderTotals !== null ? categories.reduce((s, c) => s + (c.orders ?? 0), 0) : null;
    const totalSales =
      saleTotals !== null ? categories.reduce((s, c) => s + (c.sales ?? 0), 0) : null;

    const kpis: ReportKPIs = {
      totalPlan,
      mappedProduction,
      totalProduction,
      unmappedProduction,
      orderQty: totalOrders,
      saleQty: totalSales,
      variance: mappedProduction - totalPlan,
      achievementPct: achievementPct(totalPlan, mappedProduction),
      achievementRemark: achievementRemark(totalPlan, mappedProduction),
      plannedItemCount: [...planMap.values()].filter((v) => v.plan > 0).length,
      categoryCount: categories.length,
    };

    const planVersions: PlanVersionSummary[] = versionTimeline.map((v) => ({
      kind: v.kind,
      sourceId: v.sourceId,
      sourceLabel: v.sourceLabel,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo,
      auditLabel: buildAuditLabel(v),
    }));

    const invariants = buildInvariants(planMap, categories, kpis, weekCalendar);
    invariants.push({
      code: "PLUMBING_PRODUCTION_CONSERVATION",
      ok: totalProduction === payload.totalProduced,
      expected: payload.totalProduced,
      actual: totalProduction,
      detail: "mapped plus out-of-plan production equals total Sheet3 production",
    });

    return {
      month,
      segment: "Plumbing",
      lifecycle: lifecycle.state,
      generatedAt: now.toISOString(),
      dataAvailable: true,
      unavailableReason: null,
      workingDays,
      workingDaysSource,
      lastDataDate: payload.lastDataDate as string | null,
      planVersions,
      sources: {
        plan: planSource,
        production: "Plumbing Sheet3 actuals reconciled to issued plan timeline",
        orders: {
          available: orderResult.available,
          label: "Order Sheet 26-27",
          note: orderResult.note,
        },
        sales: {
          available: saleResult.available,
          label: "SALE SHEET 26-27",
          note: saleResult.note,
        },
      },
      weekCalendar,
      kpis,
      categories,
      outOfPlan,
      invariants,
    };
  }

  // ── Fallback: no issued versions — use monitoring payload plan directly ───
  planSource = "Plumbing monitoring payload plan (no issued timeline found — fallback)";

  const plumbingItems = payload.items as Array<{
    itemCode: string;
    category: string;
    totalRelease: number;
    w1Release: number;
    w2Release: number;
    w3Release: number;
    w4Release: number;
    w1Actual: number;
    w2Actual: number;
    w3Actual: number;
    w4Actual: number;
    totalActual: number;
  }>;

  if (plumbingItems.length === 0) {
    return buildUnavailable("No Plumbing plan items found for this month.");
  }

  // Build a planMap-compatible structure from payload items so we can reuse
  // buildCategoriesFromPlanMap and buildInvariants.
  planMap = new Map<string, PlanMapEntry>();
  const payloadProductionByKey = new Map<string, [number, number, number, number]>();
  const fallbackOutOfPlan: OutOfPlanRow[] = [];

  for (const item of plumbingItems) {
    if (item.totalRelease <= 0) {
      if (item.totalActual > 0) {
        fallbackOutOfPlan.push({
          itemCode: item.itemCode,
          colour: "",
          category: item.category,
          totalProduction: item.totalActual,
          weeks: [item.w1Actual, item.w2Actual, item.w3Actual, item.w4Actual],
        });
      }
      continue;
    }
    const ck = itemKey(item.itemCode, ""); // Plumbing items have no colour
    planMap.set(ck, {
      itemCode: item.itemCode,
      colour: "",
      category: item.category,
      plan: item.totalRelease,
      w1: item.w1Release,
      w2: item.w2Release,
      w3: item.w3Release,
      w4: item.w4Release,
    });
    payloadProductionByKey.set(ck, [item.w1Actual, item.w2Actual, item.w3Actual, item.w4Actual]);
  }

  const categories = buildCategoriesFromPlanMap(planMap, payloadProductionByKey, tx);

  const outOfPlan: OutOfPlanRow[] = [
    ...(payload.unmapped.allCodes as Array<{
      code: string;
      qty: number;
      byWeek: [number, number, number, number];
    }>).map((entry) => ({
      itemCode: entry.code,
      colour: "",
      category: null,
      totalProduction: entry.qty,
      weeks: [...entry.byWeek],
    })),
    ...fallbackOutOfPlan,
  ].sort((a, b) => b.totalProduction - a.totalProduction);

  const totalPlan = categories.reduce((s, c) => s + c.plan, 0);
  const mappedProduction = categories.reduce((s, c) => s + c.production, 0);
  const unmappedProduction = outOfPlan.reduce((sum, row) => sum + row.totalProduction, 0);
  const totalProduction = mappedProduction + unmappedProduction;

  const totalOrders =
    orderTotals !== null ? categories.reduce((s, c) => s + (c.orders ?? 0), 0) : null;
  const totalSales =
    saleTotals !== null ? categories.reduce((s, c) => s + (c.sales ?? 0), 0) : null;

  const kpis: ReportKPIs = {
    totalPlan,
    mappedProduction,
    totalProduction,
    unmappedProduction,
    orderQty: totalOrders,
    saleQty: totalSales,
    variance: mappedProduction - totalPlan,
    achievementPct: achievementPct(totalPlan, mappedProduction),
    achievementRemark: achievementRemark(totalPlan, mappedProduction),
    plannedItemCount: plumbingItems.filter((i) => i.totalRelease > 0).length,
    categoryCount: categories.length,
  };

  const invariants = buildInvariants(planMap, categories, kpis, weekCalendar);
  invariants.push({
    code: "PLUMBING_PRODUCTION_CONSERVATION",
    ok: totalProduction === payload.totalProduced,
    expected: payload.totalProduced,
    actual: totalProduction,
    detail: "mapped plus out-of-plan production equals total Sheet3 production",
  });

  return {
    month,
    segment: "Plumbing",
    lifecycle: lifecycle.state,
    generatedAt: now.toISOString(),
    dataAvailable: true,
    unavailableReason: null,
    workingDays,
    workingDaysSource,
    lastDataDate: payload.lastDataDate as string | null,
    planVersions: [],
    sources: {
      plan: planSource,
      production: "Plumbing Sheet3 (daily production actuals)",
      orders: {
        available: orderResult.available,
        label: "Order Sheet 26-27",
        note: orderResult.note,
      },
      sales: {
        available: saleResult.available,
        label: "SALE SHEET 26-27",
        note: saleResult.note,
      },
    },
    weekCalendar,
    kpis,
    categories,
    outOfPlan,
    invariants,
  };
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function computePlanVsActualReport(
  month: string,
  segment: "PTMT" | "Plumbing",
  now = new Date(),
): Promise<PlanVsActualReport> {
  logger.info({ month, segment }, "plan-vs-actual: computing report");
  if (segment === "Plumbing") return buildPlumbingReport(month, now);
  return buildPtmtReport(month, now);
}
