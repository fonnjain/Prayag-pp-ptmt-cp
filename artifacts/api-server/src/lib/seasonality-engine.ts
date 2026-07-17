import { db, itemMasterTable } from "@workspace/db";
import { getTabValues, listTabs } from "./sheets";
import { logger } from "./logger";

// ─── Constants ───────────────────────────────────────────────────────────────

export const FISCAL_MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"] as const;
export type FiscalMonth = typeof FISCAL_MONTHS[number];

/** Some sheets use full month names (e.g. "July") instead of 3-letter abbreviations */
const MONTH_ALIASES: Record<string, FiscalMonth> = {
  April: "Apr", May: "May", June: "Jun", July: "Jul",
  August: "Aug", September: "Sep", October: "Oct",
  November: "Nov", December: "Dec", January: "Jan",
  February: "Feb", March: "Mar",
};

/** Returns the FiscalMonth key if `tab` is a recognised month tab (exact or aliased), else null */
function normTab(tab: string): FiscalMonth | null {
  if ((FISCAL_MONTHS as readonly string[]).includes(tab)) return tab as FiscalMonth;
  return MONTH_ALIASES[tab] ?? null;
}

/** Build a Map<FiscalMonth → actual tab name> from a raw sheet tab list */
function buildTabMap(tabs: string[]): Map<FiscalMonth, string> {
  const m = new Map<FiscalMonth, string>();
  for (const tab of tabs) {
    const norm = normTab(tab);
    if (norm && !m.has(norm)) m.set(norm, tab);
  }
  return m;
}

/** Engine inputs: FY2024-25 + FY2025-26 only — FY2023-24 excluded (old ERP layout); FY2026-27 excluded (part-year) */
const ENGINE_ORDER_SHEETS: Record<string, string> = {
  "2024-25": "1cT6lWRPJ3oSeYhab-cqeVjJidGitFQsr0DOq-vNn6cI",
  "2025-26": "1Xzq-gmB6K7iuMcE6gb-O7OpvGgSDU33DzEVyK60LK6E",
};

/** FY2026-27 order sheet for drift monitoring only */
export const CURRENT_FY_ORDER_SHEET = "1HFBAtvbAskejVkjuO8zHoEsE-pBAFij2ERMKFEvt64A";
export const CURRENT_FY = "2026-27";

export const Z_VALUES = { 90: 1.28, 95: 1.65, 98: 2.05 } as const;
export type ServiceLevel = keyof typeof Z_VALUES;

/** Avg monthly units below this → "thin" data quality (PTMT) */
const THIN_THRESHOLD = 100;

/** Avg monthly units below this → "thin" data quality (Plumbing) */
export const PLUMBING_THIN_THRESHOLD = 3000;

/** All 12 Plumbing categories: material × type */
export const ALL_PLUMBING_CATEGORIES = [
  "CPVC Pipe", "CPVC Fitting", "CPVC Solvent",
  "UPVC Pipe", "UPVC Fitting", "UPVC Solvent",
  "SWR Pipe",  "SWR Fitting",  "SWR Solvent",
  "AGRI Pipe", "AGRI Fitting", "AGRI Solvent",
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface SeasonalityCategoryResult {
  category: string;
  dataQuality: "ok" | "insufficient" | "thin";
  avgMonth: number | null;
  cv: number | null;
  volatilityClass: "Low" | "Medium" | "High" | null;
  suggestedMultiplier: number | null;
  seasonalIndices: number[] | null;
  peakMonth: string | null;
  peakIndex: number | null;
  yoy: number | null;
  signal: "Growing" | "Stable" | "Declining" | null;
  unmappedQty: number;
  totalOrderQty: number;
  fy2425monthly: number[];
  fy2526monthly: number[];
  zScore: number;
}

export interface SeasonalityEngineOutput {
  categories: SeasonalityCategoryResult[];
  segmentBenchmark: Omit<SeasonalityCategoryResult, "category"> & { category: string };
  totalUnmappedQty: number;
  totalOrderQty: number;
  computedAt: Date;
  zScore: number;
}

// ─── Reliability flag ─────────────────────────────────────────────────────────

/**
 * Compute the reliability flag for a Plumbing category result.
 * Priority: insufficient > unreliable (CV or YoY) > thin.
 * Returns null for clean categories that need no special treatment.
 */
export function computeReliabilityFlag(cat: SeasonalityCategoryResult): string | null {
  if (cat.dataQuality === "insufficient") return "insufficient data — override required";
  if (cat.cv !== null && cat.cv > 0.40) return "unreliable — structural growth/launch, override recommended";
  if (cat.yoy !== null && Math.abs(cat.yoy) > 0.60) return "unreliable — structural growth/launch, override recommended";
  if (cat.dataQuality === "thin") return "thin data — review";
  return null;
}

// ─── Category mapping ─────────────────────────────────────────────────────────

/** Map item_master codes to categories */
async function buildCodeToCategoryMap(): Promise<Map<string, string>> {
  const rows = await db.select({ itemCode: itemMasterTable.itemCode, category: itemMasterTable.category }).from(itemMasterTable);
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.itemCode.trim().toUpperCase(), r.category);
  return map;
}

/**
 * Classify a Plumbing item as Pipe / Fitting / Solvent from the combined
 * GROUP + item-name string. Called only after the material (CPVC/UPVC/SWR/AGRI)
 * has been identified from GROUP.
 *
 * The GROUP field in Plumbing ERP exports only carries the material name;
 * the type (Pipe / Fitting / Solvent) must be inferred from the item description.
 */
function classifyPlumbingType(combined: string): "Solvent" | "Fitting" | "Pipe" {
  // Solvent first — most distinct keyword set
  if (
    combined.includes("SOLVENT") || combined.includes("CEMENT") ||
    combined.includes("ADHESIVE") || combined.includes("PRIMER")
  ) return "Solvent";

  // Fitting — explicit fitting keywords in name
  if (
    combined.includes("FITTING") || combined.includes(" FTG") ||
    combined.includes("TEE") || combined.includes("ELBOW") ||
    combined.includes("BEND") || combined.includes("COUPLER") ||
    combined.includes("REDUCER") || combined.includes("SOCKET") ||
    combined.includes("UNION") || combined.includes("CROSS") ||
    combined.includes(" CAP") || combined.includes("END CAP") ||
    combined.includes("PLUG") || combined.includes("MTA") ||
    combined.includes("FTA") || combined.includes("ADAPTOR") ||
    combined.includes("ADAPTER") || combined.includes("CLAMP") ||
    combined.includes("CLIP") || combined.includes("SADDLE") ||
    combined.includes("BRASS") || combined.includes("VALVE") ||
    combined.includes("BUSH") || combined.includes("NIPPLE")
  ) return "Fitting";

  // Default: Pipe (also matches explicit "PIPE" keyword)
  return "Pipe";
}

/**
 * Map GROUP + optional item name to a category.
 * For Plumbing: GROUP gives the material, item name gives the type.
 * For PTMT: GROUP alone is sufficient.
 */
function mapGroupToCategory(group: string, itemName: string = ""): string | null {
  if (!group) return null;
  const g = group.toUpperCase().replace(/[^A-Z&/ ]/g, " ").replace(/\s+/g, " ").trim();
  const combined = `${g} ${itemName.toUpperCase()}`;

  // ── Plumbing segment (MATERIAL × TYPE) ────────────────────────────────────
  if (g.includes("CPVC")) { const t = classifyPlumbingType(combined); return `CPVC ${t}`; }
  if (g.includes("UPVC")) { const t = classifyPlumbingType(combined); return `UPVC ${t}`; }
  if (g.includes("SWR"))  { const t = classifyPlumbingType(combined); return `SWR ${t}`;  }
  if (g.includes("AGRI") || g.includes("AGRICULTURE")) {
    const t = classifyPlumbingType(combined); return `AGRI ${t}`;
  }

  // ── PTMT segment ───────────────────────────────────────────────────────────
  if (g.includes("BALL") && (g.includes("COCK") || g.includes("COCKE") || g.length < 15)) return "Ball Cock";
  if (g.includes("CABINET")) return "Cabinet";
  if (g.includes("CISTERN") || (g.includes("SEAT") && (g.includes("COVER") || g.includes("CVR")))) return "Cistern & Seat Cover";
  if (g.includes("FAUCET") || g.includes("JETSPRAY") || g.includes("JET SPRAY") || g.includes("SHOWER")) return "Faucets & Jetsprays & Shower";
  if (g.includes("PREMIUM")) return "Cocks Premium";
  if (g.includes("ACCESSORI")) return "Accessorise";
  if (g.includes("STANDARD") || (g.includes("COCK") && !g.includes("BALL"))) return "Cocks Standard";
  return null;
}

// ─── Diagnostic state (first-row sampling for column discovery) ───────────────
let _sampledPlumbingRow = false;

/**
 * Attempt to map an order row to a category:
 * 1. Try item_code lookup in item_master (PTMT items)
 * 2. Fall back to GROUP + item-name keyword match (Plumbing items)
 *
 * Plumbing order sheet column variants tried for the item name:
 *   "Name", "Item Name", "Stock Item Name", "Particulars",
 *   "Description", "Item.Name", "Ledger.Name", "Item Description"
 */
function mapRowToCategory(
  row: Record<string, string>,
  codeMap: Map<string, string>,
): string | null {
  const itemCode = (
    row["Item Code"] || row["ITEM CODE"] || row["Code"] || row["CODE"] ||
    row["Item.Code"] || row["Description.Code"] || ""
  ).trim().toUpperCase();

  if (itemCode) {
    const fromMaster = codeMap.get(itemCode);
    if (fromMaster) return fromMaster;
  }

  const group = (row["GROUP"] || row["Group"] || row["group"] || "").toUpperCase();
  const isPlumbing = group.includes("CPVC") || group.includes("UPVC") ||
                     group.includes("SWR") || group.includes("AGRI");

  // For Plumbing rows, extract item name for Pipe/Fitting/Solvent detection
  const itemName = isPlumbing
    ? (row["Name"] || row["Item Name"] || row["Stock Item Name"] || row["Particulars"] ||
       row["Description"] || row["Item.Name"] || row["Ledger.Name"] || row["ITEM NAME"] ||
       row["Item Description"] || row["Grp.Name"] || "")
    : "";

  // Log first Plumbing row keys for diagnostics (once per engine run)
  if (isPlumbing && !_sampledPlumbingRow) {
    _sampledPlumbingRow = true;
    const keys = Object.keys(row).slice(0, 20);
    const nameSample = itemName.slice(0, 60);
    logger.info({ keys, groupVal: group, itemNameVal: nameSample }, "plumbing-seasonality: first row column sample");
  }

  return mapGroupToCategory(group, itemName);
}

// ─── Sheet helpers ───────────────────────────────────────────────────────────

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

// ─── Algorithm ────────────────────────────────────────────────────────────────

function runAlgorithm(
  fy2425: number[],
  fy2526: number[],
  z: number,
  category: string,
  thinThreshold: number = THIN_THRESHOLD,
): Omit<SeasonalityCategoryResult, "category" | "unmappedQty" | "totalOrderQty" | "zScore" | "fy2425monthly" | "fy2526monthly"> {
  void category; // used for logging only if needed
  const annual2425 = fy2425.reduce((s, v) => s + v, 0);
  const annual2526 = fy2526.reduce((s, v) => s + v, 0);

  if (annual2425 === 0 && annual2526 === 0) {
    return { dataQuality: "insufficient", avgMonth: null, cv: null, volatilityClass: null, suggestedMultiplier: null, seasonalIndices: null, peakMonth: null, peakIndex: null, yoy: null, signal: null };
  }

  // Step 1 — Recency-weighted monthly baseline (recent year counted twice)
  const weighted = fy2425.map((v, i) => (v + 2 * fy2526[i]) / 3);

  // Step 2 — Seasonal index
  const avgMonth = weighted.reduce((s, v) => s + v, 0) / 12;
  if (avgMonth === 0) {
    return { dataQuality: "insufficient", avgMonth: null, cv: null, volatilityClass: null, suggestedMultiplier: null, seasonalIndices: null, peakMonth: null, peakIndex: null, yoy: null, signal: null };
  }
  const seasonalIndices = weighted.map((w) => w / avgMonth);

  // Step 3 — Deseasonalise, measure CV on up to 24 observations
  const deseasonalised: number[] = [];
  for (let i = 0; i < 12; i++) {
    const si = seasonalIndices[i];
    if (si > 0.01) {
      if (fy2425[i] > 0) deseasonalised.push(fy2425[i] / si);
      if (fy2526[i] > 0) deseasonalised.push(fy2526[i] / si);
    }
  }
  if (deseasonalised.length < 4) {
    return { dataQuality: "insufficient", avgMonth: Math.round(avgMonth), cv: null, volatilityClass: null, suggestedMultiplier: null, seasonalIndices: seasonalIndices.map((v) => round2(v)), peakMonth: null, peakIndex: null, yoy: null, signal: null };
  }

  const mean = deseasonalised.reduce((s, v) => s + v, 0) / deseasonalised.length;
  const variance = deseasonalised.reduce((s, v) => s + (v - mean) ** 2, 0) / deseasonalised.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;

  const volatilityClass: "Low" | "Medium" | "High" = cv < 0.15 ? "Low" : cv < 0.30 ? "Medium" : "High";

  // Step 4 — Suggested multiplier
  const suggestedMultiplier = round2(1 + z * cv);

  // Step 5 — YoY
  const yoy = annual2425 > 0 ? (annual2526 - annual2425) / annual2425 : null;
  const signal: "Growing" | "Stable" | "Declining" | null =
    yoy === null ? null : yoy > 0.08 ? "Growing" : yoy < -0.08 ? "Declining" : "Stable";

  // Peak month
  const peakIdx = seasonalIndices.reduce((best, v, i) => (v > seasonalIndices[best] ? i : best), 0);
  const peakMonth = FISCAL_MONTHS[peakIdx];
  const peakIndex = round2(seasonalIndices[peakIdx]);

  const dataQuality: "ok" | "thin" = avgMonth < thinThreshold ? "thin" : "ok";

  return {
    dataQuality,
    avgMonth: Math.round(avgMonth),
    cv: round2(cv),
    volatilityClass,
    suggestedMultiplier,
    seasonalIndices: seasonalIndices.map((v) => round2(v)),
    peakMonth,
    peakIndex,
    yoy: yoy !== null ? round2(yoy) : null,
    signal,
  };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

// ─── Shared sheet reader ──────────────────────────────────────────────────────

/**
 * Reads all tabs from both FY order sheets and accumulates monthly totals
 * per category. Only categories in `categorySet` are counted; everything
 * else is tallied as unmapped.
 */
async function readOrderSheets(
  categorySet: Set<string>,
  codeMap: Map<string, string>,
  logPrefix: string,
): Promise<{
  monthly2425: Record<string, number[]>;
  monthly2526: Record<string, number[]>;
  totalMonthly2425: number[];
  totalMonthly2526: number[];
  totalOrderQty: number;
  unmappedQty: number;
  perCategoryTotal: Record<string, number>;
}> {
  const categories = [...categorySet];
  const monthly2425: Record<string, number[]> = {};
  const monthly2526: Record<string, number[]> = {};
  for (const cat of categories) {
    monthly2425[cat] = Array(12).fill(0);
    monthly2526[cat] = Array(12).fill(0);
  }

  let totalOrderQty = 0;
  let unmappedQty = 0;
  const perCategoryTotal: Record<string, number> = Object.fromEntries(categories.map((c) => [c, 0]));
  const totalMonthly2425 = Array(12).fill(0);
  const totalMonthly2526 = Array(12).fill(0);

  for (const fy of ["2024-25", "2025-26"] as const) {
    const sheetId = ENGINE_ORDER_SHEETS[fy];
    let tabs: string[];
    try {
      tabs = await listTabs(sheetId);
    } catch (err) {
      logger.warn({ err, fy }, `${logPrefix}: could not list tabs for FY`);
      continue;
    }

    const tabMap = buildTabMap(tabs);
    const monthlyTabs = FISCAL_MONTHS.filter((m) => tabMap.has(m));
    logger.info({ fy, monthlyTabs: monthlyTabs.length }, `${logPrefix}: reading order tabs`);

    for (const tab of monthlyTabs) {
      const mIdx = FISCAL_MONTHS.indexOf(tab as FiscalMonth);
      if (mIdx === -1) continue;
      const actualTab = tabMap.get(tab) ?? tab;

      try {
        const values = await getTabValues(sheetId, actualTab, "A1:Z50000");
        const rows = rowsToObjects(values);

        for (const row of rows) {
          const qty = toNum(row["Quantity"]);
          if (qty <= 0) continue;

          const cat = mapRowToCategory(row, codeMap);
          if (!cat || !categorySet.has(cat)) {
            // Only count as unmapped if it could plausibly belong to this segment
            unmappedQty += qty;
            continue;
          }

          totalOrderQty += qty;
          perCategoryTotal[cat] = (perCategoryTotal[cat] ?? 0) + qty;

          if (fy === "2024-25") {
            monthly2425[cat][mIdx] += qty;
            totalMonthly2425[mIdx] += qty;
          } else {
            monthly2526[cat][mIdx] += qty;
            totalMonthly2526[mIdx] += qty;
          }
        }

        await delay(350);
      } catch (err) {
        logger.warn({ err, fy, tab }, `${logPrefix}: failed to read tab`);
      }
    }
  }

  return { monthly2425, monthly2526, totalMonthly2425, totalMonthly2526, totalOrderQty, unmappedQty, perCategoryTotal };
}

// ─── PTMT engine ─────────────────────────────────────────────────────────────

export async function runSeasonalityEngine(
  zScore: number = Z_VALUES[95],
): Promise<SeasonalityEngineOutput> {
  const codeMap = await buildCodeToCategoryMap();

  const ALL_CATEGORIES = [
    "Cocks Standard",
    "Cocks Premium",
    "Faucets & Jetsprays & Shower",
    "Accessorise",
    "Cistern & Seat Cover",
    "Cabinet",
    "Ball Cock",
  ];

  const { monthly2425, monthly2526, totalMonthly2425, totalMonthly2526, totalOrderQty, unmappedQty, perCategoryTotal } =
    await readOrderSheets(new Set(ALL_CATEGORIES), codeMap, "seasonality");

  const categories: SeasonalityCategoryResult[] = ALL_CATEGORIES.map((cat) => {
    const algo = runAlgorithm(monthly2425[cat], monthly2526[cat], zScore, cat);
    return { category: cat, ...algo, unmappedQty: 0, totalOrderQty: perCategoryTotal[cat] ?? 0, zScore, fy2425monthly: monthly2425[cat], fy2526monthly: monthly2526[cat] };
  });

  const segAlgo = runAlgorithm(totalMonthly2425, totalMonthly2526, zScore, "PTMT Total");
  const segmentBenchmark = { category: "PTMT Total", ...segAlgo, unmappedQty, totalOrderQty, zScore, fy2425monthly: totalMonthly2425, fy2526monthly: totalMonthly2526 };

  logger.info({ categories: categories.length, totalOrderQty, unmappedQty, segmentCV: segmentBenchmark.cv, segmentSuggested: segmentBenchmark.suggestedMultiplier }, "seasonality: engine complete");

  return { categories, segmentBenchmark, totalUnmappedQty: unmappedQty, totalOrderQty, computedAt: new Date(), zScore };
}

// ─── Plumbing engine ──────────────────────────────────────────────────────────

export async function runPlumbingSeasonalityEngine(
  zScore: number = Z_VALUES[95],
): Promise<SeasonalityEngineOutput> {
  const codeMap = await buildCodeToCategoryMap();
  const plumbingCatSet = new Set<string>(ALL_PLUMBING_CATEGORIES);

  const { monthly2425, monthly2526, totalMonthly2425, totalMonthly2526, totalOrderQty, unmappedQty, perCategoryTotal } =
    await readOrderSheets(plumbingCatSet, codeMap, "plumbing-seasonality");

  const categories: SeasonalityCategoryResult[] = [...ALL_PLUMBING_CATEGORIES].map((cat) => {
    const algo = runAlgorithm(monthly2425[cat], monthly2526[cat], zScore, cat, PLUMBING_THIN_THRESHOLD);
    return { category: cat, ...algo, unmappedQty: 0, totalOrderQty: perCategoryTotal[cat] ?? 0, zScore, fy2425monthly: monthly2425[cat], fy2526monthly: monthly2526[cat] };
  });

  // Segment benchmark: all Plumbing orders combined
  const segAlgo = runAlgorithm(totalMonthly2425, totalMonthly2526, zScore, "Plumbing Total");
  const segmentBenchmark = { category: "Plumbing Total", ...segAlgo, unmappedQty, totalOrderQty, zScore, fy2425monthly: totalMonthly2425, fy2526monthly: totalMonthly2526 };

  logger.info({
    categories: categories.length,
    totalOrderQty,
    segmentCV: segmentBenchmark.cv,
    segmentSuggested: segmentBenchmark.suggestedMultiplier,
    peakMonth: segmentBenchmark.peakMonth,
  }, "plumbing-seasonality: engine complete");

  return { categories, segmentBenchmark, totalUnmappedQty: unmappedQty, totalOrderQty, computedAt: new Date(), zScore };
}

// ─── Drift monitor ───────────────────────────────────────────────────────────

export interface DriftResult {
  category: string;
  month: string;
  expected: number;
  actual: number;
  residual: number;
  band: number;
  outsideBand: boolean;
  driftFlag: boolean;
  consecutiveMonthsOutside: number;
}

export async function computeDriftMonitor(
  engineCategories: SeasonalityCategoryResult[],
): Promise<DriftResult[]> {
  const sheetId = CURRENT_FY_ORDER_SHEET;
  let tabs: string[];
  try {
    tabs = await listTabs(sheetId);
  } catch {
    return [];
  }

  const tabMap2 = buildTabMap(tabs);
  const monthlyTabs = FISCAL_MONTHS.filter((m) => tabMap2.has(m));
  const codeMap = await buildCodeToCategoryMap();

  const actual: Record<string, Record<string, number>> = {};
  for (const tab of monthlyTabs) {
    const actualTab2 = tabMap2.get(tab) ?? tab;
    try {
      const values = await getTabValues(sheetId, actualTab2, "A1:Z50000");
      const rows = rowsToObjects(values);
      for (const row of rows) {
        const qty = toNum(row["Quantity"]);
        if (qty <= 0) continue;
        const cat = mapRowToCategory(row, codeMap);
        if (!cat) continue;
        if (!actual[cat]) actual[cat] = {};
        actual[cat][tab] = (actual[cat][tab] ?? 0) + qty;
      }
      await delay(350);
    } catch { /* skip */ }
  }

  const results: DriftResult[] = [];

  for (const catResult of engineCategories) {
    if (catResult.dataQuality !== "ok" || !catResult.avgMonth || !catResult.cv || !catResult.seasonalIndices) continue;
    const yoy = catResult.yoy ?? 0;
    const planningGrowth = Math.max(-0.20, Math.min(0.25, 0.5 * yoy));
    const band = catResult.zScore * catResult.cv;

    let consecutiveOutside = 0;
    for (let i = 0; i < monthlyTabs.length; i++) {
      const m = monthlyTabs[i];
      const mIdx = FISCAL_MONTHS.indexOf(m as FiscalMonth);
      if (mIdx === -1) continue;

      const expectedQty = (catResult.avgMonth ?? 0) * (1 + planningGrowth) * (catResult.seasonalIndices[mIdx] ?? 1);
      const actualQty = actual[catResult.category]?.[m] ?? 0;

      if (expectedQty === 0) continue;

      const residual = (actualQty - expectedQty) / expectedQty;
      const outsideBand = Math.abs(residual) > band;
      if (outsideBand) consecutiveOutside++;
      else consecutiveOutside = 0;

      results.push({
        category: catResult.category,
        month: m,
        expected: Math.round(expectedQty),
        actual: Math.round(actualQty),
        residual: round2(residual),
        band: round2(band),
        outsideBand,
        driftFlag: consecutiveOutside >= 2,
        consecutiveMonthsOutside: consecutiveOutside,
      });
    }
  }

  return results;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
