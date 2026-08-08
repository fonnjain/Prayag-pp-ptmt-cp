import { ReplitConnectors } from "@replit/connectors-sdk";
import { AsyncLocalStorage } from "node:async_hooks";
import { db, workbookConfigTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "./logger";

// ── Planning isolation guard ──────────────────────────────────────────────────
//
// RULE (scoped 2026-08): the plan-BUILD path may read Google Sheets ONLY for
// reference data on an explicit allow-list:
//   • fetchAvg3MoSaleTotals   — sales history (avg-3-month figures)
//   • fetchPlumbingPlanData   — Plumbing workbook: item roster (code/type/material),
//                               avg-3-month, per-item multiplier — NOTHING else
//   • fetchPlumbingBomWeights — BOM weight-per-piece (kg computation)
//
// Stock and pending (current + last-month) MUST come from uploads and fail
// loudly when missing (see routes/plan.ts). Any other sheet read inside a
// planning context throws PlanningIsolationError naming the call site.
// Non-planning paths (monitoring actuals, corrective production-to-date,
// machine capacity reference) are unaffected — they never run inside a
// planning context.

/** Thrown when the plan-build path attempts a sheet read outside the allow-list. */
export class PlanningIsolationError extends Error {
  constructor(callSite: string, context: string) {
    super(
      `Planning isolation violation: sheet read "${callSite}" attempted inside planning context "${context}". ` +
      `Planning may only read sales history (fetchAvg3MoSaleTotals), the Plumbing workbook roster/avg/multiplier ` +
      `(fetchPlumbingPlanData), and BOM weights (fetchPlumbingBomWeights). Stock and pending must come from uploads.`,
    );
    this.name = "PlanningIsolationError";
  }
}

const _planningContext = new AsyncLocalStorage<{ label: string }>();
const _allowedReadScope = new AsyncLocalStorage<{ fetcher: string }>();

/** Marks fn (and everything it awaits) as the plan-build path. */
export function runInPlanningContext<T>(label: string, fn: () => Promise<T>): Promise<T> {
  return _planningContext.run({ label }, fn);
}

/** Names of sheet fetchers permitted inside a planning context. */
export const PLANNING_SHEET_READ_ALLOWLIST = [
  "fetchAvg3MoSaleTotals",
  "fetchPlumbingPlanData",
  "fetchPlumbingBomWeights",
] as const;

function runInAllowedReadScope<T>(fetcher: string, fn: () => Promise<T>): Promise<T> {
  return _allowedReadScope.run({ fetcher }, fn);
}

/** Call at the top of every NON-allow-listed public fetcher: throws in planning context. */
function guardPlanningRead(callSite: string): void {
  const ctx = _planningContext.getStore();
  if (ctx) throw new PlanningIsolationError(callSite, ctx.label);
}

/** Choke-point safety net (proxyJson/driveProxyJson): catches any future fetcher
 *  added without a named guard. Names the API path when the fetcher is unknown. */
function guardPlanningReadAtChokePoint(path: string): void {
  const ctx = _planningContext.getStore();
  if (!ctx) return;
  const scope = _allowedReadScope.getStore();
  if (scope && (PLANNING_SHEET_READ_ALLOWLIST as readonly string[]).includes(scope.fetcher)) return;
  throw new PlanningIsolationError(`unregistered sheet read (API path: ${path})`, ctx.label);
}

let _connectors: ReplitConnectors | null = null;
function getConnectors(): ReplitConnectors {
  if (!_connectors) _connectors = new ReplitConnectors();
  return _connectors;
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const SHEET_IDS = {
  ptmtAnuj: "1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw",
  orderSheet: "1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A",
  sale2627: "1rW9fvrdcmTy7Yd6RVV5dVpvZQ5knZMeKoMx8enZ6j24",
  saleSheet2627: "19LQGpkbZiecGaXdBvl48rPZT2LUz3sKekeKX5fHu7Ps",
  codeWiseSale2526: "1kcPcre-iT7k6zH9RViqwajnhxQoppoUz2z46LdY29mg",
  rateList: "1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4",
  pendingOrder: "1dmt6uHOdZSIT0wgNkSfuK8W8d0YO8STW51PVOAAFHvY",
} as const;

export const SHEET_LABELS: Record<keyof typeof SHEET_IDS, string> = {
  ptmtAnuj: "PTMT ANUJ",
  orderSheet: "Order Sheet 26-27",
  sale2627: "Sale 26-27",
  saleSheet2627: "SALE SHEET 26-27",
  codeWiseSale2526: "CODE WISE SALE 25-26",
  rateList: "rate list",
  pendingOrder: "Pending order",
};

/**
 * PTMT monthly daily-production workbook file IDs (tab "Report-5"), used by the
 * production-monitoring app. Pinned by ID per the build spec — when a new month's
 * file is created, its ID must be added here.
 */
export const PTMT_DAILY_WORKBOOK_IDS: Record<string, string> = {
  "2026-04": "16zsh5x4MdY8DX3H5_hw5iaOdkGixlUsPzesDVnwgfYo",
  "2026-05": "1T1M5MT47P3D4wCwi7tX7KcL_sHVtx43NSuXFDP9Oq78",
  "2026-06": "1nEDFjrVu6pnNkzZ9tJhvGvBDMUHjLStcc0RP2uHig4g",
  "2026-07": "1AjMLfcBkI0rGY8JdYP3MO8Ocn8lO-HIpol1tHgvK9O8",
};

/**
 * Plumbing monthly daily-production workbook file IDs.
 * These are fallback IDs used when Drive-based discovery fails.
 * Primary source: Google Drive search (findPlumbingWorkbookId).
 */
export const PLUMBING_DAILY_WORKBOOK_IDS: Record<string, string> = {
  "2026-07": "1wlB4Y4lnP7Y2SLZX6atFN-nrKA--ByYF8m2TVHuBxD0",
};

// Cache DB workbook lookups for 5 minutes
const _dbWorkbookCache = new Map<string, { id: string | null; expires: number }>();

async function loadWorkbookIdFromDb(division: string, month: string): Promise<string | null> {
  const key = `${division}_${month}`;
  const now = Date.now();
  const cached = _dbWorkbookCache.get(key);
  if (cached && cached.expires > now) return cached.id;

  try {
    const rows = await db
      .select({ workbookId: workbookConfigTable.workbookId })
      .from(workbookConfigTable)
      .where(and(eq(workbookConfigTable.division, division), eq(workbookConfigTable.month, month)))
      .limit(1);
    const id = rows[0]?.workbookId ?? null;
    _dbWorkbookCache.set(key, { id, expires: now + 5 * 60 * 1000 });
    return id;
  } catch (err) {
    logger.warn({ division, month, err: String(err) }, "loadWorkbookIdFromDb: DB lookup failed — using hardcoded");
    return null;
  }
}

/**
 * Thrown when no workbook can be resolved for a division+month. Named error —
 * a missing month's sheet must surface as an error, never as zero production.
 */
export class WorkbookResolutionError extends Error {
  readonly division: string;
  readonly month: string;
  readonly pattern: string;
  constructor(division: string, month: string, pattern: string, detail?: string) {
    super(
      `No ${division} workbook found for ${month} — searched Drive for title pattern "${pattern}"` +
        (detail ? ` (${detail})` : "") +
        ". Refusing to fall back to another month's sheet.",
    );
    this.name = "WorkbookResolutionError";
    this.division = division;
    this.month = month;
    this.pattern = pattern;
  }
}

/** Human-readable title pattern + Drive name-contains keyword per division. */
const WORKBOOK_TITLE_PATTERNS: Record<WorkbookDivision, { contains: string; pattern: string }> = {
  PTMT:     { contains: "PTMT PLAN & ACTUAL",       pattern: "N. PTMT PLAN & ACTUAL - <Mon>-<YY>" },
  // Machine-level kg (Report-5) lives in the Date Sheet & Monthly Report series —
  // a DIFFERENT workbook from PLAN & ACTUAL (whose "REPORT 5" tab is a plan grid
  // importing from the forbidden Daily Production PTMT sheet; never parse it).
  "PTMT-Machine": { contains: "PTMT Date Sheet & Monthly Report", pattern: "N. PTMT Date Sheet & Monthly Report - <Mon> ' <YYYY>" },
  Plumbing: { contains: "Daily Production PLUMBING", pattern: "Daily Production PLUMBING <MON> ' <YYYY>" },
};

export type WorkbookDivision = "PTMT" | "PTMT-Machine" | "Plumbing";

// ── IST calendar helpers (plant timezone) ──────────────────────────────────
// All operational month/day math must use IST so a UTC-hosted server doesn't
// lag the plant's calendar by up to 5.5 h around month rollover.

// `now` defaults to the real clock; tests pass a fixed UTC instant to pin
// boundary cases (IST-midnight straddle, Dec→Jan rollover).
function istDate(now?: Date): Date {
  return new Date((now ? now.getTime() : Date.now()) + 5.5 * 60 * 60 * 1000);
}

/** Current planning month (YYYY-MM) in IST. */
export function istPlanningMonth(now?: Date): string {
  const d = istDate(now);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Next planning month (YYYY-MM) in IST. */
export function istNextPlanningMonth(now?: Date): string {
  const d = istDate(now);
  const nd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return `${nd.getUTCFullYear()}-${String(nd.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Day of month (1-31) in IST. */
export function istDayOfMonth(now?: Date): number {
  return istDate(now).getUTCDate();
}

/** True when a workbook title names the given planning month (month abbrev + year). */
export function titleMatchesMonth(title: string, month: string): boolean {
  const [year, mo] = month.split("-");
  const abbrevs = _MONTH_ABBREVS[mo] ?? [];
  const upper = title.toUpperCase();
  const yearShort = year.slice(2);
  const monthOk = abbrevs.some((a) => upper.includes(a.toUpperCase()));
  const yearOk = upper.includes(year) || upper.includes(yearShort);
  return monthOk && yearOk;
}

export interface ResolvedWorkbook {
  division: WorkbookDivision;
  month: string;
  workbookId: string;
  /** Drive file title — null when Drive metadata could not be fetched. */
  title: string | null;
  modifiedTime: string | null;
  /** pinned = DB row set by a human; static = legacy hardcoded map; auto = Drive discovery. */
  source: "pinned" | "static" | "auto";
  /** false when the workbook title does not name the requested month (pinned/static only — auto requires a match). */
  titleMonthMatch: boolean;
}

// Cache resolved workbooks for 30 minutes, keyed division_month.
const _resolvedWorkbookCache = new Map<string, { resolved: ResolvedWorkbook; expires: number }>();

async function fetchDriveFileMeta(fileId: string): Promise<{ name: string; modifiedTime: string } | null> {
  try {
    const data = await driveProxyJson(`/drive/v3/files/${fileId}?fields=id,name,modifiedTime`);
    return { name: data.name, modifiedTime: data.modifiedTime };
  } catch (err) {
    logger.warn({ fileId, err: String(err) }, "resolveWorkbook: Drive metadata fetch failed");
    return null;
  }
}

/**
 * Resolves the workbook for a division+month with full provenance.
 * Priority: pinned (DB) → static map (exact-month legacy IDs) → Drive auto-discovery.
 *
 * Auto-discovery matches on title pattern + month/year in the title, choosing the
 * most recently modified match. It NEVER falls back to another month's file —
 * when nothing matches it throws WorkbookResolutionError naming the pattern.
 *
 * A pinned ID always wins (human override), but a title-month mismatch is
 * logged loudly and surfaced via titleMonthMatch=false.
 */
export async function resolveWorkbookForMonth(
  division: WorkbookDivision,
  month: string,
): Promise<ResolvedWorkbook> {
  const cacheKey = `${division}_${month}`;
  const now = Date.now();
  const cached = _resolvedWorkbookCache.get(cacheKey);
  if (cached && cached.expires > now) return cached.resolved;

  const { contains, pattern } = WORKBOOK_TITLE_PATTERNS[division];

  // 1. Pinned (DB) — human override wins until unpinned.
  const dbId = await loadWorkbookIdFromDb(division, month);
  // 2. Static legacy map — exact month key only, so it can never serve another month.
  // The Apr–Jul '26 static PTMT IDs are Date Sheet (machine-report) workbooks,
  // so they belong to the PTMT-Machine feed, not the PLAN & ACTUAL feed.
  const staticId = dbId
    ? null
    : (division === "PTMT-Machine"
        ? PTMT_DAILY_WORKBOOK_IDS[month]
        : division === "Plumbing"
          ? PLUMBING_DAILY_WORKBOOK_IDS[month]
          : undefined) ?? null;

  if (dbId || staticId) {
    const workbookId = (dbId ?? staticId)!;
    const source: ResolvedWorkbook["source"] = dbId ? "pinned" : "static";
    const meta = await fetchDriveFileMeta(workbookId);
    const titleMonthMatch = meta ? titleMatchesMonth(meta.name, month) : true; // unknown title → don't false-alarm
    if (meta && !titleMonthMatch) {
      logger.error(
        { division, month, workbookId, title: meta.name, source },
        "resolveWorkbook: WORKBOOK TITLE MONTH MISMATCH — the configured sheet does not name the requested month",
      );
    }
    const resolved: ResolvedWorkbook = {
      division, month, workbookId,
      title: meta?.name ?? null,
      modifiedTime: meta?.modifiedTime ?? null,
      source, titleMonthMatch,
    };
    logger.info({ ...resolved }, "resolveWorkbook: resolved");
    _resolvedWorkbookCache.set(cacheKey, { resolved, expires: now + 30 * 60 * 1000 });
    return resolved;
  }

  // 3. Drive auto-discovery — title pattern + month/year required; most recent modifiedTime wins.
  let files: Array<{ id: string; name: string; modifiedTime: string }>;
  try {
    const q = encodeURIComponent(
      `name contains '${contains}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    );
    const data = await driveProxyJson(
      `/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=30`,
    );
    files = data.files ?? [];
  } catch (err) {
    throw new WorkbookResolutionError(division, month, pattern, `Drive search failed: ${String(err)}`);
  }

  const matches = files
    .filter((f) => titleMatchesMonth(f.name, month))
    .sort((a, b) => (b.modifiedTime > a.modifiedTime ? 1 : -1));

  if (matches.length === 0) {
    logger.error(
      { division, month, pattern, candidates: files.slice(0, 8).map((f) => f.name) },
      "resolveWorkbook: NO WORKBOOK MATCHES the current month's title pattern",
    );
    throw new WorkbookResolutionError(division, month, pattern);
  }

  const chosen = matches[0]!;
  const resolved: ResolvedWorkbook = {
    division, month,
    workbookId: chosen.id,
    title: chosen.name,
    modifiedTime: chosen.modifiedTime,
    source: "auto",
    titleMonthMatch: true,
  };
  logger.info(
    { division, month, pattern, chosenTitle: chosen.name, workbookId: chosen.id, modifiedTime: chosen.modifiedTime, otherMatches: matches.slice(1, 4).map((f) => f.name) },
    "resolveWorkbook: auto-discovered via Drive",
  );
  _resolvedWorkbookCache.set(cacheKey, { resolved, expires: now + 30 * 60 * 1000 });
  return resolved;
}

/**
 * Resolves the workbook file ID for a given division and month.
 * Priority: pinned (DB) → static map → Drive auto-discovery.
 * Throws WorkbookResolutionError when nothing matches the month — never
 * silently returns another month's workbook.
 */
export async function getWorkbookIdForMonth(
  division: WorkbookDivision,
  month: string,
): Promise<string> {
  return (await resolveWorkbookForMonth(division, month)).workbookId;
}

/** Invalidate the DB workbook cache for a specific division+month (call after saves). */
export function invalidateWorkbookCache(division: string, month: string): void {
  _dbWorkbookCache.delete(`${division}_${month}`);
  _resolvedWorkbookCache.delete(`${division}_${month}`);
}

/** Drop all resolved/DB workbook caches (the "Refresh sources" action). */
export function invalidateAllWorkbookCaches(): void {
  _dbWorkbookCache.clear();
  _resolvedWorkbookCache.clear();
  _driveWorkbookCache.clear();
}

async function proxyJson(path: string): Promise<any> {
  guardPlanningReadAtChokePoint(path);
  const MAX_RETRIES = 4;
  let delay = 1000;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await getConnectors().proxy("google-sheet", path, { method: "GET" });
    if (res.ok) return res.json();
    if (res.status === 429 && attempt < MAX_RETRIES) {
      logger.warn({ attempt, delay, path }, "Sheets API 429 — backing off");
      await sleep(delay);
      delay *= 2;
      continue;
    }
    const body = await res.text();
    throw new Error(`Sheets API error ${res.status}: ${body.slice(0, 300)}`);
  }
}

// ── Google Drive helpers ──────────────────────────────────────────────────────

async function driveProxyJson(path: string): Promise<any> {
  guardPlanningReadAtChokePoint(path);
  const MAX_RETRIES = 3;
  let delay = 1000;
  for (let attempt = 0; ; attempt++) {
    const res = await getConnectors().proxy("google-drive", path, { method: "GET" });
    if (res.ok) return res.json();
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      logger.warn({ attempt, delay, path, status: res.status }, "Drive API transient error — backing off");
      await sleep(delay);
      delay *= 2;
      continue;
    }
    const body = await res.text();
    throw new Error(`Drive API error ${res.status}: ${body.slice(0, 300)}`);
  }
}

const _MONTH_ABBREVS: Record<string, string[]> = {
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

// Cache Drive workbook lookups for 30 minutes
const _driveWorkbookCache = new Map<string, { fileIds: string[]; expires: number }>();

/**
 * Searches Google Drive for the Plumbing daily-production workbook for a given
 * planning month (YYYY-MM).  Returns the file ID of the best match, or null if
 * none found or Drive is not connected.  Falls back to PLUMBING_DAILY_WORKBOOK_IDS.
 */
/**
 * Returns ALL Drive candidates matching the month/year (most-recently-modified
 * first), not just the first: the name filter can also match non-production
 * workbooks (e.g. "PLUMBING DAILY PURCHASE AUG- (2026)"), so the caller must be
 * able to try the next candidate when one has no material tabs.
 */
async function findPlumbingWorkbookIds(month: string): Promise<string[]> {
  const now = Date.now();
  const cached = _driveWorkbookCache.get(month);
  if (cached && cached.expires > now) return cached.fileIds;

  try {
    const [year, mo] = month.split("-");
    const abbrevs = _MONTH_ABBREVS[mo] ?? [];
    const yearShort = year.slice(2); // e.g. "26"

    const q = encodeURIComponent(
      "name contains 'PLUMBING' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    );
    const data = await driveProxyJson(
      `/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=30`,
    );

    const files: Array<{ id: string; name: string; modifiedTime: string }> = data.files ?? [];
    const matches = files.filter((f) => {
      const upper = f.name.toUpperCase();
      return (
        abbrevs.some((a) => upper.includes(a.toUpperCase())) &&
        (upper.includes(year) || upper.includes(yearShort))
      );
    });

    const fileIds = matches.map((m) => m.id);
    _driveWorkbookCache.set(month, { fileIds, expires: now + 30 * 60 * 1000 });
    if (fileIds.length > 0) {
      logger.info(
        { month, candidates: matches.map((m) => m.name) },
        "fetchPlumbingPlanData: workbook candidates found via Drive",
      );
    } else {
      logger.warn(
        { month, candidates: files.slice(0, 5).map((f) => f.name) },
        "fetchPlumbingPlanData: no matching Plumbing workbook in Drive",
      );
    }
    return fileIds;
  } catch (err) {
    logger.warn({ month, err: String(err) }, "fetchPlumbingPlanData: Drive lookup failed — using hardcoded ID");
    return [];
  }
}

/**
 * Searches Google Drive for spreadsheets matching a given division and planning month.
 * Returns up to 6 candidate files sorted by relevance (month+year match) then recency.
 * Falls back to an empty array when Drive is not connected or the search fails.
 *
 * @param customQuery  When provided, replaces the default keyword ("PTMT" / "PLUMBING") in
 *                     the Drive name-contains search — used for manual user-supplied queries.
 */
export async function searchWorkbookCandidates(
  division: "PTMT" | "Plumbing",
  month: string,
  customQuery?: string,
): Promise<Array<{ fileId: string; fileName: string; modifiedTime: string }>> {
  try {
    const [year, mo] = month.split("-");
    const abbrevs = _MONTH_ABBREVS[mo] ?? [];
    const yearShort = year.slice(2); // e.g. "26"

    const keyword = division === "PTMT" ? "PTMT" : "PLUMBING";
    const nameQ = customQuery ?? keyword;
    const q = encodeURIComponent(
      `name contains '${nameQ}' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    );
    const data = await driveProxyJson(
      `/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=20`,
    );

    const files: Array<{ id: string; name: string; modifiedTime: string }> = data.files ?? [];
    // Score each file by how well it matches the target month+year.
    const scored = files.map((f) => {
      const upper = f.name.toUpperCase();
      const monthMatch = abbrevs.some((a) => upper.includes(a.toUpperCase()));
      const yearMatch  = upper.includes(year) || upper.includes(yearShort);
      return { ...f, score: (monthMatch ? 2 : 0) + (yearMatch ? 1 : 0) };
    });
    scored.sort((a, b) => b.score - a.score || (b.modifiedTime > a.modifiedTime ? 1 : -1));

    logger.info(
      { division, month, customQuery, total: files.length, returned: Math.min(scored.length, 6) },
      "searchWorkbookCandidates: Drive search complete",
    );
    return scored.slice(0, 6).map(({ id, name, modifiedTime }) => ({
      fileId: id,
      fileName: name,
      modifiedTime,
    }));
  } catch (err) {
    logger.warn({ division, month, customQuery, err: String(err) }, "searchWorkbookCandidates: Drive search failed");
    return [];
  }
}

// ── Cache tab lists for 10 minutes — sheet structure changes are rare intra-session
const _tabsCache = new Map<string, { tabs: string[]; expires: number }>();

export async function listTabs(sheetId: string): Promise<string[]> {
  const now = Date.now();
  const cached = _tabsCache.get(sheetId);
  if (cached && cached.expires > now) return cached.tabs;
  const data = await proxyJson(`/v4/spreadsheets/${sheetId}?fields=sheets.properties`);
  const tabs = (data.sheets ?? []).map((s: any) => s.properties.title as string);
  _tabsCache.set(sheetId, { tabs, expires: now + 10 * 60 * 1000 });
  return tabs;
}

export async function getTabValues(sheetId: string, tab: string, range = "A1:Z20000"): Promise<string[][]> {
  const encodedRange = encodeURIComponent(`${tab}!${range}`);
  const data = await proxyJson(`/v4/spreadsheets/${sheetId}/values/${encodedRange}`);
  return (data.values ?? []) as string[][];
}

/** Throttled fetch: Sheets API allows ~60 read requests/min. */
export async function throttledGetTabValues(sheetId: string, tab: string, range?: string): Promise<string[][]> {
  await sleep(1100);
  return getTabValues(sheetId, tab, range);
}

const MONTH_NAMES = [
  ["jan", "january"],
  ["feb", "february"],
  ["mar", "march"],
  ["apr", "april"],
  ["may"],
  ["jun", "june"],
  ["jul", "july"],
  ["aug", "august"],
  ["sep", "september"],
  ["oct", "october"],
  ["nov", "november"],
  ["dec", "december"],
];

export function monthLabel(year: number, monthIndex0: number): string {
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[monthIndex0]}-${String(year).slice(2)}`;
}

/** month format: "YYYY-MM" */
export function priorThreeMonths(month: string): { year: number; monthIndex0: number }[] {
  const [y, m] = month.split("-").map(Number);
  const result: { year: number; monthIndex0: number }[] = [];
  for (let offset = 3; offset >= 1; offset--) {
    const total = (m - 1) - offset;
    const year = y + Math.floor(total / 12);
    const monthIndex0 = ((total % 12) + 12) % 12;
    result.push({ year, monthIndex0 });
  }
  return result;
}

function tabMatchesAllMonths(tabName: string, months: { monthIndex0: number }[]): boolean {
  const lower = tabName.toLowerCase();
  return months.every(({ monthIndex0 }) => MONTH_NAMES[monthIndex0].some((name) => lower.includes(name)));
}

/** Placeholder tokens some source sheets use for "no colour variant" — normalized to blank so they match real blanks. */
const NO_COLOUR_PLACEHOLDERS = new Set(["0", ".", "NORMAL"]);

function normalizeColour(colour: unknown): string {
  const trimmed = String(colour ?? "").trim().toUpperCase();
  return NO_COLOUR_PLACEHOLDERS.has(trimmed) ? "" : trimmed;
}

export function itemKey(itemCode: unknown, colour: unknown): string {
  return `${String(itemCode ?? "").trim().toUpperCase()}::${normalizeColour(colour)}`;
}

export function normalizeCode(itemCode: unknown): string {
  return String(itemCode ?? "").trim().toUpperCase();
}

/**
 * Production-to-plan code normalisation: strip hyphens, spaces and dots before
 * uppercasing.  Production sheets log "A465" while the plan master uses "A-465";
 * this transform makes them compare equal.  Use ONLY for matching Sheet3
 * production codes to plan item codes — never for plan-to-plan deduplication
 * (which must preserve hyphens to match BOM / item-master keys).
 */
export function normalizeCodeStrict(code: unknown): string {
  return String(code ?? "").trim().toUpperCase().replace(/[-\s.]/g, "");
}

/**
 * Dual totals map: `exact` keys on itemKey(code,colour) for items that have real
 * colour variants; `byCode` sums every row for a code regardless of colour, for
 * items whose item_master colour field is a non-discriminating placeholder
 * (e.g. a single-SKU code with colour "0"/blank/a stale numeric legacy code).
 * Callers pick exact vs byCode per item based on how many item_master rows
 * share that item code (see plan.ts resolveTotal).
 */
export interface DualTotals {
  exact: Map<string, number>;
  byCode: Map<string, number>;
}

function addToDualTotals(totals: DualTotals, code: unknown, colour: unknown, qty: number): void {
  const key = itemKey(code, colour);
  const codeKey = normalizeCode(code);
  totals.exact.set(key, (totals.exact.get(key) ?? 0) + qty);
  totals.byCode.set(codeKey, (totals.byCode.get(codeKey) ?? 0) + qty);
}

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const cleaned = String(value ?? "0").replace(/,/g, "").trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function rowsToObjects(values: string[][]): Record<string, string>[] {
  if (values.length === 0) return [];
  const header = values[0];
  return values.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => {
      obj[h] = row[i] ?? "";
    });
    return obj;
  });
}

/**
 * Sum sale quantity by item+colour across the rolling 3-month tab in "Sale 26-27" for the target month.
 *
 * IMPORTANT: This tab has a sibling aggregated block (a colour-blind GROUP BY Item Code
 * pivot living in other columns) with its OWN "Item Code" style header. Header-name based
 * lookup (rowsToObjects) can pick up columns from that block instead of the real line-level
 * data, silently truncating/undercounting rows. Per confirmed spec: read positionally —
 * line-level data lives at Item Code=col D, Colour=col F, Qty=col H (range D1:H) — one row
 * per sale line, keep rows where Qty (col H) is not null, no other filter, sum grouped by
 * (Item Code, Colour), then divide by 3 for the average.
 */
export async function fetchAvg3MoSaleTotals(month: string): Promise<DualTotals> {
  // ALLOW-LISTED for planning: sales-history avg-3-month figures only.
  return runInAllowedReadScope("fetchAvg3MoSaleTotals", () => fetchAvg3MoSaleTotalsInner(month));
}

async function fetchAvg3MoSaleTotalsInner(month: string): Promise<DualTotals> {
  const months = priorThreeMonths(month);
  const tabs = await listTabs(SHEET_IDS.sale2627);
  const matchTab = tabs.find((t) => tabMatchesAllMonths(t, months));
  if (!matchTab) {
    logger.warn({ tabs, month }, "No rolling 3-month sale tab found in Sale 26-27; falling back to Combined");
  }
  const tab = matchTab ?? "Combined";
  // NOTE: this tab's line-level data can exceed 20,000 rows — do not cap the range
  // at A1:Z20000 (the module default) or real sale rows get silently truncated.
  const values = await throttledGetTabValues(SHEET_IDS.sale2627, tab, "D1:H300000");
  const totals: DualTotals = { exact: new Map(), byCode: new Map() };
  const CODE_COL = 0; // D
  const COLOUR_COL = 2; // F
  const QTY_COL = 4; // H
  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    if (!row) continue;
    const qtyRaw = row[QTY_COL];
    if (qtyRaw === undefined || qtyRaw === null || String(qtyRaw).trim() === "") continue;
    const code = row[CODE_COL];
    if (!code || String(code).trim() === "") continue;
    const colour = row[COLOUR_COL];
    const qty = toNumber(qtyRaw);
    addToDualTotals(totals, code, colour, qty);
  }
  return totals;
}

/**
 * Current FG stock is NOT sourced from PTMT ANUJ — that sheet's "Stock Qty"
 * column (N/O/P on the "Production" tab) is a stale opening balance from
 * 17-Apr-2024, not live stock. Current stock is a manually pasted monthly
 * snapshot the user uploads via the "current_stock" upload kind instead
 * (see routes/plan.ts). PTMT ANUJ stays wired only if/when production-done
 * or rejection tracking is added later.
 */

/**
 * Parse a date value from a Google Sheet cell.
 * Handles: Sheets serial integers, ISO strings, "dd-Mon-yy(yy)", "dd/mm/yyyy".
 */
function parseSheetDate(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  // Google Sheets serial date — epoch is 30 Dec 1899
  if (!isNaN(n) && n > 1000 && !/[-/]/.test(s)) {
    return new Date((n - 25569) * 86400 * 1000);
  }
  // "01-Apr-26" / "1-Apr-2026" / "01/Apr/2026"
  const MONTH_SHORT: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  const dmy = s.match(/^(\d{1,2})[-/]([A-Za-z]{3,})[-/](\d{2,4})$/);
  if (dmy) {
    const day = parseInt(dmy[1], 10);
    const mon = MONTH_SHORT[dmy[2].toLowerCase().slice(0, 3)];
    let year = parseInt(dmy[3], 10);
    if (year < 100) year += 2000;
    if (mon !== undefined) return new Date(year, mon, day);
  }
  // ISO / DD/MM/YYYY fallback
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d;
  return null;
}

/**
 * Daily production totals for a given planning month from PTMT ANUJ → Production tab.
 * Range A3:D: A = Date, B = Item Code, C = Colour, D = Qty.
 * Rows are filtered to the target month before aggregation.
 */
export async function fetchLiveDailyProductionTotals(month: string): Promise<DualTotals> {
  guardPlanningRead("fetchLiveDailyProductionTotals"); // monitoring-only — never in plan build
  const [year, mon] = month.split("-").map(Number);
  const values = await throttledGetTabValues(SHEET_IDS.ptmtAnuj, "Production", "A3:D300000");
  const totals: DualTotals = { exact: new Map(), byCode: new Map() };
  for (const row of values) {
    const dateRaw = row[0];
    if (!dateRaw || String(dateRaw).trim() === "") continue;
    const d = parseSheetDate(dateRaw);
    if (!d) continue;
    if (d.getFullYear() !== year || d.getMonth() + 1 !== mon) continue;
    const code = row[1];
    if (!code || String(code).trim() === "") continue;
    const colour = row[2];
    const qty = toNumber(row[3]);
    addToDualTotals(totals, code, colour, qty);
  }
  return totals;
}

/**
 * Order totals from a per-month tab of Order Sheet 26-27.
 * Spec range F:K — expected positional layout from col F (0-indexed):
 *   1 = Old ERP Code (G), 3 = Colour (I), 5 = Quantity (K).
 * Tries header-based detection first; falls back to positional.
 * Falls back to Combined-tab filter if no matching month tab is found.
 */
export async function fetchLiveOrderByMonthTab(month: string): Promise<DualTotals> {
  guardPlanningRead("fetchLiveOrderByMonthTab"); // display-only order book — never in plan build
  const [y, m] = month.split("-").map(Number);
  const label = monthLabel(y, m - 1); // e.g. "Jul-26"
  const monthShort = label.split("-")[0].toLowerCase(); // "jul"
  const yearShort = label.split("-")[1]; // "26"
  const tabs = await listTabs(SHEET_IDS.orderSheet);
  const matchTab =
    // Preferred: tab contains both month name and year (e.g. "Jul-26")
    tabs.find((t) => {
      const lower = t.toLowerCase().replace(/\s+/g, "-");
      return lower.includes(monthShort) && lower.includes(yearShort);
    }) ??
    // Fallback: bare month name only (e.g. "July" or "Jul")
    tabs.find((t) => {
      const stripped = t.toLowerCase().replace(/[-_\s]/g, "");
      return MONTH_NAMES[m - 1].some(
        (name) => stripped === name || stripped === name.slice(0, 3),
      );
    });
  if (!matchTab) {
    logger.info({ tabs, month, label }, "No per-month tab in Order Sheet 26-27; falling back to Combined filter");
    return fetchLiveOrderTotals(month);
  }
  const values = await throttledGetTabValues(SHEET_IDS.orderSheet, matchTab, "F1:K50000");
  const totals: DualTotals = { exact: new Map(), byCode: new Map() };
  // Header-based detection
  const headerRowIdx = values.findIndex((row) =>
    row.some((cell) => /old.*erp|erp.*code/i.test(String(cell)))
  );
  if (headerRowIdx >= 0) {
    const header = values[headerRowIdx];
    const codeIdx = header.findIndex((h) => /old.*erp|erp.*code/i.test(h));
    const colourIdx = header.findIndex((h) => /colou?r/i.test(h));
    const qtyIdx = header.findIndex((h) => /^qty$|quantity/i.test(h));
    for (let i = headerRowIdx + 1; i < values.length; i++) {
      const row = values[i];
      const code = codeIdx >= 0 ? row[codeIdx] : row[1];
      const colour = colourIdx >= 0 ? row[colourIdx] : row[3];
      const qty = toNumber(qtyIdx >= 0 ? row[qtyIdx] : row[5]);
      if (!code || String(code).trim() === "") continue;
      addToDualTotals(totals, code, colour, qty);
    }
  } else {
    // Positional fallback: G=1, I=3, K=5 (0-indexed from F)
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const code = row[1];
      const colour = row[3];
      const qty = toNumber(row[5]);
      if (!code || String(code).trim() === "") continue;
      addToDualTotals(totals, code, colour, qty);
    }
  }
  return totals;
}

/**
 * Plumbing Material BOM — ITEM CODE → Weight/pcs (kg per piece).
 * Sheet: 1R7k5O6w4qaT74G-5X2VXBtD7-Fg3uByvIw3-TeViMmA, tab "Combined" or "NEW".
 * CRITICAL: the master's own kg column is ~1000× too low — NEVER copy it.
 * Weights here are per-piece; kg = pieces × weightPerPcs.
 * Cached 15 min in-process.
 */
const PLUMBING_BOM_SHEET_ID = "1R7k5O6w4qaT74G-5X2VXBtD7-Fg3uByvIw3-TeViMmA";
let _bomWeightsCache: { weights: Map<string, number>; expires: number } | null = null;

export async function fetchPlumbingBomWeights(): Promise<Map<string, number>> {
  // ALLOW-LISTED for planning: BOM weight-per-piece reference (kg computation).
  const now = Date.now();
  if (_bomWeightsCache && _bomWeightsCache.expires > now) return _bomWeightsCache.weights;
  return runInAllowedReadScope("fetchPlumbingBomWeights", () => fetchPlumbingBomWeightsInner(now));
}

async function fetchPlumbingBomWeightsInner(now: number): Promise<Map<string, number>> {
  const tabs = await listTabs(PLUMBING_BOM_SHEET_ID);
  const combinedTab = tabs.find((t) => /^combined$/i.test(t.trim()));
  const newTab      = tabs.find((t) => /^new$/i.test(t.trim()));

  if (!combinedTab && !newTab) {
    logger.warn({ sheetId: PLUMBING_BOM_SHEET_ID, tabs }, "Plumbing BOM sheet has neither 'Combined' nor 'NEW' tab — weights will be empty");
    return new Map();
  }

  // Final map: Combined wins on any code collision; NEW fills in the rest.
  const weights = new Map<string, number>();

  // ── 1. "NEW" tab — read first so Combined can overwrite on collision ───────
  // Layout (fixed columns, no reliable header row):
  //   Pair 1: col A (index 0) = item code, col B (index 1) = weight/pcs
  //   Pair 2: col J (index 9) = item code, col K (index 10) = weight/pcs
  // 1,446 entries; 702 of these are absent from Combined.
  let newCount = 0;
  if (newTab) {
    const newValues = await getTabValues(PLUMBING_BOM_SHEET_ID, newTab, "A1:K100000");
    for (const row of newValues) {
      // Pair 1: A → B
      const code1 = String(row[0] ?? "").trim().toUpperCase();
      const w1    = toNumber(row[1]);
      if (code1 && w1 > 0 && !weights.has(code1)) { weights.set(code1, w1); newCount++; }

      // Pair 2: J → K
      const code2 = String(row[9] ?? "").trim().toUpperCase();
      const w2    = toNumber(row[10]);
      if (code2 && w2 > 0 && !weights.has(code2)) { weights.set(code2, w2); newCount++; }
    }
    logger.info({ tab: newTab, inserted: newCount }, "Plumbing BOM: NEW tab loaded");
  }

  // ── 2. "Combined" tab — header-detected; overwrites any NEW collision ──────
  // Layout: ITEM CODE header → col A; Weight/pcs header → col E (found by search).
  // 866 entries; these values take precedence.
  let combinedCount = 0;
  if (combinedTab) {
    const combValues = await getTabValues(PLUMBING_BOM_SHEET_ID, combinedTab, "A1:Z100000");

    let headerIdx = -1;
    let codeColIdx = -1;
    let weightColIdx = -1;
    for (let i = 0; i < Math.min(15, combValues.length); i++) {
      const row = combValues[i];
      const c = row.findIndex((h) => /^item\s*code$/i.test(String(h ?? "").trim()));
      const w = row.findIndex((h) => /weight[^a-z]*pcs|wt[^a-z]*pcs/i.test(String(h ?? "").trim()));
      if (c >= 0 && w >= 0) { headerIdx = i; codeColIdx = c; weightColIdx = w; break; }
    }

    if (headerIdx < 0) {
      logger.warn({ tab: combinedTab }, "Plumbing BOM: Combined tab — cannot find ITEM CODE + Weight/pcs header");
    } else {
      for (let i = headerIdx + 1; i < combValues.length; i++) {
        const row = combValues[i];
        const code = String(row[codeColIdx] ?? "").trim().toUpperCase();
        if (!code) continue;
        const weight = toNumber(row[weightColIdx]);
        if (weight > 0) { weights.set(code, weight); combinedCount++; } // overwrites NEW entry if same code
      }
      logger.info({ tab: combinedTab, inserted: combinedCount }, "Plumbing BOM: Combined tab loaded");
    }
  }

  _bomWeightsCache = { weights, expires: now + 15 * 60 * 1000 };
  logger.info({ combinedCount, newCount, total: weights.size }, "Plumbing BOM weights merged");
  return weights;
}

// ── Plumbing Sheet3 production reader ─────────────────────────────────────────

/** A single production row from Sheet3 of the Plumbing master workbook. */
export interface PlumbingSheet3Row {
  /** ISO date string "YYYY-MM-DD" — used to group into working days. */
  dateStr: string;
  /** Code exactly as it appears in Sheet3 (may include hyphens/spaces). */
  rawCode: string;
  /** normalizeCodeStrict(rawCode) — matches plan item codes after strict normalization. */
  normCode: string;
  qty: number;
}

const _sheet3Cache = new Map<string, { rows: PlumbingSheet3Row[]; expires: number }>();

/**
 * Reads production-to-date for the given planning month from "Sheet3" of the
 * Plumbing master workbook.
 *
 * Sheet3 is populated automatically from:
 *   Report-11 (Pipe daily production) and Report-12 (Fittings daily production).
 *
 * Expected column layout (no header required; rows with missing date/code/qty skipped):
 *   Col A = Date  (any format supported by parseSheetDate)
 *   Col B = Item Code
 *   Col C = Prod. Qty
 *
 * Codes are normalised with normalizeCodeStrict (strips hyphens/spaces/dots).
 * This is the critical fix that allows "A465" (Sheet3) to match "A-465" (plan master),
 * enabling correct AGRI Fitting produced quantities (was 0 without this).
 *
 * Cached 15 min in-process.
 */
export async function fetchPlumbingSheet3Production(month: string): Promise<PlumbingSheet3Row[]> {
  guardPlanningRead("fetchPlumbingSheet3Production"); // monitoring/corrective actuals — never in plan build
  const now = Date.now();
  const cached = _sheet3Cache.get(month);
  if (cached && cached.expires > now) return cached.rows;

  // Throws WorkbookResolutionError when no August-titled (etc.) workbook exists —
  // a missing month's sheet must be an error, never "zero production".
  const workbookId = await getWorkbookIdForMonth("Plumbing", month);

  const [year, mon] = month.split("-").map(Number);

  await sleep(1100); // throttle: Sheets API ~60 req/min
  let values: string[][];
  try {
    values = await getTabValues(workbookId, "Sheet3", "A1:C500000");
  } catch (err) {
    logger.error({ month, workbookId, err: String(err) }, "fetchPlumbingSheet3Production: failed to read Sheet3");
    throw new Error(
      `Failed to read Sheet3 from Plumbing workbook ${workbookId} for ${month}: ${String(err)}`,
    );
  }

  const rows: PlumbingSheet3Row[] = [];
  let candidateRows = 0;   // rows with a date + code + positive qty
  let unparseableDates = 0;
  for (const row of values) {
    const dateRaw = row[0];
    const codeRaw = String(row[1] ?? "").trim();
    const qty     = toNumber(row[2]);
    if (!dateRaw || !codeRaw || qty <= 0) continue;
    candidateRows++;
    const d = parseSheetDate(dateRaw);
    if (!d) { unparseableDates++; continue; }
    if (d.getFullYear() !== year || d.getMonth() + 1 !== mon) continue;
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    rows.push({ dateStr, rawCode: codeRaw, normCode: normalizeCodeStrict(codeRaw), qty });
  }

  // Date-format guard: ANY production row (code + positive qty) whose date we
  // cannot parse is a hard error, never a silent skip — silently dropped rows
  // understate produced/capacity and can turn into Cap/Day = 0 and a
  // 100%-shortfall corrective plan downstream.
  if (unparseableDates > 0) {
    const sample = values.find(r => r[0] && String(r[1] ?? "").trim() && toNumber(r[2]) > 0 && !parseSheetDate(r[0]))?.[0];
    throw new Error(
      `Sheet3 of Plumbing workbook ${workbookId} for ${month}: ${unparseableDates} of ${candidateRows} production rows have unrecognised date formats (sample: "${String(sample)}") — refusing to silently drop production rows. Supported: Sheets serials, ISO, "1-Aug-2026", "Aug 1, 2026".`,
    );
  }

  _sheet3Cache.set(month, { rows, expires: now + 15 * 60 * 1000 });
  logger.info({ month, workbookId, rowCount: rows.length, candidateRows, unparseableDates }, "fetchPlumbingSheet3Production: loaded");
  return rows;
}

/** Invalidate the Sheet3 in-process cache for a given month (e.g. after workbook config update). */
export function invalidatePlumbingSheet3Cache(month: string): void {
  _sheet3Cache.delete(month);
}

/**
 * Live order-book qty for the target month, from Order Sheet 26-27 "Combined" tab.
 * @param group ERP GROUP value to filter on — "PTMT" for PTMT segment, "PLUMBING" for Plumbing.
 */
export async function fetchLiveOrderTotals(month: string, group: string = "PTMT"): Promise<DualTotals> {
  guardPlanningRead("fetchLiveOrderTotals"); // display-only order book — never in plan build
  const [y, m] = month.split("-").map(Number);
  const label = monthLabel(y, m - 1).toLowerCase();
  const values = await throttledGetTabValues(SHEET_IDS.orderSheet, "Combined");
  const rows = rowsToObjects(values);
  const totals: DualTotals = { exact: new Map(), byCode: new Map() };
  const groupUpper = group.toUpperCase();
  for (const row of rows) {
    const rowGroup = String(row["GROUP"] ?? "").trim().toUpperCase();
    const rowMonth = String(row["Month"] ?? "").trim().toLowerCase();
    if (rowGroup !== groupUpper) continue;
    if (rowMonth && rowMonth !== label) continue;
    const code = row["Old ERP Code"];
    const colour = row["Item.Color"];
    const qty = toNumber(row["Quantity"]);
    if (!code) continue;
    addToDualTotals(totals, code, colour, qty);
  }
  return totals;
}

/**
 * Apply sheet-specific aliases for the "Pending order" report tab.
 * Codes ending in -LSBB, -LSTBB, -LSQBB are aliased to -LSB, -LSTB, -LSQB
 * and their colour is forced to BLUE.
 * Verified: 123-LSB/BLUE = 184 (via alias from 123-LSBB/BLACK).
 */
function applyPendingOrderAlias(code: string, colour: string): { code: string; colour: string } {
  // Order matters — check longer suffixes first to avoid partial replacement
  const patterns: [RegExp, string][] = [
    [/(-LSQBB)$/i, "-LSQB"],
    [/(-LSTBB)$/i, "-LSTB"],
    [/(-LSBB)$/i, "-LSB"],
  ];
  for (const [from, to] of patterns) {
    if (from.test(code)) {
      return { code: code.replace(from, to), colour: "BLUE" };
    }
  }
  return { code, colour };
}

/**
 * Live current pending order from "Pending order" Google Sheet → "report" tab.
 * Filter Segment (col X) = PTMT, key on Old ERP Code (col F) + Colour (col H),
 * sum Bal. Qty (col Q). Applies -LSBB/BLACK → -LSB/BLUE alias.
 * Verified: PTMT total 15,906; 120-WS/WHITE = 180; 123-LSB/BLUE = 184 (via alias).
 */
export async function fetchLivePendingOrderTotals(): Promise<DualTotals> {
  guardPlanningRead("fetchLivePendingOrderTotals"); // pending must come from uploads in plan build
  // Read enough columns to cover Segment at col X (index 23). Use "A1:X" to include
  // all columns A through X without a hard row cap that would truncate large sheets.
  const values = await throttledGetTabValues(SHEET_IDS.pendingOrder, "report", "A1:X50000");
  const rows = rowsToObjects(values);
  const totals: DualTotals = { exact: new Map(), byCode: new Map() };

  for (const row of rows) {
    const segment = String(row["Segment"] ?? "").trim().toUpperCase();
    if (segment !== "PTMT") continue;
    let code = String(row["Old ERP Code"] ?? "").trim();
    let colour = String(row["Colour"] ?? "").trim();
    const qty = toNumber(row["Bal. Qty"]);
    if (!code) continue;
    const aliased = applyPendingOrderAlias(code, colour);
    code = aliased.code;
    colour = aliased.colour;
    addToDualTotals(totals, code, colour, qty);
  }

  return totals;
}

/**
 * Snapshot the raw filtered rows from the "Pending order" sheet (for audit trail).
 * Returns an array of { catNo, colour, qty } for all PTMT rows after aliasing.
 */
export async function snapshotPendingOrderRows(): Promise<{ catNo: string; colour: string; qty: number }[]> {
  guardPlanningRead("snapshotPendingOrderRows");
  const values = await throttledGetTabValues(SHEET_IDS.pendingOrder, "report", "A1:X50000");
  const rows = rowsToObjects(values);
  const result: { catNo: string; colour: string; qty: number }[] = [];

  for (const row of rows) {
    const segment = String(row["Segment"] ?? "").trim().toUpperCase();
    if (segment !== "PTMT") continue;
    let code = String(row["Old ERP Code"] ?? "").trim();
    let colour = String(row["Colour"] ?? "").trim();
    const qty = toNumber(row["Bal. Qty"]);
    if (!code) continue;
    const aliased = applyPendingOrderAlias(code, colour);
    result.push({ catNo: aliased.code, colour: aliased.colour, qty });
  }

  return result;
}

// ── Plumbing daily-production workbook reader ────────────────────────────────

export interface PlumbingPlanRow {
  material: string;
  /**
   * Null when the workbook tab has no TYPE column and no section-header rows.
   * In this case the caller (plan.ts) resolves type from the FG stock Category field.
   */
  type: "Pipe" | "Fitting" | "Solvent" | null;
  /** e.g. "CPVC Pipe", "SWR Solvent". May be just the material name when type is null. */
  category: string;
  itemCode: string;
  /** Monthly average — "LAST 3 MONTH AVG SALE" is already the monthly average. */
  avg3MoSale: number;
  /**
   * Per-item buffer multiplier read from the sheet's own multiplier column.
   * Each material tab stores the multiplier (e.g. 1.0, 1.2, 1.5, 2.0) in a
   * column adjacent to the TYPE column; the sheet's own Buffer formula is
   * literally: Buffer = Avg3Mo × (this cell).
   *
   * Undefined when the cell is blank or out of range [0.5, 3.0].  Callers
   * should fall back to the DB category default in that case.
   */
  sheetMultiplier?: number;
}

function normItemType(raw: string): "Pipe" | "Fitting" | "Solvent" | null {
  const u = raw.trim().toUpperCase();
  if (u === "PIPE") return "Pipe";
  if (u === "FITTING" || u === "FITTINGS") return "Fitting";
  if (u === "SOLVENT") return "Solvent";
  return null;
}

const PLUMBING_MATERIALS = ["CPVC", "UPVC", "SWR", "AGRI"] as const;

/**
 * Reads each material tab (CPVC, UPVC, SWR, AGRI) of the Plumbing daily-production
 * workbook for the given planning month.  Every input column is located by its header
 * text in row 1, never by a fixed column letter — this makes the reader immune to the
 * different layouts per tab (e.g. item code is col E on CPVC, col G on UPVC, col F on
 * SWR / AGRI; Stock is col N on CPVC, P on UPVC, O on SWR, N on AGRI — and on AGRI
 * the Stock / Buffer columns are swapped relative to SWR).
 *
 * Headers matched (case-insensitive, partial):
 *   "LAST 3 MONTH AVG SALE"          → avg3MoSale (already the monthly average)
 *   "STOCK AS ON <date>"              → stock
 *   "BUFFER STOCK REQ FOR <month>"    → logged/verified but not used (recomputed from avg × multiplier)
 *   "PENDING ORDER" (not LAST MONTH)  → pendingOrder
 *   "PENDING ORDER LAST MONTH"        → pendingOrderLastMonth
 *   Item-code column                  → itemCode
 *   Type column (PIPE/FITTING/FITTINGS/SOLVENT values) → type
 *
 * ⚠ AGRI NOTE: the master's AGRI tab's own cell formula transposes the "STOCK AS ON" and
 * "BUFFER STOCK REQ" columns relative to every other material tab.  This reader locates both
 * columns by header name (never by position), so the values returned are correct regardless of
 * layout.  The standard planning formula max((Buffer − Stock) + PendingLM + Pending, 0) is then
 * applied uniformly by plan.ts — intentionally producing values that differ from the source sheet.
 */
export async function fetchPlumbingPlanData(month: string): Promise<PlumbingPlanRow[]> {
  // ALLOW-LISTED for planning — but restricted to the COLUMN allow-list:
  // item roster (code / type / material), avg-3-month, per-item multiplier.
  // Stock, pending, pending-last-month, buffer and any computed Production-
  // Required / Min / Max columns are NEVER read here (see tripwire below).
  return runInAllowedReadScope("fetchPlumbingPlanData", () => fetchPlumbingPlanDataInner(month));
}

/**
 * COMPUTED, NOT COPIED tripwire: none of the columns we map for reading may be
 * a finished plan column. The workbook contains both raw inputs and computed
 * Production-Required figures — reading the latter is prohibited outright.
 */
function assertNotComputedColumn(material: string, tab: string, purpose: string, headerText: string): void {
  if (/production\s*req|prod\.?\s*req|required\s*production|min\s*prod|max\s*prod|plan\s*qty|production\s*plan/i.test(headerText)) {
    throw new PlanningIsolationError(
      `fetchPlumbingPlanData mapped a COMPUTED plan column for "${purpose}" (tab ${tab} / ${material}: header "${headerText}")`,
      _planningContext.getStore()?.label ?? "column allow-list tripwire",
    );
  }
}

async function fetchPlumbingPlanDataInner(month: string): Promise<PlumbingPlanRow[]> {
  // Priority: DB-configured ID → Drive discovery → hardcoded map.
  // After finding any file, validate it has at least one material tab.
  // The Drive search can match wrong files (e.g. purchase workbooks) that share
  // "PLUMBING" + month + year in their name but have no CPVC/UPVC/SWR/AGRI tabs.
  const dbId = await loadWorkbookIdFromDb("Plumbing", month);
  const driveIds = dbId ? [] : await findPlumbingWorkbookIds(month); // skip Drive if DB has an ID
  const hardcodedId = PLUMBING_DAILY_WORKBOOK_IDS[month] ?? null;

  // Try DB ID first, then ALL Drive candidates, then hardcoded — use first that has material tabs.
  let fileId: string | null = null;
  let tabs: string[] = [];
  for (const candidateId of [...new Set([dbId, ...driveIds, hardcodedId].filter(Boolean) as string[])]) {
    const candidateTabs = await listTabs(candidateId);
    const hasMaterialTab = PLUMBING_MATERIALS.some((m) =>
      candidateTabs.some((t) => t.toUpperCase().includes(m)),
    );
    if (hasMaterialTab) {
      fileId = candidateId;
      tabs = candidateTabs;
      logger.info(
        { month, fileId, source: driveIds.includes(candidateId) ? "drive" : "hardcoded" },
        "fetchPlumbingPlanData: workbook validated — has material tabs",
      );
      break;
    }
    // Wrong file — invalidate Drive cache so next call re-searches
    if (driveIds.includes(candidateId)) _driveWorkbookCache.delete(month);
    logger.warn(
      { month, candidateId, tabs: candidateTabs },
      "fetchPlumbingPlanData: workbook has no material tabs — skipping",
    );
  }

  if (!fileId) {
    logger.warn({ month }, "fetchPlumbingPlanData: no valid Plumbing workbook found");
    return [];
  }

  const result: PlumbingPlanRow[] = [];

  for (const material of PLUMBING_MATERIALS) {
    // Prefer the plain "CPVC" / "UPVC" / "SWR" / "AGRI" tab over compound variants
    // like "CPVC TOP ITEM" that contain only the top-100 rows and no type column.
    // Priority: (1) exact case-insensitive match, (2) contains material but NOT "TOP ITEM",
    // (3) any tab containing the material name.
    const tab =
      tabs.find((t) => t.trim().toUpperCase() === material) ??
      tabs.find((t) => t.toUpperCase().includes(material) && !t.toUpperCase().includes("TOP")) ??
      tabs.find((t) => t.toUpperCase().includes(material));
    if (!tab) {
      logger.warn({ material, tabs, fileId }, "fetchPlumbingPlanData: no tab found for material");
      continue;
    }

    await sleep(1100); // throttle: Sheets API allows ~60 req/min
    const values = await getTabValues(fileId, tab, "A1:Z50000");

    // Scan the first 15 rows for the header row.
    // The header row contains "LAST 3 MONTH" and/or "PENDING ORDER".
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(15, values.length); i++) {
      const joined = values[i].map((c) => String(c ?? "")).join(" ").toUpperCase();
      if (joined.includes("LAST 3 MONTH") || (joined.includes("PENDING") && joined.includes("ORDER"))) {
        headerRowIdx = i;
        break;
      }
    }
    if (headerRowIdx < 0) {
      logger.warn({ material, tab }, "fetchPlumbingPlanData: header row not found in first 15 rows — skipping tab");
      continue;
    }

    const header = values[headerRowIdx].map((h) => String(h ?? "").trim());

    // COLUMN ALLOW-LIST (uploads-only rule, scoped 2026-08): only the item
    // roster (code/type), avg-3-month, and per-item multiplier are mapped.
    // Stock / pending / pending-LM / buffer columns exist in this workbook but
    // are NOT read — stock and pending come exclusively from uploads (plan.ts),
    // and the buffer is recomputed from avg × multiplier.
    const avg3moCol    = header.findIndex((h) => /last\s*3\s*month\s*avg|3.*month.*avg.*sale/i.test(h));
    // Prefer the canonical "ITEM CODE" / "ERP CODE" column over "OLD ITEM CODE".
    // "OLD ITEM CODE" columns are often populated only for fitting/finished-goods rows
    // and are empty for pipe items, causing entire pipe blocks to be silently skipped.
    // Declared as `let` so the positional fallback (after typeCol is known) can assign it.
    let codeCol = (() => {
      // 1st priority: exact "ITEM CODE" (not "OLD ITEM CODE")
      const exact = header.findIndex(h => /^item\s*code$/i.test(h.trim()));
      if (exact >= 0) return exact;
      // 2nd priority: ERP-prefixed code column
      const erp = header.findIndex(h => /erp.*code|code.*erp/i.test(h.trim()));
      if (erp >= 0) return erp;
      // 3rd priority: any item-code column whose header does NOT start with "OLD"
      const noOld = header.findIndex(h => /item\s*code/i.test(h) && !/^old/i.test(h.trim()));
      if (noOld >= 0) return noOld;
      // Fallback: first match of any item/code pattern
      return header.findIndex(h => /item\s*code|old.*item|erp.*code/i.test(h));
    })();

    // Type column: try "TYPE" header first, then detect by counting PIPE/FITTING/SOLVENT
    // hits per column across sample rows — picks the column with the MOST hits, not just
    // the first column with any hit.  This prevents column B (which may have item-name
    // fragments like "PIPE") from winning over column E (the actual type column where
    // every row carries exactly "PIPE", "FITTING", or "SOLVENT").
    let typeCol = header.findIndex((h) => /^type$/i.test(h));
    if (typeCol < 0) {
      const sampleRows = values.slice(headerRowIdx + 1, headerRowIdx + 21);
      let bestTypeCol = -1;
      let bestCount = 0;
      for (let col = 0; col < header.length; col++) {
        let count = 0;
        for (const dr of sampleRows) {
          const v = String(dr?.[col] ?? "").trim().toUpperCase();
          if (/^(PIPE|FITTING|FITTINGS|SOLVENT)$/.test(v)) count++;
        }
        if (count > bestCount) { bestCount = count; bestTypeCol = col; }
      }
      if (bestTypeCol >= 0) typeCol = bestTypeCol;
    }

    // Code column fallback: when the header regex finds nothing, use the layout the
    // user confirmed per tab:
    //   CPVC / UPVC / SWR : code is immediately to the right of type (typeCol + 1)
    //   AGRI               : there is an item-name column between type and code
    //                        so code is two columns to the right (typeCol + 2)
    //
    // We skip elaborate value-scanning heuristics because:
    //   • the early rows of each tab are blank section-header rows (no data to sample)
    //   • item "code" values in this workbook can be long descriptions, not short SKUs
    if (codeCol < 0 && typeCol >= 0) {
      const offset = material.toUpperCase() === "AGRI" ? 2 : 1;
      const candidate = typeCol + offset;
      if (candidate < header.length) codeCol = candidate;
    }

    // Multiplier column: each row stores its own buffer multiplier as a numeric cell.
    // Sheet formula: Buffer = Avg3Mo × (multiplier cell).  Examples confirmed:
    //   CPVC col C (typeCol-1): Pipe/Fitting=1.5, Solvent=2.0
    //   UPVC col E (typeCol-1): Pipe=1.2 or 1.5 per-item, Fitting=1.5, Solvent=2.0
    //   SWR  col D (typeCol-1): Pipe=1.0, Fitting=1.2, Solvent=1.0
    //   AGRI col E (typeCol+1): all 1.5
    //
    // Detection: for AGRI check typeCol+1 first (it sits between type and code);
    // for the others check typeCol-1 first.  Validate by requiring ≥60% of
    // non-blank item-row cells in a 40-row sample to be numeric in [0.5, 3.0].
    let multiplierCol = -1;
    if (typeCol >= 0) {
      const isAgri = material.toUpperCase() === "AGRI";
      const candidates = isAgri
        ? [typeCol + 1, typeCol - 1, typeCol + 2, typeCol - 2]
        : [typeCol - 1, typeCol + 1, typeCol - 2, typeCol + 2];
      const sampleRows = values.slice(headerRowIdx + 1, headerRowIdx + 41);
      for (const c of candidates) {
        if (c < 0 || c >= header.length) continue;
        const nonBlank = sampleRows
          .map((r) => String(r?.[c] ?? "").trim())
          .filter(Boolean);
        if (nonBlank.length === 0) continue;
        const inRange = nonBlank.filter((v) => {
          const n = parseFloat(v);
          return !isNaN(n) && n >= 0.5 && n <= 3.0;
        });
        if (inRange.length >= Math.max(1, nonBlank.length * 0.6)) {
          multiplierCol = c;
          break;
        }
      }
    }

    logger.info(
      { material, tab, headerRowIdx, codeCol, typeCol, multiplierCol, avg3moCol,
        header: header.slice(0, 20) },
      "fetchPlumbingPlanData: columns mapped (allow-list: roster / avg3mo / multiplier)",
    );

    // COMPUTED-NOT-COPIED tripwire: fail loudly if any mapped column is a
    // finished plan column rather than a raw input.
    if (avg3moCol >= 0)     assertNotComputedColumn(material, tab, "avg3MoSale", header[avg3moCol] ?? "");
    if (codeCol >= 0)       assertNotComputedColumn(material, tab, "itemCode",   header[codeCol] ?? "");
    if (multiplierCol >= 0) assertNotComputedColumn(material, tab, "multiplier", header[multiplierCol] ?? "");

    // codeCol and avg3moCol are required from the workbook (roster + sales history).
    // Stock / pending / pending-LM come from uploads — never required or read here.
    if (codeCol < 0 || avg3moCol < 0) {
      logger.warn(
        { material, tab, codeCol, avg3moCol },
        "fetchPlumbingPlanData: required columns (code/avg3mo) not found — skipping tab",
      );
      continue;
    }

    // ALL FOUR material tabs tag the type on EVERY item row — no section-header
    // carry-forward is needed.  Read the type directly from each row's type column.
    // Verified item-row coverage: CPVC 293/296, UPVC 324/327, SWR 297/300, AGRI 206/209.
    let rowCount = 0;
    for (let i = headerRowIdx + 1; i < values.length; i++) {
      const row = values[i];
      if (!row) continue;
      const rawCode = String(row[codeCol] ?? "").trim();

      // Skip blank rows and stray note text.
      // Note text (e.g. AGRI correction notice) appears in the item-code cell; it can be
      // identified because it contains a colon (":") which no item code ever contains.
      if (!rawCode || rawCode.includes(":")) continue;

      // Read type directly from this row's own type column.
      const itemType: "Pipe" | "Fitting" | "Solvent" | null = typeCol >= 0
        ? normItemType(String(row[typeCol] ?? ""))
        : null;

      const rawMult = multiplierCol >= 0 ? toNumber(row[multiplierCol]) : 0;
      const sheetMultiplier = rawMult >= 0.5 && rawMult <= 3.0 ? rawMult : undefined;

      result.push({
        material,
        type: itemType,
        category: itemType ? `${material} ${itemType}` : material,
        itemCode: rawCode,
        avg3MoSale: toNumber(row[avg3moCol]),
        // Stock / pending / pending-LM intentionally NOT read — uploads only (plan.ts).
        sheetMultiplier,
      });
      rowCount++;
    }
    logger.info({ material, tab, typeCol, codeCol, rowCount }, "fetchPlumbingPlanData: rows parsed");
  }

  return result;
}
