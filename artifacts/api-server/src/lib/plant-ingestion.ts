import { db, plantIngestionCacheTable, plantSourceConfigsTable, itemMasterTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  fetchMonitoringPlumbingSheet3Production,
  fetchPlumbingSheet3Production,
  getTabValues,
  getWorkbookIdForMonth,
  listTabs,
  resolveMonitoringWorkbookForMonth,
  SHEET_IDS,
  itemKey,
  normalizeCode,
} from "./sheets";
import { logger } from "./logger";
import { buildPlanItems } from "../routes/plan";
import { getPlanVersionTimeline, type PlanVersion } from "./plant-plan-timeline";
import { resolvePlantMonthLifecycle } from "./plant-lifecycle";

export interface DailyActualRow {
  date: string;
  itemCode: string;
  colour: string;
  qty: number;
  group: string;
}

export interface PlantTargetRow {
  itemCode: string;
  colour: string;
  category: string;
  maxPcs: number;
  minPcs: number;
}

const CACHE_TTL_MS = 15 * 60 * 1000;

function currentMonthStr(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function toNum(v: unknown): number {
  const n = Number(String(v ?? "0").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : 0;
}

function parseDate(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  const serial = Number(s);
  if (Number.isFinite(serial) && serial > 40000 && serial < 55000) {
    const d = new Date((serial - 25569) * 86400 * 1000);
    return d.toISOString().slice(0, 10);
  }
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

export async function loadStoredDailyActuals(month: string): Promise<{
  actuals: DailyActualRow[];
  snapshotDate: string | null;
  cachedAt: Date | null;
}> {
  return loadStoredDailyActualsForSegment(month, "PTMT");
}

export async function loadStoredDailyActualsForSegment(month: string, segment = "PTMT"): Promise<{
  actuals: DailyActualRow[];
  snapshotDate: string | null;
  cachedAt: Date | null;
}> {
  const [cached] = await db.select().from(plantIngestionCacheTable).where(and(
    eq(plantIngestionCacheTable.month, month),
    eq(plantIngestionCacheTable.segment, segment),
  ));
  return {
    actuals: cached ? cached.rawActualsJson as DailyActualRow[] : [],
    snapshotDate: cached?.snapshotDate || null,
    cachedAt: cached?.cachedAt ?? null,
  };
}

/**
 * Fetch and persist Plumbing's Sheet3 actuals independently of plan-building.
 *
 * The read-only API is intentionally local-only, so its open-month projection
 * needs a durable ingestion row before a workbook-heavy monitoring rebuild
 * starts. Keeping this operation separate also means a transient quota error
 * while reading a plan tab cannot discard successfully-read production rows.
 */
export async function refreshPlumbingActualsCache(month: string): Promise<{
  actuals: DailyActualRow[];
  snapshotDate: string | null;
  cachedAt: Date;
  sourceMonth: string;
  usedFallback: boolean;
  warning: string | null;
}> {
  const source = await fetchMonitoringPlumbingSheet3Production(month);
  const rows = source.rows;
  const actuals = rows.map((row) => ({
    date: row.dateStr,
    itemCode: row.rawCode,
    colour: "",
    qty: row.qty,
    group: "PLUMBING",
  }));
  const snapshotDate = actuals.length
    ? [...actuals].sort((a, b) => a.date.localeCompare(b.date)).at(-1)?.date ?? null
    : null;
  const cachedAt = new Date();

  await db.insert(plantIngestionCacheTable).values({
    month,
    segment: "Plumbing",
    snapshotDate: snapshotDate ?? "",
    rawActualsJson: actuals,
    cachedAt,
  }).onConflictDoUpdate({
    target: [plantIngestionCacheTable.month, plantIngestionCacheTable.segment],
    set: { snapshotDate: snapshotDate ?? "", rawActualsJson: actuals, cachedAt },
  });

  logger.info(
    { month, sourceMonth: source.sourceMonth, usedFallback: source.usedFallback, rowCount: actuals.length, snapshotDate },
    "plant-ingestion: cached Plumbing Sheet3 actuals",
  );
  return {
    actuals,
    snapshotDate,
    cachedAt,
    sourceMonth: source.sourceMonth,
    usedFallback: source.usedFallback,
    warning: source.warning,
  };
}

export async function fetchDailyActuals(
  month: string,
  options: { forceRefresh?: boolean; requireFresh?: boolean } = {},
  segment = "PTMT",
): Promise<DailyActualRow[]> {
  const [cached] = await db.select().from(plantIngestionCacheTable).where(and(
    eq(plantIngestionCacheTable.month, month),
    eq(plantIngestionCacheTable.segment, segment),
  ));
  if (cached) {
    const age = Date.now() - new Date(cached.cachedAt).getTime();
    if (!options.forceRefresh && (month < currentMonthStr() || age < CACHE_TTL_MS)) {
      return cached.rawActualsJson as DailyActualRow[];
    }
  }

  const [y, m] = month.split("-").map(Number);
  const startDate = `${y}-${String(m).padStart(2, "0")}-01`;
  const daysInMonth = new Date(y, m, 0).getDate();
  const endDate = `${y}-${String(m).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`;

  const [source] = await db.select({ fileId: plantSourceConfigsTable.fileId })
    .from(plantSourceConfigsTable)
    .where(and(
      eq(plantSourceConfigsTable.month, month),
      eq(plantSourceConfigsTable.segment, segment),
    ));
  let workbookId = source?.fileId ?? null;
  if (!workbookId && segment === "PTMT") {
    try {
      workbookId = await getWorkbookIdForMonth("PTMT", month);
    } catch (err) {
      if (options.requireFresh) throw err;
      logger.warn({ month, segment, err: String(err) }, "plant-ingestion: monthly workbook resolution failed");
    }
  }
  if (!workbookId) {
    const error = new Error(`No ${segment} production workbook is configured for ${month}`);
    if (options.requireFresh) throw error;
    logger.warn({ month, segment }, "plant-ingestion: no month-specific production workbook configured");
    return cached ? (cached.rawActualsJson as DailyActualRow[]) : [];
  }

  let rows: string[][];
  let sourceTab: string;
  try {
    const tabs = await listTabs(workbookId);
    sourceTab =
      tabs.find((tab) => tab.trim().toLowerCase() === "production") ??
      tabs.find((tab) => tab.trim().toLowerCase() === "p-data") ??
      "";
    if (!sourceTab) {
      throw new Error(`No Production or P-DATA tab found in PTMT workbook ${workbookId}`);
    }
    rows = await getTabValues(workbookId, sourceTab, "A1:F500000");
  } catch (err) {
    logger.error({ err, month, workbookId }, "plant-ingestion: failed to read monthly Production tab");
    if (options.requireFresh) throw err;
    return cached ? (cached.rawActualsJson as DailyActualRow[]) : [];
  }

  if (rows.length === 0) {
    if (options.requireFresh) {
      throw new Error("PTMT ANUJ Production tab returned no rows");
    }
    return [];
  }

  // Older monthly workbooks keep the data in P-DATA, preceded by a
  // formula/summary row. Locate the real header instead of assuming row 1.
  const headerRowIndex = rows.findIndex((row) => {
    const headers = row.map((h) => String(h ?? "").trim().toLowerCase());
    return headers.some((h) => h === "date") &&
      headers.some((h) => h === "code" || h.includes("code")) &&
      headers.some((h) => h === "qty" || h.includes("quantity"));
  });
  if (headerRowIndex < 0) {
    const error = new Error(`PTMT ${sourceTab} tab has no recognised Date/Code/Qty header`);
    if (options.requireFresh) throw error;
    logger.warn({ month, workbookId, sourceTab }, "plant-ingestion: monthly actuals tab has no recognised header");
    return [];
  }
  const header = rows[headerRowIndex].map((h) => String(h ?? "").trim().toLowerCase());
  const fi = (pred: (h: string) => boolean, fallback: number) => {
    const idx = header.findIndex(pred);
    return idx >= 0 ? idx : fallback;
  };
  const di = fi((h) => h.includes("date"), 0);
  const ci = fi((h) => h.includes("code"), 1);
  const li = fi((h) => h.includes("col"), 2);
  const qi = fi((h) => h === "qty" || h.includes("qty") || h.includes("quantity"), 3);
  const gi = fi((h) => h.includes("group"), 4);

  const result: DailyActualRow[] = [];
  for (let i = headerRowIndex + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || !row[di]) continue;
    const dateStr = parseDate(String(row[di] ?? ""));
    if (!dateStr || dateStr < startDate || dateStr > endDate) continue;
    const code = String(row[ci] ?? "").trim().toUpperCase();
    if (!code) continue;
    const qty = toNum(row[qi]);
    if (qty <= 0) continue;
    result.push({
      date: dateStr,
      itemCode: code,
      colour: String(row[li] ?? "").trim().toUpperCase(),
      qty,
      group: String(row[gi] ?? "").trim(),
    });
  }

  const lastDate = result.length > 0 ? [...result].map((r) => r.date).sort().pop()! : "";
  if (cached) {
    await db.update(plantIngestionCacheTable)
      .set({ snapshotDate: lastDate, rawActualsJson: result, cachedAt: new Date() })
      .where(and(
        eq(plantIngestionCacheTable.month, month),
        eq(plantIngestionCacheTable.segment, segment),
      ));
  } else {
    await db.insert(plantIngestionCacheTable).values({ month, segment, snapshotDate: lastDate, rawActualsJson: result });
  }

  logger.info({ month, segment, workbookId, sourceTab, rowCount: result.length, lastDate }, "plant-ingestion: fetched monthly production actuals");
  return result;
}

export async function fetchMonitoringDailyActuals(
  month: string,
  options: { forceRefresh?: boolean; requireFresh?: boolean } = {},
): Promise<{
  actuals: DailyActualRow[];
  requestedMonth: string;
  sourceMonth: string;
  workbookId: string;
  usedFallback: boolean;
  warning: string | null;
}> {
  const resolution = await resolveMonitoringWorkbookForMonth("PTMT", month);
  // Reuse the strict parser/cache for the actual source month. The fallback
  // resolver only chooses the source; it never changes the strict reader.
  const actuals = await fetchDailyActuals(resolution.sourceMonth, options, "PTMT");
  return {
    actuals,
    requestedMonth: month,
    sourceMonth: resolution.sourceMonth,
    workbookId: resolution.workbookId,
    usedFallback: resolution.usedFallback,
    warning: resolution.warning,
  };
}

export async function fetchMonthlyTargets(month: string): Promise<PlantTargetRow[]> {
  if (resolvePlantMonthLifecycle(month).state === "future") return [];

  const timeline = await getPlanVersionTimeline(month, "PTMT");
  const latest = timeline.at(-1);
  if (latest) {
    return latest.targets.map((item) => ({
      itemCode: item.itemCode,
      colour: item.colour,
      category: item.category,
      maxPcs: item.maxPcs,
      minPcs: item.minPcs,
    }));
  }
  if (month >= currentMonthStr()) {
    const planItems = await buildPlanItems(month);
    return planItems.map((item) => ({
      itemCode: item.itemCode,
      colour: item.colour,
      category: item.category,
      maxPcs: item.maxProduction,
      minPcs: item.minProduction,
    }));
  }

  const [src] = await db.select().from(plantSourceConfigsTable).where(and(
    eq(plantSourceConfigsTable.month, month),
    eq(plantSourceConfigsTable.segment, "PTMT"),
  ));
  if (!src) {
    logger.warn({ month }, "plant-ingestion: no master file ID for historical month; returning empty targets");
    return [];
  }
  return fetchTargetsFromMasterSheet(src.fileId, month);
}

/** Immutable issued-plan versions used by monitoring calculations. */
export async function fetchMonitoringPlanTimeline(month: string, segment = "PTMT"): Promise<PlanVersion[]> {
  return getPlanVersionTimeline(month, segment);
}

async function fetchTargetsFromMasterSheet(fileId: string, month: string): Promise<PlantTargetRow[]> {
  let rows: string[][];
  try {
    rows = await getTabValues(fileId, "SUMMARY", "A1:Z5000");
  } catch (err) {
    logger.error({ err, fileId, month }, "plant-ingestion: failed to read master SUMMARY tab");
    return [];
  }
  if (rows.length === 0) return [];

  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const codeIdx = header.findIndex((h) => h.includes("item") || h.includes("code"));
  const colourIdx = header.findIndex((h) => h.startsWith("col"));
  const maxIdx = header.findIndex((h) => h === "max" || h.includes("max") || h.includes("production plan") || h === "pp");
  const minIdx = header.findIndex((h) => h === "min" || h.includes("min"));

  if (codeIdx < 0 || maxIdx < 0) {
    logger.warn({ fileId, month, header }, "plant-ingestion: cannot identify required columns in SUMMARY tab");
    return [];
  }

  const masterItems = await db.select().from(itemMasterTable);
  const catByKey = new Map<string, string>();
  const catByCode = new Map<string, string>();
  for (const item of masterItems) {
    catByKey.set(itemKey(item.itemCode, item.colour), item.category);
    if (!catByCode.has(normalizeCode(item.itemCode))) catByCode.set(normalizeCode(item.itemCode), item.category);
  }

  const result: PlantTargetRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    const code = String(row[codeIdx] ?? "").trim().toUpperCase();
    if (!code) continue;
    const colour = colourIdx >= 0 ? String(row[colourIdx] ?? "").trim().toUpperCase() : "";
    const maxPcs = toNum(row[maxIdx]);
    const minPcs = minIdx >= 0 ? toNum(row[minIdx]) : 0;
    if (maxPcs <= 0) continue;
    const category = catByKey.get(itemKey(code, colour)) ?? catByCode.get(code) ?? "Unknown";
    result.push({ itemCode: code, colour, category, maxPcs, minPcs });
  }
  return result;
}
