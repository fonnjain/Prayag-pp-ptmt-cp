import { db, itemMasterTable } from "@workspace/db";
import { getTabValues, listTabs } from "./sheets";
import { logger } from "./logger";

// ─── Constants ───────────────────────────────────────────────────────────────

export const FISCAL_MONTHS = ["Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar"] as const;
export type FiscalMonth = typeof FISCAL_MONTHS[number];

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

/** Avg monthly units below this → "thin" data quality */
const THIN_THRESHOLD = 100;

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
  segmentBenchmark: Omit<SeasonalityCategoryResult, "category"> & { category: "PTMT Total" };
  totalUnmappedQty: number;
  totalOrderQty: number;
  computedAt: Date;
  zScore: number;
}

// ─── Category mapping ─────────────────────────────────────────────────────────

/** Map item_master codes to PTMT categories */
async function buildCodeToCategoryMap(): Promise<Map<string, string>> {
  const rows = await db.select({ itemCode: itemMasterTable.itemCode, category: itemMasterTable.category }).from(itemMasterTable);
  const map = new Map<string, string>();
  for (const r of rows) map.set(r.itemCode.trim().toUpperCase(), r.category);
  return map;
}

/**
 * Map an order row's GROUP field to a PTMT category using keyword matching.
 * Returns null for rows that cannot be mapped (e.g. Cistern items are
 * ordered under CP/Sanitaryware GROUP and won't match).
 */
function mapGroupToCategory(group: string): string | null {
  if (!group) return null;
  const g = group.toUpperCase().replace(/[^A-Z&/ ]/g, " ").replace(/\s+/g, " ").trim();
  if (g.includes("BALL") && (g.includes("COCK") || g.includes("COCKE") || g.length < 15)) return "Ball Cock";
  if (g.includes("CABINET")) return "Cabinet";
  if (g.includes("CISTERN") || (g.includes("SEAT") && (g.includes("COVER") || g.includes("CVR")))) return "Cistern & Seat Cover";
  if (g.includes("FAUCET") || g.includes("JETSPRAY") || g.includes("JET SPRAY") || g.includes("SHOWER")) return "Faucets & Jetsprays & Shower";
  if (g.includes("PREMIUM")) return "Cocks Premium";
  if (g.includes("ACCESSORI")) return "Accessorise";
  if (g.includes("STANDARD") || (g.includes("COCK") && !g.includes("BALL"))) return "Cocks Standard";
  return null;
}

/**
 * Attempt to map an order row to a PTMT category:
 * 1. Try item_code lookup in item_master
 * 2. Fall back to GROUP keyword match
 */
function mapRowToCategory(
  row: Record<string, string>,
  codeMap: Map<string, string>,
): string | null {
  const itemCode = (
    row["Item Code"] || row["ITEM CODE"] || row["Code"] || row["CODE"] ||
    row["Item.Code"] || row["Description.Code"] || row["Grp.Name"] || ""
  ).trim().toUpperCase();

  if (itemCode) {
    const fromMaster = codeMap.get(itemCode);
    if (fromMaster) return fromMaster;
  }

  const group = row["GROUP"] || row["Group"] || row["group"] || "";
  return mapGroupToCategory(group);
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

// ─── Algorithm steps ──────────────────────────────────────────────────────────

function runAlgorithm(
  fy2425: number[],
  fy2526: number[],
  z: number,
  category: string,
): Omit<SeasonalityCategoryResult, "category" | "unmappedQty" | "totalOrderQty" | "zScore" | "fy2425monthly" | "fy2526monthly"> {
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

  // Step 3 — Deseasonalise, measure CV on 24 observations
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

  // Step 5 — YoY, damped and capped
  const yoy = annual2425 > 0 ? (annual2526 - annual2425) / annual2425 : null;
  const signal: "Growing" | "Stable" | "Declining" | null =
    yoy === null ? null : yoy > 0.08 ? "Growing" : yoy < -0.08 ? "Declining" : "Stable";

  // Peak month
  const peakIdx = seasonalIndices.reduce((best, v, i) => (v > seasonalIndices[best] ? i : best), 0);
  const peakMonth = FISCAL_MONTHS[peakIdx];
  const peakIndex = round2(seasonalIndices[peakIdx]);

  const dataQuality: "ok" | "thin" = avgMonth < THIN_THRESHOLD ? "thin" : "ok";

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

// ─── Main engine ─────────────────────────────────────────────────────────────

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

  // Per-category monthly totals: [Apr, May, ..., Mar]
  const monthly2425: Record<string, number[]> = {};
  const monthly2526: Record<string, number[]> = {};
  for (const cat of ALL_CATEGORIES) {
    monthly2425[cat] = Array(12).fill(0);
    monthly2526[cat] = Array(12).fill(0);
  }

  let totalOrderQty = 0;
  let unmappedQty = 0;
  const perCategoryUnmapped: Record<string, number> = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0]));
  const perCategoryTotal: Record<string, number> = Object.fromEntries(ALL_CATEGORIES.map((c) => [c, 0]));

  // Total for segment benchmark
  const totalMonthly2425 = Array(12).fill(0);
  const totalMonthly2526 = Array(12).fill(0);

  for (const fy of ["2024-25", "2025-26"] as const) {
    const sheetId = ENGINE_ORDER_SHEETS[fy];
    let tabs: string[];
    try {
      tabs = await listTabs(sheetId);
    } catch (err) {
      logger.warn({ err, fy }, "seasonality: could not list tabs for FY");
      continue;
    }

    const monthlyTabs = FISCAL_MONTHS.filter((m) => tabs.includes(m));
    logger.info({ fy, monthlyTabs: monthlyTabs.length }, "seasonality: reading order tabs");

    for (const tab of monthlyTabs) {
      const mIdx = FISCAL_MONTHS.indexOf(tab as FiscalMonth);
      if (mIdx === -1) continue;

      try {
        const values = await getTabValues(sheetId, tab, "A1:Z50000");
        const rows = rowsToObjects(values);

        for (const row of rows) {
          const qty = toNum(row["Quantity"]);
          if (qty <= 0) continue;

          totalOrderQty += qty;

          const cat = mapRowToCategory(row, codeMap);
          if (!cat || !ALL_CATEGORIES.includes(cat)) {
            unmappedQty += qty;
            continue;
          }

          perCategoryTotal[cat] = (perCategoryTotal[cat] ?? 0) + qty;

          if (fy === "2024-25") {
            monthly2425[cat][mIdx] += qty;
            totalMonthly2425[mIdx] += qty;
          } else {
            monthly2526[cat][mIdx] += qty;
            totalMonthly2526[mIdx] += qty;
          }
        }

        // Polite delay between sheet reads to avoid 429s
        await delay(350);
      } catch (err) {
        logger.warn({ err, fy, tab }, "seasonality: failed to read tab");
      }
    }
  }

  // Compute per-category results
  const categories: SeasonalityCategoryResult[] = ALL_CATEGORIES.map((cat) => {
    const algo = runAlgorithm(monthly2425[cat], monthly2526[cat], zScore, cat);
    return {
      category: cat,
      ...algo,
      unmappedQty: perCategoryUnmapped[cat] ?? 0,
      totalOrderQty: perCategoryTotal[cat] ?? 0,
      zScore,
      fy2425monthly: monthly2425[cat],
      fy2526monthly: monthly2526[cat],
    };
  });

  // Segment benchmark (all PTMT orders, including unmapped)
  const segAlgo = runAlgorithm(totalMonthly2425, totalMonthly2526, zScore, "PTMT Total");
  const segmentBenchmark: SeasonalityEngineOutput["segmentBenchmark"] = {
    category: "PTMT Total",
    ...segAlgo,
    unmappedQty,
    totalOrderQty,
    zScore,
    fy2425monthly: totalMonthly2425,
    fy2526monthly: totalMonthly2526,
  };

  logger.info({
    categories: categories.length,
    totalOrderQty,
    unmappedQty,
    unmappedPct: totalOrderQty > 0 ? Math.round((unmappedQty / totalOrderQty) * 100) : 0,
    segmentCV: segmentBenchmark.cv,
    segmentSuggested: segmentBenchmark.suggestedMultiplier,
  }, "seasonality: engine complete");

  return {
    categories,
    segmentBenchmark,
    totalUnmappedQty: unmappedQty,
    totalOrderQty,
    computedAt: new Date(),
    zScore,
  };
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

/**
 * For FY2026-27 (current year), compare actual order intake against the
 * expected seasonal shape. Raises SEASONALITY_DRIFT if a category deviates
 * outside ±z×CV band for 2+ consecutive months.
 */
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

  const monthlyTabs = FISCAL_MONTHS.filter((m) => tabs.includes(m));
  const codeMap = await buildCodeToCategoryMap();

  // Actual FY2026-27 per category per month
  const actual: Record<string, Record<string, number>> = {};
  for (const tab of monthlyTabs) {
    try {
      const values = await getTabValues(sheetId, tab, "A1:Z50000");
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
