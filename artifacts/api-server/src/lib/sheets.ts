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

// Cache tab lists for 10 minutes — sheet structure changes are rare intra-session
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

/** Live order-book qty for the target month, from Order Sheet 26-27 "Combined" tab, GROUP=PTMT. */
export async function fetchLiveOrderTotals(month: string): Promise<DualTotals> {
  const [y, m] = month.split("-").map(Number);
  const label = monthLabel(y, m - 1).toLowerCase();
  const values = await throttledGetTabValues(SHEET_IDS.orderSheet, "Combined");
  const rows = rowsToObjects(values);
  const totals: DualTotals = { exact: new Map(), byCode: new Map() };
  for (const row of rows) {
    const group = String(row["GROUP"] ?? "").trim().toUpperCase();
    const rowMonth = String(row["Month"] ?? "").trim().toLowerCase();
    if (group !== "PTMT") continue;
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
