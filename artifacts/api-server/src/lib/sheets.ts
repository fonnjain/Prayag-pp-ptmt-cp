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
  const diagnostics = diagnoseInputRows(rows, {
    code: ["Old ERP Code"],
    colour: ["Colour"],
    quantity: ["Bal. Qty"],
  }, { source: `${SHEET_LABELS.pendingOrder} / report` });

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

  totals.diagnostics = diagnostics;
  logger.info({ diagnostics }, "fetchLivePendingOrderTotals: source diagnostics");
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

export const PLUMBING_MATERIALS = ["CPVC", "UPVC", "SWR", "AGRI"] as const;

/** Normalize display punctuation/spacing so "CPVC PIPE" and " cpvc_pipe " compare alike. */
export function normalizePlumbingTabName(tab: string): string {
  return tab.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

export function plumbingTabMatchesMaterial(tab: string, material: string): boolean {
  const normalizedTab = normalizePlumbingTabName(tab);
  const normalizedMaterial = normalizePlumbingTabName(material);
  return normalizedTab === normalizedMaterial || normalizedTab.startsWith(normalizedMaterial);
}

export function selectPlumbingMaterialTab(tabs: string[], material: string): string | undefined {
  const candidates = tabs.filter((tab) => plumbingTabMatchesMaterial(tab, material));
  return (
    candidates.find((tab) => normalizePlumbingTabName(tab) === normalizePlumbingTabName(material)) ??
    candidates.find((tab) => !normalizePlumbingTabName(tab).includes("TOPITEM")) ??
    candidates[0]
  );
}

export function selectPlumbingMaterialTabs(tabs: string[], material: string): string[] {
  const candidates = tabs.filter((tab) => plumbingTabMatchesMaterial(tab, material));
  const exact = candidates.find((tab) => normalizePlumbingTabName(tab) === normalizePlumbingTabName(material));
  if (exact) return [exact];
  return candidates.filter((tab) => !normalizePlumbingTabName(tab).includes("TOPITEM"));
}

function typeFromPlumbingTab(tab: string): "Pipe" | "Fitting" | "Solvent" | null {
  const normalized = normalizePlumbingTabName(tab);
  if (normalized.endsWith("SOLVENT")) return "Solvent";
  if (normalized.endsWith("FITTING") || normalized.endsWith("FITTINGS") || normalized.endsWith("FT")) return "Fitting";
  if (normalized.endsWith("PIPE") || normalized.endsWith("PIPES")) return "Pipe";
  return null;
}

const MONTH_NUMBER_BY_NAME: Record<string, number> = {
  JAN: 1, JANUARY: 1, FEB: 2, FEBRUARY: 2, MAR: 3, MARCH: 3,
  APR: 4, APRIL: 4, MAY: 5, JUN: 6, JUNE: 6, JUL: 7, JULY: 7,
  AUG: 8, AUGUST: 8, SEP: 9, SEPT: 9, SEPTEMBER: 9, OCT: 10,
  OCTOBER: 10, NOV: 11, NOVEMBER: 11, DEC: 12, DECEMBER: 12,
};

function monthKeyFromHeader(header: string): string | null {
  const match = header.trim().toUpperCase().match(/\b([A-Z]+)[\s-]+(\d{2,4})\b/);
  if (!match) return null;
  const monthNumber = MONTH_NUMBER_BY_NAME[match[1]!];
  if (!monthNumber) return null;
  const rawYear = Number(match[2]);
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  return `${year}-${String(monthNumber).padStart(2, "0")}`;
}

function priorThreeMonthKeys(month: string): Set<string> {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber || monthNumber < 1 || monthNumber > 12) return new Set();
  const keys = new Set<string>();
  for (let offset = 1; offset <= 3; offset++) {
    const date = new Date(Date.UTC(year, monthNumber - 1 - offset, 1));
    keys.add(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function parsePlumbingMasterRows(values: string[][], month: string): PlumbingPlanRow[] {
  const headerRowIdx = values.findIndex((row) => {
    const headers = row.map((cell) => String(cell ?? "").trim().toUpperCase());
    return headers.includes("ITEM CODE") && headers.includes("PRODUCTION") && headers.includes("MONTH");
  });
  if (headerRowIdx < 0) return [];

  const header = values[headerRowIdx]!.map((cell) => String(cell ?? "").trim());
  const codeCol = header.findIndex((cell) => /^item\s*code$/i.test(cell));
  const productionCol = header.findIndex((cell) => /^production$/i.test(cell));
  const monthCol = header.findIndex((cell) => /^month$/i.test(cell));
  const typeCol = header.findIndex((cell) => /^type$/i.test(cell));
  if (codeCol < 0 || productionCol < 0 || monthCol < 0 || typeCol < 0) return [];

  const priorMonths = priorThreeMonthKeys(month);
  const byItem = new Map<string, { material: string; type: "Pipe" | "Fitting" | "Solvent"; itemCode: string; priorTotal: number }>();
  for (const row of values.slice(headerRowIdx + 1)) {
    const itemCode = String(row[codeCol] ?? "").trim();
    const typeLabel = String(row[typeCol] ?? "").trim().toUpperCase();
    const material = PLUMBING_MATERIALS.find((candidate) => typeLabel.startsWith(candidate));
    const type = typeFromPlumbingTab(typeLabel);
    if (!itemCode || !material || !type) continue;

    const key = `${material}\u0000${type}\u0000${itemCode.toUpperCase()}`;
    const entry = byItem.get(key) ?? { material, type, itemCode, priorTotal: 0 };
    if (priorMonths.has(monthKeyFromHeader(String(row[monthCol] ?? "")) ?? "")) {
      entry.priorTotal += toNumber(row[productionCol]);
    }
    byItem.set(key, entry);
  }

  return [...byItem.values()].map((entry) => ({
    material: entry.material,
    type: entry.type,
    category: `${entry.material} ${entry.type}`,
    itemCode: entry.itemCode,
    // MASTER stores monthly totals, so the previous three months are summed
    // and divided by three to match the daily workbook's monthly-average field.
    avg3MoSale: entry.priorTotal / 3,
    sheetMultiplier: undefined,
  }));
}

function looksLikePlumbingMaterialTab(tab: string): boolean {
  const normalized = normalizePlumbingTabName(tab);
  return (
    PLUMBING_MATERIALS.some((material) => normalized.startsWith(material)) ||
    normalized.includes("PIPE") ||
    normalized.includes("FITTING") ||
    normalized.includes("SOLVENT")
  );
}

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
  // Priority: DB-configured ID → hardcoded month map → Drive discovery.
  // After finding any file, validate it has at least one material tab.
  // The Drive search can match wrong files (e.g. purchase workbooks) that share
  // "PLUMBING" + month + year in their name but have no CPVC/UPVC/SWR/AGRI tabs.
  const dbId = await loadWorkbookIdFromDb("Plumbing", month);
  const hardcodedId = PLUMBING_DAILY_WORKBOOK_IDS[month] ?? null;
  const driveIds = dbId ? [] : await findPlumbingWorkbookIds(month); // skip Drive if DB has an ID

  // Try DB ID first, then the exact month-pinned workbook, then ALL Drive candidates.
  // Discovery can return similarly named purchase workbooks with incompatible
  // production-summary layouts, so it must not outrank the known month source.
  let fileId: string | null = null;
  let tabs: string[] = [];
  for (const candidateId of [...new Set([dbId, hardcodedId, ...driveIds].filter(Boolean) as string[])]) {
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
  const skippedTabs = new Set<string>();
  const diagnostics: string[] = [];
  const parsedMaterials = new Set<string>();
  const markSkipped = (tab: string, detail: string): void => {
    skippedTabs.add(tab);
    diagnostics.push(`${tab}: ${detail}`);
    logger.warn({ materialTab: tab, fileId, detail }, "fetchPlumbingPlanData: skipped Plumbing tab");
  };

  const masterTab = tabs.find((tab) => normalizePlumbingTabName(tab) === "MASTER");
  const hasPlainMaterialTab = PLUMBING_MATERIALS.every((material) =>
    tabs.some((tab) => normalizePlumbingTabName(tab) === normalizePlumbingTabName(material)),
  );
  if (masterTab && !hasPlainMaterialTab) {
    try {
      await sleep(1100);
      const masterRows = parsePlumbingMasterRows(
        await getTabValues(fileId, masterTab, "A1:Z50000"),
        month,
      );
      if (masterRows.length > 0) {
        logger.info(
          { month, fileId, tab: masterTab, rowCount: masterRows.length },
          "fetchPlumbingPlanData: parsed full roster from MASTER tab",
        );
        return masterRows;
      }
      markSkipped(masterTab, "MASTER header or supported material rows not found");
    } catch (err) {
      markSkipped(masterTab, `tab read failed: ${String(err)}`);
    }
  }

  for (const material of PLUMBING_MATERIALS) {
    // Prefer the plain "CPVC" / "UPVC" / "SWR" / "AGRI" tab over compound variants
    // like "CPVC TOP ITEM" that contain only the top-100 rows and no type column.
    // Priority: (1) exact case-insensitive match, (2) contains material but NOT "TOP ITEM",
    // (3) any tab containing the material name.
    const materialTabs = selectPlumbingMaterialTabs(tabs, material);
    if (materialTabs.length === 0) {
      diagnostics.push(`${material}: no matching material tab`);
      logger.warn({ material, tabs, fileId }, "fetchPlumbingPlanData: no tab found for material");
      continue;
    }

    for (const tab of materialTabs) {
      let values: string[][];
      try {
        await sleep(1100); // throttle: Sheets API allows ~60 req/min
        values = await getTabValues(fileId, tab, "A1:Z50000");
      } catch (err) {
        markSkipped(tab, `tab read failed: ${String(err)}`);
        continue;
      }

      // Scan a generous header window: compound material tabs can have title,
      // metadata, and blank rows before their actual column headers.
      // The newer layout contains LAST 3 MONTH/PENDING ORDER. Older production
      // summary tabs contain ITEM CODE plus dated month columns.
      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(100, values.length); i++) {
        const joined = values[i].map((c) => String(c ?? "")).join(" ").toUpperCase();
        const hasDailyHeader = joined.includes("LAST 3 MONTH") || (joined.includes("PENDING") && joined.includes("ORDER"));
        const hasMonthlySummaryHeader = joined.includes("ITEM CODE") && values[i].some((cell) => monthKeyFromHeader(String(cell ?? "")));
        if (hasDailyHeader || hasMonthlySummaryHeader) {
          headerRowIdx = i;
          break;
        }
      }
      if (headerRowIdx < 0) {
        markSkipped(tab, "header row not found in first 100 rows");
        continue;
      }

      const header = values[headerRowIdx].map((h) => String(h ?? "").trim());

      // COLUMN ALLOW-LIST (uploads-only rule, scoped 2026-08): only the item
      // roster (code/type), avg-3-month, and per-item multiplier are mapped.
      // Stock / pending / pending-LM / buffer columns exist in this workbook but
      // are NOT read — stock and pending come exclusively from uploads (plan.ts),
      // and the buffer is recomputed from avg × multiplier.
      const avg3moCol = header.findIndex((h) => /last\s*3\s*month\s*avg|3.*month.*avg.*sale/i.test(h));
      const priorMonths = priorThreeMonthKeys(month);
      const avg3moMonthCols = header
        .map((h, index) => ({ index, key: monthKeyFromHeader(h) }))
        .filter(({ key }) => key !== null && priorMonths.has(key))
        .map(({ index }) => index);
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

      const tabType = typeFromPlumbingTab(tab);
      logger.info(
        { material, tab, headerRowIdx, codeCol, typeCol, tabType, multiplierCol, avg3moCol, avg3moMonthCols,
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
      if (codeCol < 0 || (avg3moCol < 0 && avg3moMonthCols.length === 0) || (typeCol < 0 && !tabType)) {
        markSkipped(
          tab,
          `required columns not found (itemCode=${codeCol}, avg3mo=${avg3moCol}, avg3moMonths=${avg3moMonthCols.length}, type=${typeCol}, tabType=${tabType ?? "none"})`,
        );
        continue;
      }

      // ALL FOUR newer material tabs tag the type on EVERY item row. Older
      // production-summary tabs carry the type in the tab name (PIPE/FT).
      let rowCount = 0;
      for (let i = headerRowIdx + 1; i < values.length; i++) {
        const row = values[i];
        if (!row) continue;
        const rawCode = String(row[codeCol] ?? "").trim();

        // Skip blank rows and stray note text.
        // Note text (e.g. AGRI correction notice) appears in the item-code cell; it can be
        // identified because it contains a colon (":") which no item code ever contains.
        if (!rawCode || rawCode.includes(":")) continue;

        // Read type directly from the row when available; otherwise use the
        // normalized PIPE/FT/SOLVENT tab suffix.
        const itemType: "Pipe" | "Fitting" | "Solvent" | null = typeCol >= 0
          ? (normItemType(String(row[typeCol] ?? "")) ?? tabType)
          : tabType;

        const rawMult = multiplierCol >= 0 ? toNumber(row[multiplierCol]) : 0;
        const sheetMultiplier = rawMult >= 0.5 && rawMult <= 3.0 ? rawMult : undefined;
        const avg3MoSale = avg3moCol >= 0
          ? toNumber(row[avg3moCol])
          : avg3moMonthCols.reduce((sum, column) => sum + toNumber(row[column]), 0) / 3;

        result.push({
          material,
          type: itemType,
          category: itemType ? `${material} ${itemType}` : material,
          itemCode: rawCode,
          avg3MoSale,
          // Stock / pending / pending-LM intentionally NOT read — uploads only (plan.ts).
          sheetMultiplier,
        });
        rowCount++;
      }
      logger.info({ material, tab, typeCol, tabType, codeCol, rowCount }, "fetchPlumbingPlanData: rows parsed");
      if (rowCount === 0) {
        markSkipped(tab, "no item rows found after the mapped header");
        continue;
      }
      parsedMaterials.add(material);
    }
  }

  const missingMaterials = PLUMBING_MATERIALS.filter((material) => !parsedMaterials.has(material));
  if (missingMaterials.length > 0 || result.length === 0) {
    const materialLikeTabs = tabs.filter(looksLikePlumbingMaterialTab);
    const reportedTabs = [...new Set([...skippedTabs, ...materialLikeTabs])];
    const detail = [
      missingMaterials.length > 0 ? `missing usable material tabs: ${missingMaterials.join(", ")}` : "",
      diagnostics.length > 0 ? diagnostics.join("; ") : "no usable item rows were parsed",
    ].filter(Boolean).join(". ");
    throw new PlumbingInputUnreadableError(month, fileId, reportedTabs, detail);
  }

  return result;
}
