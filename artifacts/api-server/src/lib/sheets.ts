import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "./logger";

const connectors = new ReplitConnectors();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const SHEET_IDS = {
  ptmtAnuj: "1AGmksx4gn6w0Wb9EF__yAV5v89IyAfX_f75ouW2c7Yw",
  orderSheet: "1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A",
  sale2627: "1rW9fvrdcmTy7Yd6RVV5dVpvZQ5knZMeKoMx8enZ6j24",
  saleSheet2627: "19LQGpkbZiecGaXdBvl48rPZT2LUz3sKekeKX5fHu7Ps",
  codeWiseSale2526: "1kcPcre-iT7k6zH9RViqwajnhxQoppoUz2z46LdY29mg",
  rateList: "1njO-srsS29qiE4t45-zr5njbB7R2Zb-oSnv2NL1ONY4",
} as const;

export const SHEET_LABELS: Record<keyof typeof SHEET_IDS, string> = {
  ptmtAnuj: "PTMT ANUJ",
  orderSheet: "Order Sheet 26-27",
  sale2627: "Sale 26-27",
  saleSheet2627: "SALE SHEET 26-27",
  codeWiseSale2526: "CODE WISE SALE 25-26",
  rateList: "rate list",
};

async function proxyJson(path: string): Promise<any> {
  const res = await connectors.proxy("google-sheet", path, { method: "GET" });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Sheets API error ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function listTabs(sheetId: string): Promise<string[]> {
  const data = await proxyJson(`/v4/spreadsheets/${sheetId}?fields=sheets.properties`);
  return (data.sheets ?? []).map((s: any) => s.properties.title as string);
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

/** Sum sale quantity by item+colour across the rolling 3-month tab in "Sale 26-27" for the target month. */
export async function fetchAvg3MoSaleTotals(month: string): Promise<DualTotals> {
  const months = priorThreeMonths(month);
  const tabs = await listTabs(SHEET_IDS.sale2627);
  const matchTab = tabs.find((t) => tabMatchesAllMonths(t, months));
  if (!matchTab) {
    logger.warn({ tabs, month }, "No rolling 3-month sale tab found in Sale 26-27; falling back to Combined");
  }
  const tab = matchTab ?? "Combined";
  const values = await throttledGetTabValues(SHEET_IDS.sale2627, tab);
  const rows = rowsToObjects(values);
  const totals: DualTotals = { exact: new Map(), byCode: new Map() };
  for (const row of rows) {
    const code = row["Item Code"] ?? row["CODE"];
    const colour = row["COLOR"] ?? row["Color"] ?? row["Colour"];
    const qty = toNumber(row["Quantity"] ?? row["QTY"]);
    if (!code) continue;
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
