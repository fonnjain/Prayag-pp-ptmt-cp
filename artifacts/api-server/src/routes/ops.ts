import { Router, type IRouter } from "express";
import { getTabValues, listTabs } from "../lib/sheets";
import { logger } from "../lib/logger";

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

// ─── GET /ops/overview ────────────────────────────────────────────────────────
router.get("/ops/overview", async (req, res): Promise<void> => {
  const fy = String(req.query.fy ?? "2026-27");
  const cacheKey = `ops:overview:${fy}`;
  const cached = getCached<unknown>(cacheKey);
  if (cached) { res.json(cached); return; }

  // Quick aggregate: orders for the FY only — lightweight
  const sheetId = ORDER_SHEET_IDS[fy];
  let orderValue = 0;
  let orderQty = 0;

  if (sheetId) {
    try {
      const tabs = await listTabs(sheetId);
      const monthlyTabs = FISCAL_MONTHS.filter((m) => tabs.includes(m));
      for (const tab of monthlyTabs.slice(0, 6)) { // First 6 months for speed
        try {
          const values = await getTabValues(sheetId, tab, "A1:Z20000");
          const rows = rowsToObjects(values);
          orderValue += rows.reduce((s, r) => s + toNum(r["Taxable Value"]), 0);
          orderQty += rows.reduce((s, r) => s + toNum(r["Quantity"]), 0);
          await new Promise((r) => setTimeout(r, 200));
        } catch { /* skip */ }
      }
    } catch (err) {
      logger.warn({ err }, "overview orders fetch failed");
    }
  }

  const result = {
    fy,
    orderValue,
    orderQty,
    salesValue: 0, // placeholder — full sales is expensive
    productionPlan: 0, // placeholder
    festivals: FESTIVAL_CONFIG,
  };
  setCached(cacheKey, result);
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

export default router;
