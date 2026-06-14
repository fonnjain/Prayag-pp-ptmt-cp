import { createHash } from "node:crypto";
import { sql, eq, and } from "drizzle-orm";
import {
  db,
  sourceConfig,
  importBatches,
  sales,
  orders,
  production,
  pendingOrders,
  stockOpening,
  items,
} from "@workspace/db";
import { readRange, listTabs, googleStatus } from "../lib/google";

export interface BatchSummary {
  id: number;
  division: string | null;
  dataType: string | null;
  planMonth: string | null;
  sourceFileId: string | null;
  contentHash: string | null;
  rowsAdded: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsRejected: number;
  acknowledged: boolean;
  noChange: boolean;
  pulledAt: string | null;
}

// Per-source diagnostics handed to the deterministic Layer A sanity check.
export interface SourceDiag {
  dataType: string;
  handler: string;
  fileId: string;
  expectedFileId: string | null;
  fileMatches: boolean;
  tab: string | null;
  empty: boolean;
  rows: number;
  rejected: number;
  distinctCodes: number;
  prevRows: number | null;
  prevDistinct: number | null;
  dateMin: string | null;
  dateMax: string | null;
  windowFrom: string | null;
  windowTo: string | null;
  outOfWindow: number;
  missingColumns: string[];
  negQty: number;
  amountMismatch: number;
}

type Row = Record<string, unknown>;

// Column alias dictionaries (lowercased header text -> canonical field).
const ALIASES: Record<string, Record<string, string[]>> = {
  sales: {
    invoiceNo: ["invoice no", "invoice", "bill no", "voucher no", "doc no"],
    saleDate: ["date", "invoice date", "bill date", "sale date"],
    itemCode: ["item code", "code", "item", "product code", "sku"],
    colour: ["colour", "color"],
    qty: ["qty", "quantity", "qnty", "nos"],
    rate: ["rate", "price"],
    amount: ["amount", "value", "net amount", "taxable value"],
    customer: ["customer", "party", "party name", "customer name"],
    grp: ["group", "grp", "category"],
    station: ["station", "city"],
    state: ["state"],
    month: ["month", "period"],
  },
  orders: {
    docNo: ["doc no", "order no", "document no", "po no", "voucher no"],
    orderDate: ["date", "order date"],
    customer: ["customer", "party", "party name"],
    location: ["location", "station", "city"],
    itemCode: ["item code", "code", "item", "sku"],
    itemName: ["item name", "name", "description"],
    colour: ["colour", "color"],
    unit: ["unit", "uom"],
    qty: ["qty", "quantity", "nos"],
    rate: ["rate", "price"],
    taxableValue: ["taxable value", "amount", "value"],
    month: ["month", "period"],
  },
  production: {
    prodDate: ["date", "production date", "prod date"],
    itemCode: ["item code", "code", "item", "sku", "cat no"],
    colour: ["colour", "color"],
    qty: ["qty", "quantity", "nos", "produced"],
    subGroup: ["sub group", "subgroup"],
    grp: ["group", "grp"],
    month: ["month", "period"],
  },
  pending: {
    itemCode: ["item code", "code", "item", "sku"],
    colour: ["colour", "color"],
    qty: ["qty", "quantity", "pending", "pending qty", "nos"],
    amount: ["amount", "value"],
    period: ["period", "type"],
  },
  stock: {
    itemCode: ["item code", "code", "item", "sku"],
    colour: ["colour", "color"],
    qty: ["qty", "quantity", "stock", "closing", "opening", "balance", "nos"],
    center: ["center", "centre", "godown", "warehouse"],
  },
  rate_list: {
    itemCode: ["item code", "code", "item", "sku"],
    name: ["name", "item name", "description"],
    model: ["model"],
    grp: ["group", "grp"],
    type: ["type"],
    category: ["category"],
    unit: ["unit", "uom"],
    altUnit: ["alt unit", "alternate unit"],
    materialCenter: ["material center", "material centre"],
    mrp: ["mrp"],
    saleRate: ["sale rate", "sale price", "rate", "price"],
    hsn: ["hsn", "hsn code"],
    gst: ["gst", "gst%", "tax"],
  },
};

// Required columns per handler — used to detect shifted/missing columns.
const REQUIRED_COLUMNS: Record<string, string[]> = {
  sales: ["itemCode", "qty", "saleDate"],
  orders: ["itemCode", "qty"],
  production: ["itemCode", "qty", "prodDate"],
  pending: ["itemCode", "qty"],
  stock: ["itemCode", "qty"],
  rate_list: ["itemCode"],
};

function norm(s: unknown): string {
  // Lowercase, drop dots/underscores (e.g. "Document No." / "Item.Color"),
  // collapse whitespace. Real sheet headers use inconsistent punctuation.
  return String(s ?? "")
    .toLowerCase()
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectHeader(
  rows: string[][],
  aliasMap: Record<string, string[]>,
): { headerIdx: number; colIndex: Record<string, number> } {
  // A cell matches an alias if it equals it (exact) or contains it as a
  // substring, e.g. "old erp code" contains "code", "bal qty" contains "qty".
  const fuzzy = (cell: string, aliases: string[]): boolean =>
    aliases.some((a) => cell === a || cell.includes(a));
  let best = { idx: -1, score: 0 };
  const scan = Math.min(rows.length, 15);
  for (let i = 0; i < scan; i++) {
    const cells = (rows[i] ?? []).map(norm);
    let score = 0;
    for (const aliases of Object.values(aliasMap)) {
      if (cells.some((c) => fuzzy(c, aliases))) score++;
    }
    if (score > best.score) best = { idx: i, score };
  }
  const colIndex: Record<string, number> = {};
  if (best.idx >= 0) {
    const cells = (rows[best.idx] ?? []).map(norm);
    for (const [field, aliases] of Object.entries(aliasMap)) {
      // Prefer an exact header match; fall back to a substring match so dotted
      // / prefixed headers ("Item.Color", "Old ERP Code") still resolve.
      let idx = cells.findIndex((c) => aliases.includes(c));
      if (idx < 0) idx = cells.findIndex((c) => aliases.some((a) => c.includes(a)));
      if (idx >= 0) colIndex[field] = idx;
    }
  }
  return { headerIdx: best.idx, colIndex };
}

function sheetDateToYMD(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v)) {
    // Google/Excel serial date (days since 1899-12-30)
    const ms = Math.round((v - 25569) * 86400 * 1000);
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  const m = s.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
  if (m) {
    const [, a, b, c] = m;
    const yr = c!.length === 2 ? `20${c}` : c!;
    return `${yr}-${b!.padStart(2, "0")}-${a!.padStart(2, "0")}`;
  }
  return null;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function contentHash(rows: Row[]): string {
  const h = createHash("sha256");
  h.update(JSON.stringify(rows));
  return h.digest("hex");
}

const MONTH_ABBR = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];
const MONTH_FULL = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

// Candidate tab tokens for a plan month, most-specific first. Used when a
// source's tab_pattern is the literal '{month}' placeholder (per-month tabs,
// e.g. CP production 'MAY-26'/'JUN-26' or orders 'Apr'/'May'/'Jun').
function monthTokens(pmFrom: string): string[] {
  const d = new Date(`${pmFrom.slice(0, 10)}T00:00:00Z`);
  const m = d.getUTCMonth();
  const yyyy = d.getUTCFullYear();
  const yy = String(yyyy).slice(2);
  const abbr = MONTH_ABBR[m]!;
  const full = MONTH_FULL[m]!;
  const mm = String(m + 1).padStart(2, "0");
  return [
    `${abbr}-${yy}`, `${abbr} ${yy}`, `${abbr}'${yy}`, `${abbr}${yy}`,
    `${full}-${yy}`, `${full} ${yy}`, `${full}'${yy}`,
    `${abbr}-${yyyy}`, `${full}-${yyyy}`,
    `${mm}-${yy}`, `${mm}/${yy}`,
    abbr, full,
  ];
}

async function resolveTab(
  fileId: string,
  pattern: string | null,
  pmFrom?: string,
): Promise<string | null> {
  let tabs: string[] = [];
  try {
    tabs = await listTabs(fileId);
  } catch {
    return null;
  }
  if (tabs.length === 0) return null;
  const p = pattern ? norm(pattern) : "";
  // Month-aware: a '{month}' pattern picks the tab for this plan month.
  if (p.includes("{month}") && pmFrom) {
    const toks = monthTokens(pmFrom);
    for (const t of toks) {
      const exact = tabs.find((x) => norm(x) === t);
      if (exact) return exact;
    }
    for (const t of toks) {
      const partial = tabs.find((x) => norm(x).includes(t));
      if (partial) return partial;
    }
    return tabs[0] ?? null;
  }
  if (!p) return tabs[0] ?? null;
  const exact = tabs.find((t) => norm(t) === p);
  if (exact) return exact;
  const partial = tabs.find((t) => norm(t).includes(p) || p.includes(norm(t)));
  return partial ?? tabs[0] ?? null;
}

interface MappedResult {
  rows: Row[];
  rejected: number;
  colIndex: Record<string, number>;
  headerIdx: number;
}

function mapRows(
  values: string[][],
  dataType: string,
  division: string,
  planMonth: string,
): MappedResult {
  const aliasMap = ALIASES[dataType];
  if (!aliasMap) return { rows: [], rejected: 0, colIndex: {}, headerIdx: -1 };
  const { headerIdx, colIndex } = detectHeader(values, aliasMap);
  if (headerIdx < 0) return { rows: [], rejected: 0, colIndex: {}, headerIdx: -1 };
  const get = (row: string[], field: string): unknown => {
    const idx = colIndex[field];
    return idx === undefined ? undefined : row[idx];
  };
  const out: Row[] = [];
  let rejected = 0;
  for (let i = headerIdx + 1; i < values.length; i++) {
    const row = values[i] ?? [];
    if (row.every((c) => String(c ?? "").trim() === "")) continue;
    const itemCode = String(get(row, "itemCode") ?? "").trim();
    if (!itemCode) {
      rejected++;
      continue;
    }
    const colour = String(get(row, "colour") ?? "").trim();
    if (dataType === "sales") {
      out.push({
        invoiceNo: String(get(row, "invoiceNo") ?? "").trim() || null,
        saleDate: sheetDateToYMD(get(row, "saleDate")),
        itemCode,
        colour,
        qty: String(toNum(get(row, "qty")) ?? ""),
        rate: nstr(toNum(get(row, "rate"))),
        amount: nstr(toNum(get(row, "amount"))),
        customer: String(get(row, "customer") ?? "").trim() || null,
        grp: String(get(row, "grp") ?? "").trim() || null,
        station: String(get(row, "station") ?? "").trim() || null,
        state: String(get(row, "state") ?? "").trim() || null,
        month: String(get(row, "month") ?? "").trim() || null,
        division,
      });
    } else if (dataType === "orders") {
      out.push({
        docNo: String(get(row, "docNo") ?? "").trim() || null,
        orderDate: sheetDateToYMD(get(row, "orderDate")),
        customer: String(get(row, "customer") ?? "").trim() || null,
        location: String(get(row, "location") ?? "").trim() || null,
        itemCode,
        itemName: String(get(row, "itemName") ?? "").trim() || null,
        colour,
        unit: String(get(row, "unit") ?? "").trim() || null,
        qty: nstr(toNum(get(row, "qty"))),
        rate: nstr(toNum(get(row, "rate"))),
        taxableValue: nstr(toNum(get(row, "taxableValue"))),
        month: String(get(row, "month") ?? "").trim() || null,
        division,
      });
    } else if (dataType === "production") {
      const pd = sheetDateToYMD(get(row, "prodDate"));
      if (!pd) {
        rejected++;
        continue;
      }
      out.push({
        prodDate: pd,
        itemCode,
        colour,
        qty: nstr(toNum(get(row, "qty"))),
        subGroup: String(get(row, "subGroup") ?? "").trim() || null,
        grp: String(get(row, "grp") ?? "").trim() || null,
        month: String(get(row, "month") ?? "").trim() || null,
        division,
      });
    } else if (dataType === "pending") {
      const periodRaw = norm(get(row, "period"));
      const period = periodRaw.includes("last") ? "last_month" : "current";
      out.push({
        itemCode,
        colour,
        qty: nstr(toNum(get(row, "qty"))),
        amount: nstr(toNum(get(row, "amount"))),
        period,
        planMonth: planMonth.slice(0, 10),
        division,
      });
    } else if (dataType === "stock") {
      out.push({
        itemCode,
        colour,
        qty: nstr(toNum(get(row, "qty"))),
        center: String(get(row, "center") ?? "").trim() || null,
        asOn: planMonth.slice(0, 10),
        division,
      });
    } else if (dataType === "rate_list") {
      out.push({
        itemCode,
        name: String(get(row, "name") ?? "").trim() || null,
        model: String(get(row, "model") ?? "").trim() || null,
        grp: String(get(row, "grp") ?? "").trim() || null,
        type: String(get(row, "type") ?? "").trim() || null,
        category: String(get(row, "category") ?? "").trim() || null,
        unit: String(get(row, "unit") ?? "").trim() || null,
        altUnit: String(get(row, "altUnit") ?? "").trim() || null,
        materialCenter: String(get(row, "materialCenter") ?? "").trim() || null,
        mrp: nstr(toNum(get(row, "mrp"))),
        saleRate: nstr(toNum(get(row, "saleRate"))),
        hsn: String(get(row, "hsn") ?? "").trim() || null,
        gst: String(get(row, "gst") ?? "").trim() || null,
        division,
      });
    }
  }
  return { rows: out, rejected, colIndex, headerIdx };
}

function nstr(v: number | null): string | null {
  return v === null ? null : String(v);
}

// Business key per handler, used to de-duplicate within a single batch so the
// ON CONFLICT upsert never tries to touch the same row twice in one statement.
function dedupeKey(handler: string, r: Row): string {
  const g = (k: string) => String(r[k] ?? "");
  switch (handler) {
    case "sales":
      return [g("invoiceNo"), g("itemCode"), g("colour"), g("division")].join("|");
    case "orders":
      return [g("docNo"), g("itemCode"), g("colour"), g("division")].join("|");
    case "production":
      return [g("prodDate"), g("itemCode"), g("colour"), g("division")].join("|");
    case "pending":
      return [g("itemCode"), g("colour"), g("period"), g("planMonth"), g("division")].join("|");
    case "stock":
      return [g("itemCode"), g("colour"), g("asOn"), g("division")].join("|");
    case "rate_list":
      return [g("itemCode"), g("division")].join("|");
    default:
      return JSON.stringify(r);
  }
}

function dedupe(handler: string, rows: Row[]): Row[] {
  const map = new Map<string, Row>();
  for (const r of rows) map.set(dedupeKey(handler, r), r); // keep last occurrence
  return [...map.values()];
}

interface UpsertCounts {
  added: number;
  updated: number;
}

async function upsertRows(handler: string, rows: Row[]): Promise<UpsertCounts> {
  if (rows.length === 0) return { added: 0, updated: 0 };
  const chunk = 300;
  const totals: UpsertCounts = { added: 0, updated: 0 };
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const c = await upsertChunk(handler, slice);
    totals.added += c.added;
    totals.updated += c.updated;
  }
  return totals;
}

// `(xmax = 0)` is true only for rows newly inserted by this statement; updated
// rows have a non-zero xmax. This lets us report rows added vs updated exactly.
const INSERTED = sql<boolean>`(xmax = 0)`;

function tally(rows: { inserted: boolean }[]): UpsertCounts {
  let added = 0;
  for (const r of rows) if (r.inserted) added++;
  return { added, updated: rows.length - added };
}

async function upsertChunk(handler: string, slice: Row[]): Promise<UpsertCounts> {
  switch (handler) {
    case "sales": {
      const r = await db
        .insert(sales)
        .values(slice as never)
        .onConflictDoUpdate({
          target: [sales.invoiceNo, sales.itemCode, sales.colour, sales.division],
          set: {
            qty: sql`excluded.qty`,
            rate: sql`excluded.rate`,
            amount: sql`excluded.amount`,
            saleDate: sql`excluded.sale_date`,
            month: sql`excluded.month`,
          },
        })
        .returning({ inserted: INSERTED });
      return tally(r);
    }
    case "orders": {
      const r = await db
        .insert(orders)
        .values(slice as never)
        .onConflictDoUpdate({
          target: [orders.docNo, orders.itemCode, orders.colour, orders.division],
          set: {
            qty: sql`excluded.qty`,
            rate: sql`excluded.rate`,
            taxableValue: sql`excluded.taxable_value`,
            orderDate: sql`excluded.order_date`,
          },
        })
        .returning({ inserted: INSERTED });
      return tally(r);
    }
    case "production": {
      const r = await db
        .insert(production)
        .values(slice as never)
        .onConflictDoUpdate({
          target: [
            production.prodDate,
            production.itemCode,
            production.colour,
            production.division,
          ],
          set: { qty: sql`excluded.qty` },
        })
        .returning({ inserted: INSERTED });
      return tally(r);
    }
    case "pending": {
      const r = await db
        .insert(pendingOrders)
        .values(slice as never)
        .onConflictDoUpdate({
          target: [
            pendingOrders.itemCode,
            pendingOrders.colour,
            pendingOrders.period,
            pendingOrders.planMonth,
            pendingOrders.division,
          ],
          set: { qty: sql`excluded.qty`, amount: sql`excluded.amount` },
        })
        .returning({ inserted: INSERTED });
      return tally(r);
    }
    case "stock": {
      const r = await db
        .insert(stockOpening)
        .values(slice as never)
        .onConflictDoUpdate({
          target: [
            stockOpening.itemCode,
            stockOpening.colour,
            stockOpening.asOn,
            stockOpening.division,
          ],
          set: { qty: sql`excluded.qty`, center: sql`excluded.center` },
        })
        .returning({ inserted: INSERTED });
      return tally(r);
    }
    case "rate_list": {
      const r = await db
        .insert(items)
        .values(slice as never)
        .onConflictDoUpdate({
          target: [items.itemCode, items.division],
          set: {
            name: sql`excluded.name`,
            model: sql`excluded.model`,
            category: sql`excluded.category`,
            saleRate: sql`excluded.sale_rate`,
            mrp: sql`excluded.mrp`,
          },
        })
        .returning({ inserted: INSERTED });
      return tally(r);
    }
    default:
      return { added: 0, updated: 0 };
  }
}

// Map a source_config data_type to the canonical ingestion handler key.
function handlerKey(dataType: string): string | null {
  const d = dataType.toLowerCase();
  if (d.includes("sales") && !d.includes("annual")) return "sales";
  if (d.includes("order")) return "orders";
  if (d.includes("production") || d.includes("prod")) return "production";
  if (d.includes("pending")) return "pending";
  if (d.includes("stock")) return "stock";
  if (d.includes("rate") || d.includes("item")) return "rate_list";
  return null; // annual_sales and others: not directly ingested
}

type Cfg = typeof sourceConfig.$inferSelect;

// A config applies to a plan month when the month falls within its
// [applies_from, applies_to] window (null bound = open).
function monthApplies(cfg: Cfg, pmFrom: string): boolean {
  const from = cfg.appliesFrom ? String(cfg.appliesFrom).slice(0, 10) : null;
  const to = cfg.appliesTo ? String(cfg.appliesTo).slice(0, 10) : null;
  if (from && pmFrom < from) return false;
  if (to && pmFrom > to) return false;
  return true;
}

// Select every source_config that applies to this division+month. Multiple
// configs can share a handler (e.g. both fiscal-year sales workbooks map to
// "sales") and are all ingested — the engine date-filters sales over windows up
// to 12 months, so the full multi-year history must be loaded; the windows, not
// the source choice, do the selection.
function selectConfigs(configs: Cfg[], pmFrom: string): { handler: string; cfg: Cfg }[] {
  const out: { handler: string; cfg: Cfg }[] = [];
  for (const cfg of configs) {
    const handler = handlerKey(cfg.dataType);
    if (!handler) continue;
    if (!monthApplies(cfg, pmFrom)) continue;
    out.push({ handler, cfg });
  }
  return out;
}

function addMonthsYMD(pmFrom: string, n: number): string {
  const d = new Date(`${pmFrom.slice(0, 10)}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
}

function endOfMonthYMD(pmFrom: string): string {
  const d = new Date(`${pmFrom.slice(0, 10)}T00:00:00Z`);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))
    .toISOString()
    .slice(0, 10);
}

// Expected date window for a handler given the plan month.
function windowFor(handler: string, pmFrom: string): { from: string; to: string } | null {
  const pm = pmFrom.slice(0, 10);
  const dayBefore = addMonthsYMD(pm, 0);
  const prevDay = new Date(`${pm}T00:00:00Z`);
  prevDay.setUTCDate(prevDay.getUTCDate() - 1);
  const beforePlan = prevDay.toISOString().slice(0, 10);
  // 12 months: the widest window the engine reads (annual avg). Sales sources
  // are intentionally full-history, so anything within a year is "in-window".
  if (handler === "sales") return { from: addMonthsYMD(pm, -12), to: beforePlan };
  if (handler === "orders" || handler === "production")
    return { from: dayBefore, to: endOfMonthYMD(pm) };
  return null;
}

function dateFieldFor(handler: string): string | null {
  if (handler === "sales") return "saleDate";
  if (handler === "orders") return "orderDate";
  if (handler === "production") return "prodDate";
  return null;
}

async function prevDistinctInTable(handler: string, division: string): Promise<number | null> {
  const table: Record<string, string> = {
    sales: "sales",
    orders: "orders",
    production: "production",
    pending: "pending_orders",
    stock: "stock_opening",
    rate_list: "items",
  };
  const t = table[handler];
  if (!t) return null;
  const res = await db.execute(
    sql`SELECT COUNT(DISTINCT item_code) AS n FROM ${sql.raw(t)} WHERE division=${division}`,
  );
  const n = Number((res.rows[0] as Record<string, unknown> | undefined)?.["n"]);
  return Number.isFinite(n) ? n : null;
}

function buildDiag(
  cfg: Cfg,
  handler: string,
  expectedFileId: string | null,
  tab: string | null,
  mapped: MappedResult,
  pmFrom: string,
  prevRows: number | null,
  prevDistinct: number | null,
): SourceDiag {
  const rows = mapped.rows;
  const dateField = dateFieldFor(handler);
  const win = windowFor(handler, pmFrom);
  const codes = new Set<string>();
  let dateMin: string | null = null;
  let dateMax: string | null = null;
  let outOfWindow = 0;
  let negQty = 0;
  let amountMismatch = 0;
  for (const r of rows) {
    const code = String(r["itemCode"] ?? "");
    if (code) codes.add(code);
    const q = Number(r["qty"]);
    if (Number.isFinite(q) && q < 0) negQty++;
    if (dateField) {
      const d = r[dateField] ? String(r[dateField]).slice(0, 10) : null;
      if (d) {
        if (!dateMin || d < dateMin) dateMin = d;
        if (!dateMax || d > dateMax) dateMax = d;
        if (win && (d < win.from || d > win.to)) outOfWindow++;
      }
    }
    // amount ~= qty * rate (where all present)
    const amt = handler === "orders" ? Number(r["taxableValue"]) : Number(r["amount"]);
    const rate = Number(r["rate"]);
    if (Number.isFinite(amt) && Number.isFinite(q) && Number.isFinite(rate) && rate > 0) {
      const expected = q * rate;
      const tol = Math.max(1, Math.abs(amt) * 0.05);
      if (Math.abs(amt - expected) > tol) amountMismatch++;
    }
  }
  const required = REQUIRED_COLUMNS[handler] ?? [];
  const missingColumns = required.filter((f) => mapped.colIndex[f] === undefined);
  return {
    dataType: cfg.dataType,
    handler,
    fileId: cfg.fileId,
    expectedFileId,
    fileMatches: expectedFileId === null || expectedFileId === cfg.fileId,
    tab,
    empty: rows.length === 0,
    rows: rows.length,
    rejected: mapped.rejected,
    distinctCodes: codes.size,
    prevRows,
    prevDistinct,
    dateMin,
    dateMax,
    windowFrom: win?.from ?? null,
    windowTo: win?.to ?? null,
    outOfWindow,
    missingColumns,
    negQty,
    amountMismatch,
  };
}

// A SourceDiag for a fetch that failed before any rows could be mapped (no tab
// resolved, or the read threw). Marked empty so the sanity layer treats the
// CURRENT fetch as a failure (blocker for core series) instead of silently
// relying on stale rows already in the table from a previous pull.
function failedDiag(cfg: Cfg, handler: string, tab: string | null): SourceDiag {
  return {
    dataType: cfg.dataType,
    handler,
    fileId: cfg.fileId,
    expectedFileId: cfg.fileId,
    fileMatches: true,
    tab,
    empty: true,
    rows: 0,
    rejected: 0,
    distinctCodes: 0,
    prevRows: null,
    prevDistinct: null,
    dateMin: null,
    dateMax: null,
    windowFrom: null,
    windowTo: null,
    outOfWindow: 0,
    missingColumns: [],
    negQty: 0,
    amountMismatch: 0,
  };
}

export interface PullOutcome {
  batches: BatchSummary[];
  diags: SourceDiag[];
  noChange: boolean;
}

// Pull all configured sources for a division+planMonth (optionally one source).
export async function pullData(
  division: string,
  planMonth: string,
  pulledBy: string | null,
  onlyHandler?: string,
): Promise<PullOutcome> {
  const status = await googleStatus();
  if (!status.connected) {
    throw new Error(status.message);
  }

  const pmFrom = planMonth.slice(0, 10);
  const allConfigs = await db
    .select()
    .from(sourceConfig)
    .where(eq(sourceConfig.division, division));

  // Apply month-applicability + fiscal-year selection: one config per handler.
  const selected = selectConfigs(allConfigs, pmFrom);

  const batches: BatchSummary[] = [];
  const diags: SourceDiag[] = [];
  let anyChange = false;

  // Count source files per handler: a handler with several workbooks (e.g. two
  // fiscal-year sales files) makes the table-wide distinct-code comparison
  // misleading, so we skip prevDistinct for those.
  const handlerSourceCount = new Map<string, number>();
  for (const { handler } of selected) {
    handlerSourceCount.set(handler, (handlerSourceCount.get(handler) ?? 0) + 1);
  }

  for (const { handler, cfg } of selected) {
    if (onlyHandler && handler !== onlyHandler && cfg.dataType !== onlyHandler) continue;

    const tab = await resolveTab(cfg.fileId, cfg.tabPattern, pmFrom);
    if (!tab) {
      const [b] = await db
        .insert(importBatches)
        .values({
          division,
          dataType: cfg.dataType,
          planMonth: pmFrom,
          sourceFileId: cfg.fileId,
          contentHash: `notab-${Date.now()}`,
          rowsAdded: 0,
          rowsUpdated: 0,
          rowsSkipped: 0,
          rowsRejected: 0,
          sanitySummary: "No matching tab found in the source workbook.",
          pulledBy,
        })
        .returning();
      if (b) batches.push(toSummary(b, false));
      diags.push(failedDiag(cfg, handler, null));
      continue;
    }

    let values: string[][] = [];
    try {
      values = await readRange(cfg.fileId, `${tab}!A1:Z200000`);
    } catch (err) {
      const [b] = await db
        .insert(importBatches)
        .values({
          division,
          dataType: cfg.dataType,
          planMonth: pmFrom,
          sourceFileId: cfg.fileId,
          contentHash: `error-${Date.now()}`,
          rowsAdded: 0,
          rowsUpdated: 0,
          rowsSkipped: 0,
          rowsRejected: 0,
          sanitySummary: `Read failed: ${err instanceof Error ? err.message : String(err)}`,
          pulledBy,
        })
        .returning();
      if (b) batches.push(toSummary(b, false));
      diags.push(failedDiag(cfg, handler, tab));
      continue;
    }

    const mapped = mapRows(values, handler, division, planMonth);
    const rows = dedupe(handler, mapped.rows);
    const hash = contentHash(rows);

    // previous accepted batch row count + previous distinct codes (pre-upsert).
    // Scope to THIS source file: a handler can have multiple workbooks (e.g. two
    // fiscal-year sales files). Comparing one workbook's row count against a
    // different workbook's last pull produced false "partial drop" blockers.
    const prevBatch = await db
      .select({ added: importBatches.rowsAdded, updated: importBatches.rowsUpdated })
      .from(importBatches)
      .where(
        and(
          eq(importBatches.division, division),
          eq(importBatches.dataType, cfg.dataType),
          eq(importBatches.planMonth, pmFrom),
          eq(importBatches.sourceFileId, cfg.fileId),
        ),
      )
      .orderBy(sql`pulled_at DESC NULLS LAST`, sql`id DESC`)
      .limit(1);
    const prevRows = prevBatch[0]
      ? (prevBatch[0].added ?? 0) + (prevBatch[0].updated ?? 0)
      : null;
    const prevDistinct =
      (handlerSourceCount.get(handler) ?? 1) > 1
        ? null
        : await prevDistinctInTable(handler, division);

    diags.push(
      buildDiag(cfg, handler, cfg.fileId, tab, { ...mapped, rows }, pmFrom, prevRows, prevDistinct),
    );

    // Identical content since the last pull -> skip as 'no change' (no new batch,
    // no re-upsert, original content hash preserved).
    const existing = await db
      .select()
      .from(importBatches)
      .where(
        and(
          eq(importBatches.division, division),
          eq(importBatches.dataType, cfg.dataType),
          eq(importBatches.planMonth, pmFrom),
          eq(importBatches.contentHash, hash),
        ),
      )
      .limit(1);

    if (existing[0]) {
      const e = existing[0];
      batches.push({
        ...toSummary(e, true),
        rowsAdded: 0,
        rowsUpdated: 0,
        rowsSkipped: rows.length,
        rowsRejected: mapped.rejected,
      });
      continue;
    }

    const counts = await upsertRows(handler, rows);
    anyChange = anyChange || counts.added > 0 || counts.updated > 0;
    const [b] = await db
      .insert(importBatches)
      .values({
        division,
        dataType: cfg.dataType,
        planMonth: pmFrom,
        sourceFileId: cfg.fileId,
        contentHash: hash,
        rowsAdded: counts.added,
        rowsUpdated: counts.updated,
        rowsSkipped: 0,
        rowsRejected: mapped.rejected,
        pulledBy,
      })
      .returning();
    if (b) batches.push(toSummary(b, false));
  }

  return { batches, diags, noChange: !anyChange };
}

function toSummary(b: typeof importBatches.$inferSelect, noChange: boolean): BatchSummary {
  return {
    id: b.id,
    division: b.division,
    dataType: b.dataType,
    planMonth: b.planMonth ? String(b.planMonth).slice(0, 10) : null,
    sourceFileId: b.sourceFileId,
    contentHash: b.contentHash,
    rowsAdded: b.rowsAdded ?? 0,
    rowsUpdated: b.rowsUpdated ?? 0,
    rowsSkipped: b.rowsSkipped ?? 0,
    rowsRejected: b.rowsRejected ?? 0,
    acknowledged: b.acknowledged ?? false,
    noChange,
    pulledAt: b.pulledAt ? new Date(b.pulledAt).toISOString() : null,
  };
}

export async function listBatches(
  division?: string,
  planMonth?: string,
): Promise<BatchSummary[]> {
  const conds = [];
  if (division) conds.push(eq(importBatches.division, division));
  if (planMonth) conds.push(eq(importBatches.planMonth, planMonth.slice(0, 10)));
  const rows = await db
    .select()
    .from(importBatches)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(sql`pulled_at DESC NULLS LAST`, sql`id DESC`)
    .limit(100);
  return rows.map((r) => toSummary(r, (r.rowsAdded ?? 0) === 0 && (r.rowsSkipped ?? 0) > 0));
}

export async function setSanityOnLatestBatch(
  division: string,
  planMonth: string,
  verdict: string,
  summary: string,
): Promise<number | undefined> {
  const pm = planMonth.slice(0, 10);
  const rows = await db
    .select({ id: importBatches.id })
    .from(importBatches)
    .where(and(eq(importBatches.division, division), eq(importBatches.planMonth, pm)))
    .orderBy(sql`pulled_at DESC NULLS LAST`, sql`id DESC`)
    .limit(1);
  const id = rows[0]?.id;
  if (id === undefined) return undefined;
  await db
    .update(importBatches)
    .set({ sanityVerdict: verdict, sanitySummary: summary })
    .where(eq(importBatches.id, id));
  return id;
}

export async function acknowledgeLatest(
  division: string,
  planMonth: string,
): Promise<void> {
  const pm = planMonth.slice(0, 10);
  await db
    .update(importBatches)
    .set({ acknowledged: true })
    .where(and(eq(importBatches.division, division), eq(importBatches.planMonth, pm)));
}

export async function isReadyToPlan(
  division: string,
  planMonth: string,
): Promise<{ ready: boolean; reason?: string }> {
  const pm = planMonth.slice(0, 10);
  const rows = await db
    .select({
      verdict: importBatches.sanityVerdict,
      acknowledged: importBatches.acknowledged,
    })
    .from(importBatches)
    .where(and(eq(importBatches.division, division), eq(importBatches.planMonth, pm)))
    .orderBy(sql`pulled_at DESC NULLS LAST`, sql`id DESC`)
    .limit(1);
  const latest = rows[0];
  if (!latest) return { ready: true }; // no pull recorded; allow building on seeded data
  if (latest.verdict === "block") {
    return { ready: false, reason: "Data sanity check is blocking. Resolve blockers and re-pull." };
  }
  if (latest.verdict === "warn" && !latest.acknowledged) {
    return { ready: false, reason: "Sanity warnings must be acknowledged before building the plan." };
  }
  return { ready: true };
}
