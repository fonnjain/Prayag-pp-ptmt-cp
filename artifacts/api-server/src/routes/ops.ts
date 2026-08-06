import { Router, type IRouter } from "express";
import { getTabValues, listTabs, SHEET_IDS, throttledGetTabValues, itemKey, normalizeCode, type DualTotals, fetchAvg3MoSaleTotals } from "../lib/sheets";
import { logger } from "../lib/logger";
import type * as ExcelJSType from "exceljs";
import { db, itemMasterTable, planRunsTable, planRunResultsTable } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";

const router: IRouter = Router();

// ─── In-memory cache (5-min TTL) ────────────────────────────────────────────
interface CacheEntry<T> { data: T; expiresAt: number }
const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 5 * 60 * 1000;

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return entry.data as T;
  return null;
}
function setCached<T>(key: string, data: T): void {
  cache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function toNum(v: unknown): number {
  const n = Number(String(v ?? "0").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function rowsToObjects(values: string[][]): Record<string, string>[] {
  if (values.length < 2) return [];
  const header = values[0];
  return values.slice(1).map((row) => {
    const obj: Record<string, string> = {};
    header.forEach((h, i) => { if (h) obj[h] = row[i] ?? ""; });
    return obj;
  });
}

const FISCAL_MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"] as const;

function fyToYears(fy: string): { startYear: number; endYear: number } {
  const [startStr, endStr] = fy.split("-");
  const startYear = parseInt(startStr, 10);
  const endYear = startStr.length === 4
    ? parseInt(endStr.length === 2 ? startStr.slice(0, 2) + endStr : endStr, 10)
    : startYear + 1;
  return { startYear, endYear };
}

const SHORT_MONTH_MAP: Record<string, string> = {
  jan: "Jan", january: "Jan",
  feb: "Feb", february: "Feb",
  mar: "Mar", march: "Mar",
  apr: "Apr", april: "Apr",
  may: "May",
  jun: "Jun", june: "Jun",
  jul: "Jul", july: "Jul",
  aug: "Aug", august: "Aug",
  sep: "Sep", september: "Sep",
  oct: "Oct", october: "Oct",
  nov: "Nov", november: "Nov",
  dec: "Dec", december: "Dec",
};

function normalizeMonth(raw: string): string | null {
  if (!raw) return null;
  // e.g. "Apr", "Apr-26", "April", "April 2026", "04", "4"
  const lower = raw.toLowerCase().trim();
  // Direct 3-letter match
  if (SHORT_MONTH_MAP[lower]) return SHORT_MONTH_MAP[lower];
  // e.g. "apr-26" → "apr"
  const prefix3 = lower.slice(0, 3);
  if (SHORT_MONTH_MAP[prefix3]) return SHORT_MONTH_MAP[prefix3];
  // Numeric month "04" or "4"
  const num = parseInt(lower, 10);
  if (!isNaN(num) && num >= 1 && num <= 12) {
    return ["","Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][num];
  }
  return null;
}

function deriveChannel(state: string, stateHead: string): string {
  const combined = `${state} ${stateHead}`.toUpperCase();
  if (combined.includes("JJM")) return "JJM";
  if (combined.includes("GEM")) return "GeM";
  if (combined.includes("GOVT")) return "Govt";
  if (combined.includes("PROJECT")) return "Project";
  return "Retail";
}

// ─── Order Sheet IDs by FY ───────────────────────────────────────────────────
const ORDER_SHEET_IDS: Record<string, string> = {
  "2026-27": "1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A",
  "2025-26": "1Xzq-gmB6K7iuMcE6gb-O7OpvGgSDU33DzEVyK60LK6E",
  "2024-25": "1cT6lWRPJ3oSeYhab-cqeVjJidGitFQsr0DOq-vNn6cI",
  "2023-24": "1jtSUGE6iT8WuUKi56F4LYqjJgZF42oR1mk51imG8yq8",
};

// ─── Production Sheet manifest (subset — recent FYs) ────────────────────────
// Full manifest has 68 sheets; we include post-2023 for performance
const PTMT_MONTHS: Array<{ year: number; month: string; id: string; pp_col: string }> = [
  { year: 2023, month: "Apr", id: "1VWRSgV2MimJGl_jEQwXEFZCc6HqW2MqTixfVq9gMxpw", pp_col: "O" },
  { year: 2023, month: "May", id: "1bI-y7bY3OE_P-hGC4jz2KuXGEMt5wdUJAHiMt3IqFJA", pp_col: "O" },
  { year: 2023, month: "Jun", id: "1bKyUKtM0y1Fwy_Xt9_Wn4sRbQFEpBh-C2c_CIjnNH0Y", pp_col: "O" },
  { year: 2023, month: "Jul", id: "1sOr5Y6_2oiNXlF7nCJmb5VBPDdI5g22EgZ_eiqJGolg", pp_col: "O" },
  { year: 2023, month: "Aug", id: "1IiqZVyLHYZqWy4zOstJbFcA2JjQ1YM8d5JqJLQlgWm8", pp_col: "O" },
  { year: 2023, month: "Sep", id: "1mG_MZ0kqFBqaOJwK-T9T4FE7QN7C3cUMgUZcMh8z6sY", pp_col: "O" },
  { year: 2023, month: "Oct", id: "1xnB_wFBg3kc8jVXBlUDCvqfxQS0c_gBZXjhBqm1vC2Y", pp_col: "O" },
  { year: 2023, month: "Nov", id: "1P7W7qlvpX7Bdr75j5gFbQK2GDEX2Yk2Eqd0_GOhg3ic", pp_col: "O" },
  { year: 2023, month: "Dec", id: "1Gkp3e5taqBsQqQpIGb1X73RCPjODHlDMdLy6-blLVBU", pp_col: "O" },
  { year: 2024, month: "Jan", id: "13MKGqkMdEjdHMwz0cOWEyIXsJkbHEv0lPHBfmzqFiUU", pp_col: "O" },
  { year: 2024, month: "Feb", id: "1VT2b4pzPqHRmMSE1sKFHOSzHFNxGbBhEFLMvIHdAyU0", pp_col: "O" },
  { year: 2024, month: "Mar", id: "1NRyIbmCRgN5v0sLMFyUYpH8yOiN7UeYAcIl_r3M5tpY", pp_col: "O" },
  { year: 2024, month: "Apr", id: "16zsh5x4MdY8DX3H5_hw5iaOdkGixlUsPzesDVnwgfYo", pp_col: "P" },
  { year: 2024, month: "May", id: "1T1M5MT47P3D4wCwi7tX7KcL_sHVtx43NSuXFDP9Oq78", pp_col: "P" },
  { year: 2024, month: "Jun", id: "1nEDFjrVu6pnNkzZ9tJhvGvBDMUHjLStcc0RP2uHig4g", pp_col: "P" },
  { year: 2024, month: "Jul", id: "1AjMLfcBkI0rGY8JdYP3MO8Ocn8lO-HIpol1tHgvK9O8", pp_col: "P" },
];

const REPORT_TAB_CATEGORIES: Record<string, string> = {
  "REPORT 1": "Cocks Standard",
  "REPORT 2": "Cocks Premium",
  "REPORT 3": "Faucets & Jetsprays & Shower",
  "REPORT 4": "Accessories",
  "REPORT 5": "Cistern & Seat Cover",
  "REPORT 6": "Cabinet",
  "REPORT 7": "Ball Cock",
};

// ─── Sales Sheet IDs ─────────────────────────────────────────────────────────
const SALE_MASTER_3YR_ID = "1JpHX_hiRZ1l2QyyS3X3LbbsyqSLQ0oyIs3n9emnoH3s";

// ─── Festival & Season config ────────────────────────────────────────────────
const FESTIVAL_CONFIG = {
  diwali: [
    { date: "2022-10-24", label: "Diwali '22" },
    { date: "2023-11-12", label: "Diwali '23" },
    { date: "2024-11-01", label: "Diwali '24" },
    { date: "2025-10-21", label: "Diwali '25" },
    { date: "2026-11-08", label: "Diwali '26" },
  ],
  holi: [
    { date: "2022-03-18", label: "Holi '22" },
    { date: "2023-03-08", label: "Holi '23" },
    { date: "2024-03-25", label: "Holi '24" },
    { date: "2025-03-14", label: "Holi '25" },
  ],
  seasons: [
    { name: "Winter", months: [12, 1, 2], color: "#93c5fd" },
    { name: "Pre-Monsoon", months: [3, 4, 5], color: "#fde68a" },
    { name: "Monsoon", months: [6, 7, 8, 9], color: "#6ee7b7" },
    { name: "Post-Monsoon", months: [10, 11], color: "#fca5a5" },
  ],
};

// ─── GET /ops/orders ──────────────────────────────────────────────────────────
router.get("/ops/orders", async (req, res): Promise<void> => {
  const fy = String(req.query.fy ?? "2026-27");
  const cacheKey = `ops:orders:${fy}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  const sheetId = ORDER_SHEET_IDS[fy];
  if (!sheetId) {
    res.status(400).json({ error: `Unknown FY: ${fy}` });
    return;
  }

  try {
    const tabs = await listTabs(sheetId);
    const monthlyTabs = FISCAL_MONTHS.filter((m) => tabs.includes(m));

    let allRows: Record<string, string>[] = [];
    for (const tab of monthlyTabs) {
      try {
        const values = await getTabValues(sheetId, tab, "A1:Z50000");
        const rows = rowsToObjects(values);
        allRows = allRows.concat(rows.map((r) => ({ ...r, _tab: tab })));
        await new Promise((r) => setTimeout(r, 300));
      } catch (err) {
        logger.warn({ err, tab }, "Failed to read order tab");
      }
    }

    // Aggregate by month
    const monthlyMap = new Map<string, { value: number; qty: number; docs: Set<string>; customers: Set<string> }>();
    const groupMap = new Map<string, number>();
    const channelMap = new Map<string, number>();
    const plantMap = new Map<string, number>();

    for (const row of allRows) {
      const value = toNum(row["Taxable Value"]);
      const qty = toNum(row["Quantity"]);
      const rawMonth = row["Month"] || row["_tab"] || "";
      const month = normalizeMonth(rawMonth) ?? row["_tab"] ?? "";
      const group = row["GROUP"] || "Unknown";
      const state = row["STATE"] || "";
      const stateHead = row["STATE HEAD"] || "";
      const channel = deriveChannel(state, stateHead);
      const plant = row["Location.Name"] || "Unknown";
      const doc = row["Document No."] || "";
      const customer = row["Customer.Name"] || "";

      if (month) {
        if (!monthlyMap.has(month)) {
          monthlyMap.set(month, { value: 0, qty: 0, docs: new Set(), customers: new Set() });
        }
        const m = monthlyMap.get(month)!;
        m.value += value;
        m.qty += qty;
        if (doc) m.docs.add(doc);
        if (customer) m.customers.add(customer);
      }
      if (group) groupMap.set(group, (groupMap.get(group) ?? 0) + value);
      channelMap.set(channel, (channelMap.get(channel) ?? 0) + value);
      if (plant) plantMap.set(plant, (plantMap.get(plant) ?? 0) + value);
    }

    const monthly = FISCAL_MONTHS
      .filter((m) => monthlyMap.has(m))
      .map((m) => {
        const d = monthlyMap.get(m)!;
        return { month: m, value: d.value, qty: d.qty, docs: d.docs.size, customers: d.customers.size };
      });

    // Sum directly from all rows (avoids empty-monthly issue if month parsing fails)
    const ytdValue = allRows.reduce((s, r) => s + toNum(r["Taxable Value"]), 0);
    const ytdQty = allRows.reduce((s, r) => s + toNum(r["Quantity"]), 0);
    const ytdDocs = new Set(allRows.map((r) => r["Document No."]).filter(Boolean)).size;
    const ytdCustomers = new Set(allRows.map((r) => r["Customer.Name"]).filter(Boolean)).size;

    const byGroup = [...groupMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    const byChannel = [...channelMap.entries()].map(([name, value]) => ({ name, value }));
    const byPlant = [...plantMap.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10);

    const result = { fy, ytdValue, ytdQty, ytdDocs, ytdCustomers, monthly, byGroup, byChannel, byPlant };
    setCached(cacheKey, result);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "ops/orders failed");
    res.status(500).json({ error: "Failed to load order data" });
  }
});

// ─── GET /ops/orders/yoy ──────────────────────────────────────────────────────
router.get("/ops/orders/yoy", async (_req, res): Promise<void> => {
  const cacheKey = "ops:orders:yoy";
  const cached = getCached<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  const fyList = ["2023-24", "2024-25", "2025-26", "2026-27"];
  const result: Record<string, Record<string, number>> = {};

  for (const fy of fyList) {
    const sheetId = ORDER_SHEET_IDS[fy];
    if (!sheetId) continue;
    try {
      const tabs = await listTabs(sheetId);
      for (const tab of FISCAL_MONTHS.filter((m) => tabs.includes(m))) {
        try {
          const values = await getTabValues(sheetId, tab, "A1:Z20000");
          const rows = rowsToObjects(values);
          const value = rows.reduce((s, r) => s + toNum(r["Taxable Value"]), 0);
          const normTab = normalizeMonth(tab) ?? tab;
          if (!result[normTab]) result[normTab] = {};
          result[normTab][fy] = (result[normTab][fy] ?? 0) + value;
          await new Promise((r) => setTimeout(r, 300));
        } catch { /* skip failed tabs */ }
      }
    } catch (err) {
      logger.warn({ err, fy }, "YoY fetch failed for FY");
    }
  }

  const data = FISCAL_MONTHS.map((m) => ({ month: m, ...( result[m] ?? {}) }));
  setCached(cacheKey, data);
  res.json(data);
});

// ─── GET /ops/production ──────────────────────────────────────────────────────
router.get("/ops/production", async (_req, res): Promise<void> => {
  const cacheKey = "ops:production:all";
  const cached = getCached<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  const results: Array<{
    year: number; month: string; label: string;
    total: number; byCategory: Record<string, number>;
  }> = [];

  // Only fetch recent months to stay within rate limits
  const recentMonths = PTMT_MONTHS.slice(-8);

  for (const entry of recentMonths) {
    try {
      const tabs = await listTabs(entry.id);
      const reportTabs = tabs.filter((t) => /^REPORT\s+[1-7]$/i.test(t.trim()));
      const byCategory: Record<string, number> = {};
      let total = 0;

      for (const tab of reportTabs) {
        try {
          const values = await getTabValues(entry.id, tab, "A1:Z2000");
          // Detect header row (row containing "Item Code" or "REPORT")
          let headerRowIdx = 0;
          for (let i = 0; i < Math.min(values.length, 20); i++) {
            const rowStr = values[i].join(" ").toUpperCase();
            if (rowStr.includes("ITEM CODE") || rowStr.includes("ITEM  CODE")) {
              headerRowIdx = i;
              break;
            }
          }
          const ppColLetter = entry.pp_col.toUpperCase();
          const ppColIndex = ppColLetter.charCodeAt(0) - 65; // A=0, M=12, O=14, P=15

          let tabTotal = 0;
          for (let i = headerRowIdx + 1; i < values.length; i++) {
            const row = values[i];
            if (!row || row.length === 0) continue;
            const itemCode = row[1]; // col B
            if (!itemCode || !itemCode.trim()) continue;
            const val = toNum(row[ppColIndex] ?? "0");
            tabTotal += val;
          }

          const tabKey = tab.trim().toUpperCase().replace(/\s+/g, " ");
          const categoryName = REPORT_TAB_CATEGORIES[tabKey] ?? tab;
          byCategory[categoryName] = tabTotal;
          total += tabTotal;
          await new Promise((r) => setTimeout(r, 250));
        } catch (err) {
          logger.warn({ err, tab, id: entry.id }, "PTMT tab read failed");
        }
      }

      const fyStart = entry.month === "Jan" || entry.month === "Feb" || entry.month === "Mar"
        ? entry.year - 1 : entry.year;
      results.push({
        year: entry.year,
        month: entry.month,
        label: `${entry.month}-${String(entry.year).slice(2)}`,
        total,
        byCategory,
      });
    } catch (err) {
      logger.warn({ err, entry }, "PTMT sheet failed");
    }
  }

  setCached(cacheKey, results);
  res.json(results);
});

// ─── GET /ops/sales ───────────────────────────────────────────────────────────
router.get("/ops/sales", async (req, res): Promise<void> => {
  const fy = String(req.query.fy ?? "2024-25");
  const cacheKey = `ops:sales:${fy}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    // Read 3-year Sale Master for trend data
    const tabs = await listTabs(SALE_MASTER_3YR_ID);
    logger.info({ tabs: tabs.slice(0, 5) }, "Sale Master tabs sample");

    // Look for a tab matching the FY or a SALE tab
    const { startYear } = fyToYears(fy);
    const saleTab = tabs.find((t) =>
      t.toUpperCase().includes("SALE") ||
      t.includes(String(startYear)) ||
      t === "Sheet1"
    ) ?? tabs[0];

    if (!saleTab) {
      res.json({ fy, monthly: [], byProduct: [] });
      return;
    }

    const values = await getTabValues(SALE_MASTER_3YR_ID, saleTab, "A1:Z50000");
    const rows = rowsToObjects(values);

    // Aggregate by month (look for Date/Month column)
    const monthlyMap = new Map<string, number>();
    const productMap = new Map<string, number>();

    for (const row of rows) {
      const dateStr = row["Date"] || row["Invoice Date"] || row["date"] || "";
      const value = toNum(row["Taxable Value"] || row["Value"] || row["Amount"] || row["Net Amount"] || "0");
      const product = row["Item Name"] || row["Item.Name"] || row["Product"] || row["Group"] || "Other";

      if (dateStr) {
        // Try to parse month from date
        const dateObj = new Date(dateStr);
        if (!isNaN(dateObj.getTime())) {
          const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
          const monthKey = monthNames[dateObj.getMonth()];
          monthlyMap.set(monthKey, (monthlyMap.get(monthKey) ?? 0) + value);
        }
      }
      if (product) {
        productMap.set(product, (productMap.get(product) ?? 0) + value);
      }
    }

    const monthly = FISCAL_MONTHS
      .filter((m) => monthlyMap.has(m))
      .map((m) => ({ month: m, value: monthlyMap.get(m) ?? 0 }));

    const byProduct = [...productMap.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 15);

    const totalValue = monthly.reduce((s, r) => s + r.value, 0);

    const result = { fy, totalValue, monthly, byProduct };
    setCached(cacheKey, result);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "ops/sales failed");
    res.status(500).json({ error: "Failed to load sales data" });
  }
});

// ─── Order-group → segment mapping ───────────────────────────────────────────
// The order sheet "GROUP" column uses product-category names.
// PTMT products are always in group "PTMT".
// Plumbing products span several groups corresponding to manufactured plumbing lines.
const PTMT_ORDER_GROUPS   = new Set(["PTMT"]);
const PLUMBING_ORDER_GROUPS = new Set(["C P", "CPVC", "SWR", "UPVC", "AGRI", "GARDEN PIPE", "PPR", "HDPE PIPE"]);

function rowMatchesSegment(group: string, segment: string): boolean {
  if (segment === "Combined") return true;
  if (segment === "PTMT")     return PTMT_ORDER_GROUPS.has(group);
  if (segment === "Plumbing") return PLUMBING_ORDER_GROUPS.has(group);
  return true; // unknown segment: include everything
}

/** Returns IST-adjusted current month as YYYY-MM. */
function currentMonthIst(): string {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  const d = new Date(istMs);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

// ─── GET /ops/overview ────────────────────────────────────────────────────────
router.get("/ops/overview", async (req, res): Promise<void> => {
  const fy = String(req.query.fy ?? "2026-27");
  const segment = String(req.query.segment ?? "Combined");
  const cacheKey = `ops:overview:${fy}:${segment}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  // Quick aggregate: orders for the FY only — lightweight
  const sheetId = ORDER_SHEET_IDS[fy];
  let orderValue = 0;
  let orderQty = 0;
  // Track partial reads: if any monthly tab fails, the aggregate is incomplete
  // and MUST NOT be cached (a cached partial "Combined" can transiently be
  // smaller than "Plumbing", which is nonsensical downstream).
  let partialRead = false;

  if (sheetId) {
    try {
      const tabs = await listTabs(sheetId);
      const monthlyTabs = FISCAL_MONTHS.filter((m) => tabs.includes(m));
      for (const tab of monthlyTabs.slice(0, 6)) { // First 6 months for speed
        try {
          const values = await getTabValues(sheetId, tab, "A1:Z20000");
          const rows = rowsToObjects(values);
          for (const r of rows) {
            const group = String(r["GROUP"] ?? "").trim();
            if (!rowMatchesSegment(group, segment)) continue;
            orderValue += toNum(r["Taxable Value"]);
            orderQty   += toNum(r["Quantity"]);
          }
          await new Promise((r) => setTimeout(r, 200));
        } catch (err) {
          partialRead = true;
          logger.warn({ err, tab, segment }, "overview: monthly tab read failed — result will not be cached");
        }
      }
    } catch (err) {
      partialRead = true;
      logger.warn({ err }, "overview orders fetch failed");
    }
  }

  // salesValue: orders ARE dispatched sales; use the segment-filtered order value.
  const salesValue = orderValue;

  // productionPlan: latest saved plan run for the current month + this segment.
  // Falls back to 0 if no plan run has been saved yet.
  let productionPlan = 0;
  try {
    const normSegment = segment === "Plumbing" ? "Plumbing" : "PTMT";
    const month = currentMonthIst();
    const [latestRun] = await db
      .select({ id: planRunsTable.id })
      .from(planRunsTable)
      .where(and(eq(planRunsTable.month, month), eq(planRunsTable.segment, normSegment)))
      .orderBy(desc(planRunsTable.createdAt))
      .limit(1);
    if (latestRun) {
      const results = await db
        .select({ productionPlan: planRunResultsTable.productionPlan })
        .from(planRunResultsTable)
        .where(eq(planRunResultsTable.runId, latestRun.id));
      productionPlan = results.reduce((s, r) => s + Math.max(r.productionPlan, 0), 0);
    }
  } catch (err) {
    logger.warn({ err }, "overview productionPlan fetch failed");
  }

  const result = {
    fy,
    segment,
    orderValue,
    orderQty,
    salesValue,
    productionPlan,
    festivals: FESTIVAL_CONFIG,
  };
  if (!partialRead) setCached(cacheKey, result); // never cache a partial aggregate
  res.json(result);
});

// ─── GET /ops/config ──────────────────────────────────────────────────────────
router.get("/ops/config", (_req, res): void => {
  res.json({
    fyOptions: ["2023-24", "2024-25", "2025-26", "2026-27"],
    categories: Object.values(REPORT_TAB_CATEGORIES),
    festivals: FESTIVAL_CONFIG,
  });
});

// ─── Management View ──────────────────────────────────────────────────────────
// Source for E/F/G: CODE WISE SALE 25-26 (not the item-wise sheet which is FY24-25 only)
const MGMT_CATEGORY_ORDER = [
  "Cocks Standard","Cocks Premium","Faucets & Jetsprays & Shower",
  "Accessories","Cistern & Seat Cover","Cabinet","Ball Cock",
];
const FM_NAMES = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"];
const CAL_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

interface MgmtMeta {
  year: number; monthNum: number; N: number;
  currentFyStart: number; priorFyStart: number;
  currentFy: string; priorFy: string;
  priorFyMonthLabels: string[];
  fHeader: string; gHeader: string; eHeader: string;
  hHeader: string; iHeader: string;
  lastMonthLabel: string; lastMonthName: string;
}

function buildMgmtMeta(monthParam: string): MgmtMeta | null {
  if (!/^\d{4}-\d{2}$/.test(monthParam)) return null;
  const [yearStr, monStr] = monthParam.split("-");
  const year = parseInt(yearStr, 10);
  const monthNum = parseInt(monStr, 10);
  if (monthNum < 1 || monthNum > 12) return null;

  const currentFyStart = monthNum >= 4 ? year : year - 1;
  const priorFyStart = currentFyStart - 1;
  const N = ((monthNum - 4 + 12) % 12) + 1;
  const currentFy = `${currentFyStart}-${String(currentFyStart + 1).slice(2)}`;
  const priorFy  = `${priorFyStart}-${String(priorFyStart + 1).slice(2)}`;

  // Apr(priorFyStart)..Mar(priorFyStart+1) — fiscal index 0=Apr..8=Dec use priorFyStart, 9=Jan..11=Mar use priorFyStart+1
  const priorFyMonthLabels = FM_NAMES.map((name, i) => {
    const yr = i <= 8 ? priorFyStart : priorFyStart + 1;
    return `${name}-${String(yr).slice(2)}`;
  });

  const fLabels = priorFyMonthLabels.slice(0, N);
  const gLabels = priorFyMonthLabels.slice(N);

  const eHeader = `AVG SALE ${priorFy}`;
  const fHeader = N > 0
    ? `${N} MONTH SALE ${fLabels[0]} – ${fLabels[N - 1]}`
    : "—";
  const gHeader = gLabels.length > 0
    ? `${gLabels.length} MONTH SALE ${gLabels[0]} – ${gLabels[gLabels.length - 1]}`
    : "—";
  const hHeader = "LAST 3 MONTH AVG SALE";

  const lastMonthIdx0 = ((monthNum - 2 + 12) % 12); // 0=Jan..11=Dec
  const lastMonthName = CAL_NAMES[lastMonthIdx0];
  const lastMonthYear = monthNum === 1 ? year - 1 : year;
  const lastMonthLabel = `${lastMonthName}-${String(lastMonthYear).slice(2)}`;
  const iHeader = `LAST MONTH SALE (${lastMonthName})`;

  return {
    year, monthNum, N, currentFyStart, priorFyStart, currentFy, priorFy,
    priorFyMonthLabels, fHeader, gHeader, eHeader, hHeader, iHeader,
    lastMonthLabel, lastMonthName,
  };
}

interface ItemViewRow { itemCode: string; colour: string; E: number; F: number; G: number; H: number; I: number; J: number; }
interface CategoryView { name: string; items: ItemViewRow[]; }

function localAddDual(totals: DualTotals, code: unknown, colour: unknown, qty: number): void {
  const k = itemKey(code, colour);
  const ck = normalizeCode(code);
  totals.exact.set(k, (totals.exact.get(k) ?? 0) + qty);
  totals.byCode.set(ck, (totals.byCode.get(ck) ?? 0) + qty);
}

const mgmtSleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/**
 * Read CODE WISE SALE 25-26 to build per-code 12-month vector for the prior FY.
 *
 * Strategy (in order):
 *  1. Read the "CODE" tab (A2:D) — if col C contains month labels, the tab is
 *     a per-transaction/per-month ledger → group by (code, month) to get monthly vec.
 *  2. Otherwise treat col A=code, col B=annual total → codeAnnual map (→ E=total/12).
 *     Then read per-month tabs (named like "Apr-25", "May-25" …) for F/G vectors.
 *  3. If no monthly tabs found either, fall back: F = G = E = annual/12.
 *
 * All values are CODE-LEVEL (colour is ignored; all colours of the same code
 * share the same E/F/G as in the master Excel).
 */
async function fetchCodeWiseSaleMap(meta: MgmtMeta): Promise<{
  byCode: Map<string, number[]>; // code → [12] monthly values for prior FY
  codeAnnual: Map<string, number>; // code → annual total
}> {
  const empty = { byCode: new Map<string, number[]>(), codeAnnual: new Map<string, number>() };
  try {
    const tabs = await listTabs(SHEET_IDS.codeWiseSale2526);
    logger.info({ tabs }, "CODE WISE SALE 25-26 tabs");

    const byCode = new Map<string, number[]>();
    const codeAnnual = new Map<string, number>();

    // ── Step 1: Find and read CODE tab ────────────────────────────────────────
    const codeTab = tabs.find(t => t.toUpperCase() === "CODE")
      ?? tabs.find(t => /^code/i.test(t));

    if (codeTab) {
      const raw = await throttledGetTabValues(SHEET_IDS.codeWiseSale2526, codeTab, "A1:D200000");
      const startRow = raw.length > 0 && /code|item/i.test(String(raw[0]?.[0] ?? "")) ? 1 : 0;
      const rows = raw.slice(startRow);

      // Detect if col C is a month label (per-transaction ledger with month)
      const sampleC = rows.slice(0, 20).map(r => String(r?.[2] ?? "").trim().toLowerCase());
      const hasMonthCol = sampleC.some(c => /^(apr|may|jun|jul|aug|sep|oct|nov|dec|jan|feb|mar)/i.test(c));

      if (hasMonthCol) {
        // Per-row: A=code, B=qty, C=month label (e.g. "Apr-25")
        for (const row of rows) {
          if (!row?.[0]) continue;
          const code = normalizeCode(row[0]);
          if (!code) continue;
          const qty = toNum(row[1] ?? "0");
          const monthRaw = String(row[2] ?? "").trim();
          codeAnnual.set(code, (codeAnnual.get(code) ?? 0) + qty);

          const mIdx = meta.priorFyMonthLabels.findIndex(label => {
            const [mon, yr] = label.split("-");
            const n = monthRaw.toLowerCase().replace(/[\s'`-]/g, "");
            return n.includes(mon.toLowerCase()) && n.includes(yr.toLowerCase());
          });
          if (mIdx >= 0) {
            if (!byCode.has(code)) byCode.set(code, Array(12).fill(0));
            byCode.get(code)![mIdx] += qty;
          }
        }
        logger.info({ codes: byCode.size }, "CODE tab: monthly-ledger mode");
      } else {
        // Annual-total mode: A=code, B=annual qty
        for (const row of rows) {
          if (!row?.[0]) continue;
          const code = normalizeCode(row[0]);
          if (!code) continue;
          const qty = toNum(row[1] ?? "0");
          codeAnnual.set(code, (codeAnnual.get(code) ?? 0) + qty);
        }
        logger.info({ codes: codeAnnual.size }, "CODE tab: annual-total mode — will seek monthly tabs");
      }
    }

    // ── Step 2: Monthly breakdown — try named-month tabs first, then wide format ──
    const needMonthly = byCode.size === 0;
    if (needMonthly) {
      // 2a: Named per-month tabs (e.g. "Apr-25", "May-25"…)
      const monthTabMap = meta.priorFyMonthLabels.map((label, idx) => {
        const [mon, yr] = label.split("-");
        const tab = tabs.find(t => {
          const n = t.toLowerCase().replace(/[\s'`]/g, "");
          return n.includes(mon.toLowerCase()) && n.includes(yr.toLowerCase());
        }) ?? tabs.find(t => t.toLowerCase() === mon.toLowerCase());
        return { label, idx, tab };
      });
      logger.info({ found: monthTabMap.filter(m => m.tab).map(m => m.label) }, "CODE WISE monthly tabs");

      const tabCache = new Map<string, string[][]>();
      for (const m of monthTabMap) {
        if (!m.tab || tabCache.has(m.tab)) continue;
        await mgmtSleep(1100);
        try {
          const v = await getTabValues(SHEET_IDS.codeWiseSale2526, m.tab, "A1:C100000");
          tabCache.set(m.tab, v);
        } catch (err) { logger.warn({ err, tab: m.tab }, "monthly tab read failed"); }
      }

      for (const m of monthTabMap) {
        if (!m.tab) continue;
        const vals = tabCache.get(m.tab) ?? [];
        if (vals.length < 2) continue;
        const hdr = vals[0].map(h => String(h ?? "").trim().toLowerCase());
        const ci = hdr.findIndex(h => /item.?code|cat.?no|^code$/i.test(h));
        const qi = hdr.findIndex(h => /qty|sale|quantity/i.test(h));
        const codeCol = ci >= 0 ? ci : 0;
        const qtyCol = qi >= 0 ? qi : 1;
        const start = (ci >= 0 || qi >= 0) ? 1 : 0;
        for (let r = start; r < vals.length; r++) {
          const row = vals[r];
          if (!row?.[codeCol]) continue;
          const code = normalizeCode(row[codeCol]);
          if (!code) continue;
          const qty = toNum(row[qtyCol] ?? "0");
          if (!byCode.has(code)) byCode.set(code, Array(12).fill(0));
          byCode.get(code)![m.idx] += qty;
          if (!codeAnnual.has(code)) codeAnnual.set(code, 0);
          codeAnnual.set(code, codeAnnual.get(code)! + qty);
        }
      }

      // 2b: If still no monthly data, try remaining tabs — detect wide OR tall format
      if (byCode.size === 0) {
        const skipTabs = new Set([codeTab ?? "", "PLUMBING TOP ITEMS", "SINK"]);
        const wideCandidates = tabs.filter(t => !skipTabs.has(t));
        logger.info({ wideCandidates }, "CODE WISE: trying wide/tall-format monthly tabs");

        for (const wt of wideCandidates) {
          await mgmtSleep(1100);
          let vals: string[][] = [];
          try {
            // Read wide enough to capture Month col (col J = index 9), use A:N
            vals = await getTabValues(SHEET_IDS.codeWiseSale2526, wt, "A1:N200000");
          } catch (err) { logger.warn({ err, tab: wt }, "fallback tab read failed"); continue; }
          if (vals.length < 2) continue;

          const hdrs = vals[0].map(h => String(h ?? "").trim());
          logger.info({ tab: wt, hdrs: hdrs.slice(0, 14) }, "fallback tab headers");

          // ── Tall-format detection: has a dedicated "Month" column ────────────
          const monthColI = hdrs.findIndex(h => /^month$/i.test(h.trim()));
          if (monthColI >= 0) {
            const codeColI = (() => {
              const i = hdrs.findIndex(h => /old.?item.?code|item.?code|cat.?no|^code$/i.test(h));
              return i >= 0 ? i : 0;
            })();
            const qtyColI = (() => {
              const i = hdrs.findIndex(h => /^quantity$|^qty$/i.test(h));
              return i >= 0 ? i : 3;
            })();
            logger.info({ tab: wt, codeHdr: hdrs[codeColI], qtyHdr: hdrs[qtyColI], monthHdr: hdrs[monthColI] }, "CODE WISE: tall-format detected");

            // Sample month values to understand format
            const sampleMonths = vals.slice(1, 6).map(r => String(r?.[monthColI] ?? "").trim());
            logger.info({ sampleMonths }, "CODE WISE: sample month labels from Sheet1");

            for (let r = 1; r < vals.length; r++) {
              const row = vals[r];
              if (!row?.[codeColI]) continue;
              const code = normalizeCode(row[codeColI]);
              if (!code) continue;
              const qty = toNum(row[qtyColI] ?? "0");
              const monthRaw = String(row[monthColI] ?? "").trim();

              // Match against prior-FY month labels
              const mIdx = meta.priorFyMonthLabels.findIndex(label => {
                const [mon, yr] = label.split("-");
                const n = monthRaw.toLowerCase().replace(/[\s'`.\-]/g, "");
                const m = mon.toLowerCase();
                // "Apr-25" → "apr25"; also handle "April 25", "Apr25", "04/25" etc.
                return (n.includes(m) && n.includes(yr.toLowerCase()))
                  || (n.includes(m.slice(0, 3)) && n.includes(yr.toLowerCase()));
              });

              if (mIdx >= 0) {
                if (!byCode.has(code)) byCode.set(code, Array(12).fill(0));
                byCode.get(code)![mIdx] += qty;
              }
            }

            if (byCode.size > 0) {
              logger.info({ codes: byCode.size, tab: wt }, "CODE WISE: tall-format data loaded");
              break;
            }
            continue;
          }

          // ── Wide-format detection: columns named by month ────────────────────
          const colMonthIdx = hdrs.map(h => {
            const hn = h.toLowerCase().replace(/[\s'`]/g, "");
            return meta.priorFyMonthLabels.findIndex(label => {
              const [mon, yr] = label.split("-");
              return hn.includes(mon.toLowerCase()) && hn.includes(yr.toLowerCase());
            });
          });
          const monthCols = colMonthIdx.map((mIdx, col) => ({ col, mIdx })).filter(x => x.mIdx >= 0);
          if (monthCols.length === 0) continue;

          const codeHdrIdx = (() => {
            const i = hdrs.findIndex(h => /item.?code|cat.?no|^code$/i.test(h));
            return i >= 0 ? i : 0;
          })();

          for (let r = 1; r < vals.length; r++) {
            const row = vals[r];
            if (!row?.[codeHdrIdx]) continue;
            const code = normalizeCode(row[codeHdrIdx]);
            if (!code) continue;
            if (!byCode.has(code)) byCode.set(code, Array(12).fill(0));
            for (const { col, mIdx } of monthCols) {
              byCode.get(code)![mIdx] += toNum(row[col] ?? "0");
            }
          }
          if (byCode.size > 0) {
            logger.info({ codes: byCode.size, tab: wt }, "CODE WISE: wide-format data loaded");
            break;
          }
        }
      }
    }

    return { byCode, codeAnnual };
  } catch (err) {
    logger.warn({ err }, "fetchCodeWiseSaleMap failed");
    return empty;
  }
}

/** Current (in-progress) month's line-level sales from SALE SHEET 26-27. */
async function fetchCurrentMonthDualTotals(meta: MgmtMeta): Promise<DualTotals> {
  const empty: DualTotals = { exact: new Map(), byCode: new Map() };
  try {
    const tabs = await listTabs(SHEET_IDS.saleSheet2627);
    const curMonName = CAL_NAMES[meta.monthNum - 1]; // e.g. "Jul"
    logger.info({ tabs, curMon: curMonName }, "SALE SHEET 26-27 tabs (current month)");
    const matchTab = tabs.find(t => {
      const n = t.toLowerCase().replace(/[\s'`]/g, "");
      return n.includes(curMonName.toLowerCase());
    });
    if (!matchTab) { logger.warn({ tabs, curMon: curMonName }, "SALE SHEET 26-27: no tab for current month"); return empty; }
    logger.info({ matchTab }, "SALE SHEET 26-27 current month tab matched");

    const raw = await throttledGetTabValues(SHEET_IDS.saleSheet2627, matchTab, "A1:L300000");
    if (raw.length < 2) return empty;

    const hdr = raw[0].map(h => String(h ?? "").trim());
    const codeCol = (() => { const i = hdr.findIndex(h => /item.?code/i.test(h)); return i >= 0 ? i : 7; })();
    const colourCol = (() => { const i = hdr.findIndex(h => /colou?r/i.test(h)); return i >= 0 ? i : 8; })();
    const qtyCol = (() => { const i = hdr.findIndex(h => /^qty$|^quantity$|^sale.?qty/i.test(h)); return i >= 0 ? i : 9; })();

    const totals: DualTotals = { exact: new Map(), byCode: new Map() };
    for (let r = 1; r < raw.length; r++) {
      const row = raw[r];
      const code = row[codeCol]; const colour = row[colourCol]; const qtyRaw = row[qtyCol];
      if (!code || qtyRaw == null || qtyRaw === "") continue;
      const toNum = (v: unknown) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return isNaN(n) ? 0 : n; };
      localAddDual(totals, code, colour, toNum(qtyRaw));
    }
    logger.info({ codes: totals.byCode.size }, "SALE SHEET 26-27 current month loaded");
    return totals;
  } catch (err) {
    logger.warn({ err }, "fetchCurrentMonthDualTotals failed");
    return empty;
  }
}

/** Last completed month's line-level sales from SALE SHEET 26-27. */
async function fetchLastMonthDualTotals(meta: MgmtMeta): Promise<DualTotals> {
  const empty: DualTotals = { exact: new Map(), byCode: new Map() };
  try {
    const tabs = await listTabs(SHEET_IDS.saleSheet2627);
    const [mon, yr] = meta.lastMonthLabel.split("-");
    logger.info({ tabs, lastMonth: meta.lastMonthLabel }, "SALE SHEET 26-27 tabs");
    const matchTab = tabs.find(t => {
      const n = t.toLowerCase().replace(/[\s'`]/g, "");
      return n.includes(mon.toLowerCase()) && n.includes(yr.toLowerCase());
    }) ?? tabs.find(t => t.toLowerCase().includes(mon.toLowerCase()));
    if (!matchTab) { logger.warn({ tabs, lastMonth: meta.lastMonthLabel }, "SALE SHEET 26-27: no tab for last month"); return empty; }
    logger.info({ matchTab }, "SALE SHEET 26-27 matched tab");

    // Read A1:L to auto-detect columns from header
    const raw = await throttledGetTabValues(SHEET_IDS.saleSheet2627, matchTab, "A1:L300000");
    logger.info({ rows: raw.length, sampleHdr: raw[0]?.slice(0,12) }, "SALE SHEET 26-27 raw header");
    if (raw.length < 2) { logger.warn({ matchTab }, "SALE SHEET 26-27: empty tab"); return empty; }

    const hdr = raw[0].map(h => String(h ?? "").trim());
    // Prefer explicit header detection; fall back to positional cols D/F/H (offset 3/5/7)
    const codeCol = (() => { const i = hdr.findIndex(h => /item.?code|cat.?no|old.?item|^code$/i.test(h)); return i >= 0 ? i : 3; })();
    const colourCol = (() => { const i = hdr.findIndex(h => /colou?r/i.test(h)); return i >= 0 ? i : 5; })();
    const qtyCol = (() => { const i = hdr.findIndex(h => /^qty$|^quantity$|^sale.?qty/i.test(h)); return i >= 0 ? i : 7; })();
    logger.info({ codeHdr: hdr[codeCol], colourHdr: hdr[colourCol], qtyHdr: hdr[qtyCol] }, "SALE SHEET 26-27 col mapping");

    const totals: DualTotals = { exact: new Map(), byCode: new Map() };
    for (let i = 1; i < raw.length; i++) {
      const row = raw[i];
      if (!row) continue;
      const code = String(row[codeCol] ?? "").trim();
      const colour = String(row[colourCol] ?? "").trim();
      const qtyRaw = row[qtyCol];
      if (!code || !qtyRaw || String(qtyRaw).trim() === "") continue;
      localAddDual(totals, code, colour, toNum(qtyRaw));
    }
    logger.info({ codes: totals.byCode.size }, "SALE SHEET 26-27 loaded");
    return totals;
  } catch (err) {
    logger.warn({ err }, "fetchLastMonthDualTotals failed");
    return empty;
  }
}

/**
 * Assemble per-category management view rows.
 * E/F/G/H/I are CODE-LEVEL — all colour variants of a code share the same values,
 * matching the master Excel where these columns are colour-blind aggregates.
 */
// In-flight deduplication: if two requests arrive before the first finishes,
// they share one Promise instead of firing double the Sheets API calls.
const _mgmtInFlight = new Map<string, Promise<CategoryView[]>>();

async function computeMgmtCategories(meta: MgmtMeta, monthParam: string): Promise<CategoryView[]> {
  const existing = _mgmtInFlight.get(monthParam);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const [masterItems, codeWise, h3moRaw, iLast, jCur] = await Promise.all([
        db.select({ category: itemMasterTable.category, itemCode: itemMasterTable.itemCode, colour: itemMasterTable.colour })
          .from(itemMasterTable),
        fetchCodeWiseSaleMap(meta),
        fetchAvg3MoSaleTotals(monthParam),
        fetchLastMonthDualTotals(meta),
        fetchCurrentMonthDualTotals(meta),
      ]);

      return MGMT_CATEGORY_ORDER.map(catName => ({
        name: catName,
        items: masterItems
          .filter(item => item.category === catName)
          .map(item => {
            const ck = normalizeCode(item.itemCode);

            // ── E / F / G — code-level, from CODE WISE SALE 25-26 ────────────────
            const m12: number[] = codeWise.byCode.get(ck) ?? Array(12).fill(0);
            const annualFromCode = codeWise.codeAnnual.get(ck) ?? m12.reduce((s, v) => s + v, 0);

            const E = annualFromCode / 12;

            // Use monthly vector for F/G if we have real data; else fall back to E
            const hasMonthly = m12.some(v => v > 0);
            const F = hasMonthly && meta.N > 0
              ? m12.slice(0, meta.N).reduce((s, v) => s + v, 0) / meta.N
              : E;
            const G = hasMonthly && meta.N < 12
              ? m12.slice(meta.N).reduce((s, v) => s + v, 0) / (12 - meta.N)
              : (meta.N < 12 ? E : 0);

            // ── H / I / J — code-level, aggregate all colours ────────────────────
            // fetchAvg3MoSaleTotals returns 3-month SUM → ÷3 for monthly avg
            const H = (h3moRaw.byCode.get(ck) ?? 0) / 3;
            const I = iLast.byCode.get(ck) ?? 0;
            const J = jCur.byCode.get(ck) ?? 0;

            return { itemCode: item.itemCode, colour: item.colour, E, F, G, H, I, J };
          }),
      }));
    } finally {
      _mgmtInFlight.delete(monthParam);
    }
  })();

  _mgmtInFlight.set(monthParam, promise);
  return promise;
}

// GET /ops/management-view
router.get("/ops/management-view", async (req, res): Promise<void> => {
  const monthParam = String(req.query.month ?? "");
  const meta = buildMgmtMeta(monthParam);
  if (!meta) { res.status(400).json({ error: "month must be YYYY-MM e.g. 2026-07" }); return; }

  const cacheKey = `ops:mgmt:${monthParam}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  try {
    const categories = await computeMgmtCategories(meta, monthParam);
    const result = {
      month: monthParam,
      meta: {
        currentFy: meta.currentFy, priorFy: meta.priorFy, N: meta.N,
        nSplit: `${meta.N}/${12 - meta.N}`,
        headers: { E: meta.eHeader, F: meta.fHeader, G: meta.gHeader, H: meta.hHeader, I: meta.iHeader },
        lastMonthName: meta.lastMonthName,
      },
      categories,
    };
    setCached(cacheKey, result);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "management-view failed");
    res.status(500).json({ error: "Failed to compute management view" });
  }
});

// GET /ops/management-summary — category-level aggregates (deduped by code) for Overview charts
router.get("/ops/management-summary", async (req, res): Promise<void> => {
  const monthParam = String(req.query.month ?? "");
  const meta = buildMgmtMeta(monthParam);
  if (!meta) { res.status(400).json({ error: "month must be YYYY-MM" }); return; }

  const summaryKey = `ops:mgmt-summary:${monthParam}`;
  const cached = getCached<unknown>(summaryKey);
  if (cached) { res.json(cached); return; }

  try {
    // Reuse the full management-view cache if already warm, else compute it
    const mgmtKey = `ops:mgmt:${monthParam}`;
    let mgmtData = getCached<{ meta: unknown; categories: CategoryView[] }>(mgmtKey);
    if (!mgmtData) {
      const categories = await computeMgmtCategories(meta, monthParam);
      mgmtData = {
        meta: {
          currentFy: meta.currentFy, priorFy: meta.priorFy, N: meta.N,
          nSplit: `${meta.N}/${12 - meta.N}`,
          headers: { E: meta.eHeader, F: meta.fHeader, G: meta.gHeader, H: meta.hHeader, I: meta.iHeader },
          lastMonthName: meta.lastMonthName,
        },
        categories,
      };
      setCached(mgmtKey, { month: monthParam, ...mgmtData });
    }

    const summary = mgmtData.categories.map(cat => {
      const seenCodes = new Set<string>();
      let totalE = 0, totalF = 0, totalG = 0, totalH = 0, totalI = 0, totalJ = 0, codes = 0;
      for (const item of cat.items) {
        const ck = normalizeCode(item.itemCode);
        if (seenCodes.has(ck)) continue;
        seenCodes.add(ck);
        totalE += item.E; totalF += item.F; totalG += item.G;
        totalH += item.H; totalI += item.I; totalJ += item.J;
        codes++;
      }
      return {
        name: cat.name, codes,
        totalE: Math.round(totalE), totalF: Math.round(totalF), totalG: Math.round(totalG),
        totalH: Math.round(totalH), totalI: Math.round(totalI), totalJ: Math.round(totalJ),
        momentumHE: totalE > 0 ? parseFloat((totalH / totalE).toFixed(3)) : 0,
      };
    });

    const result = { meta: mgmtData.meta, summary };
    setCached(summaryKey, result);
    res.json(result);
  } catch (err) {
    logger.warn({ err }, "management-summary failed");
    res.status(500).json({ error: "Failed to compute management summary" });
  }
});

// GET /ops/management-view/excel
router.get("/ops/management-view/excel", async (req, res): Promise<void> => {
  const monthParam = String(req.query.month ?? "");
  const meta = buildMgmtMeta(monthParam);
  if (!meta) { res.status(400).json({ error: "month must be YYYY-MM" }); return; }

  try {
    const cacheKey = `ops:mgmt:${monthParam}`;
    let categories: CategoryView[];
    const cached = getCached<{ categories: CategoryView[] }>(cacheKey);
    categories = cached ? cached.categories : await computeMgmtCategories(meta, monthParam);

    const ExcelJSrt = require("exceljs") as typeof ExcelJSType;
    const wb = new ExcelJSrt.Workbook();
    wb.creator = "Prayag India Ops Dashboard";
    wb.created = new Date();

    for (const cat of categories) {
      const ws = wb.addWorksheet(cat.name.slice(0, 31));
      // Stamp row
      ws.addRow([`Management Report · ${monthParam} | FY ${meta.currentFy} | Prior FY ${meta.priorFy} | N=${meta.N} (${meta.N}/${12 - meta.N} split)`]);
      ws.getRow(1).font = { bold: true, size: 11 };
      ws.addRow([]);
      // Headers
      const hr = ws.addRow(["Item Code","Colour", meta.eHeader, meta.fHeader, meta.gHeader, meta.hHeader, meta.iHeader]);
      hr.font = { bold: true };
      hr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE0B2" } };
      hr.alignment = { wrapText: true };
      // Data
      for (const item of cat.items) {
        ws.addRow([item.itemCode, item.colour,
          Math.round(item.E), Math.round(item.F), Math.round(item.G),
          Math.round(item.H), Math.round(item.I)]);
      }
      ws.getColumn(1).width = 18;
      ws.getColumn(2).width = 14;
      for (let c = 3; c <= 7; c++) ws.getColumn(c).width = 24;
    }

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="mgmt-view-${monthParam}.xlsx"`);
    await wb.xlsx.write(res);
  } catch (err) {
    logger.error({ err }, "management-view/excel failed");
    res.status(500).json({ error: "Failed to generate Excel" });
  }
});

export default router;
