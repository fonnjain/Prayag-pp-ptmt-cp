import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

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

async function proxyJson(path: string): Promise<any> {
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
  const res = await getConnectors().proxy("google-drive", path, { method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Drive API error ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
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
const _driveWorkbookCache = new Map<string, { fileId: string | null; expires: number }>();

/**
 * Searches Google Drive for the Plumbing daily-production workbook for a given
 * planning month (YYYY-MM).  Returns the file ID of the best match, or null if
 * none found or Drive is not connected.  Falls back to PLUMBING_DAILY_WORKBOOK_IDS.
 */
async function findPlumbingWorkbookId(month: string): Promise<string | null> {
  const now = Date.now();
  const cached = _driveWorkbookCache.get(month);
  if (cached && cached.expires > now) return cached.fileId;

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
    const match = files.find((f) => {
      const upper = f.name.toUpperCase();
      return (
        abbrevs.some((a) => upper.includes(a.toUpperCase())) &&
        (upper.includes(year) || upper.includes(yearShort))
      );
    });

    const fileId = match?.id ?? null;
    _driveWorkbookCache.set(month, { fileId, expires: now + 30 * 60 * 1000 });
    if (fileId) {
      logger.info({ month, fileName: match!.name, fileId }, "fetchPlumbingPlanData: workbook found via Drive");
    } else {
      logger.warn(
        { month, candidates: files.slice(0, 5).map((f) => f.name) },
        "fetchPlumbingPlanData: no matching Plumbing workbook in Drive",
      );
    }
    return fileId;
  } catch (err) {
    logger.warn({ month, err: String(err) }, "fetchPlumbingPlanData: Drive lookup failed — using hardcoded ID");
    return null;
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
  const now = Date.now();
  if (_bomWeightsCache && _bomWeightsCache.expires > now) return _bomWeightsCache.weights;

  const tabs = await listTabs(PLUMBING_BOM_SHEET_ID);
  const tab =
    tabs.find((t) => /^combined$/i.test(t.trim())) ??
    tabs.find((t) => /^new$/i.test(t.trim())) ??
    tabs.find((t) => /combined|new/i.test(t)) ??
    tabs[0];

  if (!tab) {
    logger.warn({ sheetId: PLUMBING_BOM_SHEET_ID }, "Plumbing BOM sheet has no tabs — weights will be empty");
    return new Map();
  }

  const values = await getTabValues(PLUMBING_BOM_SHEET_ID, tab, "A1:Z100000");
  const weights = new Map<string, number>();

  // Find header row with ITEM CODE and Weight/pcs columns
  let headerIdx = -1;
  let codeColIdx = -1;
  let weightColIdx = -1;
  for (let i = 0; i < Math.min(15, values.length); i++) {
    const row = values[i];
    const c = row.findIndex((h) => /^item\s*code$/i.test(String(h ?? "").trim()));
    const w = row.findIndex((h) => /weight[^a-z]*pcs|wt[^a-z]*pcs/i.test(String(h ?? "").trim()));
    if (c >= 0 && w >= 0) { headerIdx = i; codeColIdx = c; weightColIdx = w; break; }
  }

  if (headerIdx < 0) {
    logger.warn({ tab, sheetId: PLUMBING_BOM_SHEET_ID }, "Plumbing BOM: cannot find ITEM CODE + Weight/pcs columns in first 15 rows");
    return new Map();
  }

  for (let i = headerIdx + 1; i < values.length; i++) {
    const row = values[i];
    const code = String(row[codeColIdx] ?? "").trim().toUpperCase();
    if (!code) continue;
    const weight = toNumber(row[weightColIdx]);
    // Only store positive weights — zero/blank means no BOM entry for this item
    if (weight > 0) weights.set(code, weight);
  }

  _bomWeightsCache = { weights, expires: now + 15 * 60 * 1000 };
  logger.info({ tab, count: weights.size }, "Plumbing BOM weights loaded");
  return weights;
}

/**
 * Live order-book qty for the target month, from Order Sheet 26-27 "Combined" tab.
 * @param group ERP GROUP value to filter on — "PTMT" for PTMT segment, "PLUMBING" for Plumbing.
 */
export async function fetchLiveOrderTotals(month: string, group: string = "PTMT"): Promise<DualTotals> {
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
  type: "Pipe" | "Fitting" | "Solvent";
  /** e.g. "CPVC Pipe", "SWR Solvent" */
  category: string;
  itemCode: string;
  /** Monthly average — "LAST 3 MONTH AVG SALE" is already the monthly average. */
  avg3MoSale: number;
  stock: number;
  pendingOrder: number;
  pendingOrderLastMonth: number;
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
 * ⚠ AGRI CORRECTION: the master's AGRI tab applies its formula to swapped Stock/Buffer
 * columns, so the master's AGRI Pipe / AGRI Fitting totals are wrong.  With header-name
 * mapping this app produces the correct values (≈20,299 AGRI Pipe; ≈54,590 AGRI Fitting).
 * This is intentional — do not "fix" back to match the master's figures.
 */
export async function fetchPlumbingPlanData(month: string): Promise<PlumbingPlanRow[]> {
  // Drive-based discovery is primary; hardcoded map is fallback.
  const driveId = await findPlumbingWorkbookId(month);
  const fileId = driveId ?? PLUMBING_DAILY_WORKBOOK_IDS[month] ?? null;
  if (!fileId) {
    logger.warn({ month }, "fetchPlumbingPlanData: no Plumbing workbook found (Drive + hardcoded both empty)");
    return [];
  }

  const tabs = await listTabs(fileId);
  const result: PlumbingPlanRow[] = [];

  for (const material of PLUMBING_MATERIALS) {
    const tab = tabs.find((t) => t.toUpperCase().includes(material));
    if (!tab) {
      logger.warn({ material, tabs, fileId }, "fetchPlumbingPlanData: no tab found for material");
      continue;
    }

    await sleep(1100); // throttle: Sheets API allows ~60 req/min
    const values = await getTabValues(fileId, tab, "A1:Z5000");

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

    // Map each required column to its index by matching header text.
    const avg3moCol    = header.findIndex((h) => /last\s*3\s*month\s*avg|3.*month.*avg.*sale/i.test(h));
    const stockCol     = header.findIndex((h) => /stock\s*as\s*on/i.test(h));
    const bufferCol    = header.findIndex((h) => /buffer\s*stock\s*req/i.test(h)); // informational
    const pendingLmCol = header.findIndex((h) => /pending.*last\s*month|last\s*month.*pending/i.test(h));
    // "PENDING ORDER" — must NOT be the "LAST MONTH" column
    const pendingCol = header.findIndex(
      (h, i) => /pending\s*order/i.test(h) && !/last\s*month/i.test(h) && i !== pendingLmCol,
    );
    const codeCol = header.findIndex((h) => /item\s*code|old.*item|erp.*code/i.test(h));

    // Type column: try "TYPE" header first, then detect by scanning first 20 data-row values.
    let typeCol = header.findIndex((h) => /^type$/i.test(h));
    if (typeCol < 0) {
      const sampleRows = values.slice(headerRowIdx + 1, headerRowIdx + 21);
      outer: for (let col = 0; col < header.length; col++) {
        for (const dr of sampleRows) {
          const v = String(dr?.[col] ?? "").trim().toUpperCase();
          if (/^(PIPE|FITTING|FITTINGS|SOLVENT)$/.test(v)) {
            typeCol = col;
            break outer;
          }
        }
      }
    }

    logger.info(
      { material, tab, headerRowIdx, codeCol, typeCol, avg3moCol, stockCol, pendingCol, pendingLmCol, bufferCol },
      "fetchPlumbingPlanData: columns mapped",
    );

    // Only codeCol, avg3moCol, and pendingCol are truly required from the workbook.
    // stockCol and pendingLmCol are NOT required — they come from the FG Stock upload.
    // typeCol is NOT required — we fall back to section-header detection when absent.
    if (codeCol < 0 || avg3moCol < 0 || pendingCol < 0) {
      logger.warn(
        { material, tab, codeCol, avg3moCol, pendingCol },
        "fetchPlumbingPlanData: required columns (code/avg3mo/pending) not found — skipping tab",
      );
      continue;
    }

    // When no explicit TYPE column exists, derive type from section-header rows.
    // Section headers are rows with no item code whose first 8 cells contain a type keyword.
    let currentSectionType: "Pipe" | "Fitting" | "Solvent" | null = null;

    let rowCount = 0;
    for (let i = headerRowIdx + 1; i < values.length; i++) {
      const row = values[i];
      if (!row) continue;
      const rawCode = String(row[codeCol] ?? "").trim();

      if (!rawCode) {
        // Potential section-header row — look for a type keyword
        if (typeCol < 0) {
          const joined = row.slice(0, 8).map((c) => String(c ?? "").trim().toUpperCase()).join(" ");
          if (/\bPIPE\b|\bPIPING\b|\bPIPES\b/.test(joined)) currentSectionType = "Pipe";
          else if (/\bFITTING\b|\bFITTINGS\b/.test(joined)) currentSectionType = "Fitting";
          else if (/\bSOLVENT\b/.test(joined)) currentSectionType = "Solvent";
        }
        continue;
      }

      // Determine item type: explicit column first, then section-header fallback
      let itemType: "Pipe" | "Fitting" | "Solvent" | null;
      if (typeCol >= 0) {
        itemType = normItemType(String(row[typeCol] ?? ""));
      } else {
        itemType = currentSectionType;
      }
      if (!itemType) continue; // type unknown — skip totals / blanks

      result.push({
        material,
        type: itemType,
        category: `${material} ${itemType}`,
        itemCode: rawCode,
        avg3MoSale:            toNumber(row[avg3moCol]),
        // stockCol / pendingLmCol may be -1 (come from FG upload, not workbook).
        // plan.ts overwrites these from the FG stock upload map.
        stock:                 stockCol >= 0 ? toNumber(row[stockCol]) : 0,
        pendingOrder:          toNumber(row[pendingCol]),
        pendingOrderLastMonth: pendingLmCol >= 0 ? toNumber(row[pendingLmCol]) : 0,
      });
      rowCount++;
    }
    logger.info({ material, tab, typeColSource: typeCol >= 0 ? "column" : "section-headers", rowCount }, "fetchPlumbingPlanData: rows parsed");
  }

  return result;
}
