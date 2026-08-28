import { Router, type IRouter } from "express";
import { exportTimestamp } from "../lib/export-filename";
import {
  db,
  itemWeightsTable,
  idealHoursOverridesTable,
  monitoringThresholdsTable,
  monitoringConfigTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { buildPlanItems, getPlumbingMonitoringPayloadCached, handlePlanError } from "./plan";
import { parseReport5 } from "../lib/report5";
import { getWorkbookIdForMonth, normalizeCodeStrict } from "../lib/sheets";
import { fetchDailyActuals, type DailyActualRow } from "../lib/plant-ingestion";
import {
  buildCalendarModel,
  convertTargetsToPcs,
  computePaceMetrics,
  computeMachineQuality,
  ragBand,
  buildBehindPaceAndWillMissWarnings,
  buildQualityWarnings,
  buildStockoutWarnings,
  buildRecommendedActions,
  DEFAULT_WARNING_THRESHOLDS,
  type WarningThresholds,
  type CategoryPace,
  type ItemWeightMap,
  type Warning,
} from "../lib/monitoring-calc";
import { logger } from "../lib/logger";
import { normalizePlantSegment, PLANT_SEGMENTS } from "../lib/plant-segments";
import { resolveWorkingDays } from "../lib/plant-lifecycle";
import { resolvePlantMonthLifecycle } from "../lib/plant-lifecycle";
import { buildElapsedProductionDays } from "../lib/plant-engine";
import { exportMonitoringExcel, exportMonitoringPdf, type MonitoringExportData } from "../lib/monitoring-export";

const router: IRouter = Router();

async function loadWeightMap(): Promise<ItemWeightMap> {
  const rows = await db.select().from(itemWeightsTable);
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.weightKg === null) continue;
    map.set(`${row.itemCode.trim().toUpperCase()}::${row.colour.trim().toUpperCase()}`, Number(row.weightKg));
  }
  return {
    get(itemCode: string, colour: string) {
      const key = `${itemCode.trim().toUpperCase()}::${colour.trim().toUpperCase()}`;
      return map.has(key) ? (map.get(key) as number) : null;
    },
  };
}

async function loadConfig(month: string) {
  const [row] = await db.select().from(monitoringConfigTable).where(and(
    eq(monitoringConfigTable.month, month),
    eq(monitoringConfigTable.segment, "PTMT"),
  ));
  const workingDaysConfig = resolveWorkingDays(month, row?.workingDays);
  return {
    workingDays: workingDaysConfig.workingDays,
    workingDaysSource: workingDaysConfig.workingDaysSource,
    shiftsPerDay: row?.shiftsPerDay ?? 2,
    shiftHours: row?.shiftHours ?? 12,
    snapshotDate: row?.snapshotDate ?? null,
  };
}

async function loadThresholds(): Promise<WarningThresholds> {
  const rows = await db.select().from(monitoringThresholdsTable);
  const overrides: Partial<WarningThresholds> = {};
  for (const row of rows) {
    Object.assign(overrides, row.thresholdJson);
  }
  return { ...DEFAULT_WARNING_THRESHOLDS, ...overrides };
}

async function loadOverridesForMonth(month: string): Promise<Map<string, number>> {
  const rows = await db
    .select()
    .from(idealHoursOverridesTable)
    .where(eq(idealHoursOverridesTable.month, month));
  return new Map(rows.map((r) => [r.machineId, Number(r.hours)]));
}

// ─── PTMT daily-actuals aggregation (mirrors computePlumbingMonitoringPayload) ──
type PtmtActuals = ReturnType<typeof computePtmtActuals>;
function computePtmtActuals(
  planItems: { itemCode: string; category: string; maxProduction: number; w1?: number; w2?: number; w3?: number; w4?: number }[],
  actuals: DailyActualRow[],
  pcConversion: { targetPcsByCategory: Map<string, number> },
) {
  // code → category map (normalised)
  const codeToCategory = new Map<string, string>();
  const catRelease = new Map<string, [number, number, number, number]>();
  for (const item of planItems) {
    const norm = normalizeCodeStrict(item.itemCode);
    if (!codeToCategory.has(norm)) codeToCategory.set(norm, item.category);
    const arr = catRelease.get(item.category) ?? [0, 0, 0, 0];
    arr[0] += item.w1 ?? 0;
    arr[1] += item.w2 ?? 0;
    arr[2] += item.w3 ?? 0;
    arr[3] += item.w4 ?? 0;
    catRelease.set(item.category, arr);
  }

  function wkIdx(day: number) { return day <= 7 ? 0 : day <= 14 ? 1 : day <= 21 ? 2 : 3 as 0|1|2|3; }

  const catActual = new Map<string, [number, number, number, number]>();
  const unmappedByWeek: [number, number, number, number] = [0, 0, 0, 0];
  const unmappedCodeQty = new Map<string, number>();

  for (const row of actuals) {
    const cat = codeToCategory.get(normalizeCodeStrict(row.itemCode));
    const wi = wkIdx(parseInt(row.date.slice(8), 10));
    if (!cat) {
      unmappedByWeek[wi] += row.qty;
      unmappedCodeQty.set(row.itemCode, (unmappedCodeQty.get(row.itemCode) ?? 0) + row.qty);
      continue;
    }
    const arr = catActual.get(cat) ?? [0, 0, 0, 0];
    arr[wi] += row.qty;
    catActual.set(cat, arr);
  }

  const lastDataDate = actuals.length > 0 ? [...actuals].map((r) => r.date).sort().pop()! : null;
  const totalMapped   = [...catActual.values()].reduce((s, a) => s + a.reduce((x, v) => x + v, 0), 0);
  const totalUnmapped = unmappedByWeek.reduce((s, v) => s + v, 0);
  const totalProduced = totalMapped + totalUnmapped;
  const topCodes = [...unmappedCodeQty.entries()]
    .sort((a, b) => b[1] - a[1]).slice(0, 20).map(([code, qty]) => ({ code, qty }));

  // Per-category detailed (same shape as Plumbing)
  const allCats = new Set([...catRelease.keys(), ...catActual.keys()]);
  function p2(n: number) { return String(n).padStart(2, "0"); }
  const categoriesDetailed = [...allCats].map((cat) => {
    const rel = catRelease.get(cat) ?? [0, 0, 0, 0];
    const act = catActual.get(cat) ?? [0, 0, 0, 0];
    return {
      category: cat,
      targetPcs: pcConversion.targetPcsByCategory.get(cat) ?? 0,
      w1Release: Math.round(rel[0]), w1Actual: act[0],
      w2Release: Math.round(rel[1]), w2Actual: act[1],
      w3Release: Math.round(rel[2]), w3Actual: act[2],
      w4Release: Math.round(rel[3]), w4Actual: act[3],
      totalRelease: Math.round(rel.reduce((s, v) => s + v, 0)),
      totalActual:  act.reduce((s, v) => s + v, 0),
      produced: act.reduce((s, v) => s + v, 0),
      released: Math.round(rel.reduce((s, v) => s + v, 0)),
      notStarted: act.reduce((s, v) => s + v, 0) === 0 && rel.reduce((s, v) => s + v, 0) > 0,
    };
  }).sort((a, b) => b.totalRelease - a.totalRelease);

  return {
    catActual, catRelease, unmappedByWeek, totalMapped, totalUnmapped, totalProduced,
    lastDataDate, categoriesDetailed,
    unmappedPtmt: { byWeek: [...unmappedByWeek] as number[], total: totalUnmapped, topCodes },
    p2,
  };
}

export interface MonitoringBundle {
  month: string;
  calendarPlant: ReturnType<typeof buildCalendarModel>;
  plantPace: ReturnType<typeof computePaceMetrics>;
  categoryPaces: CategoryPace[];
  machineQuality: ReturnType<typeof computeMachineQuality>[];
  needsReviewItems: { itemCode: string; colour: string; category: string }[];
  stockoutItems: { itemCode: string; colour: string; category: string; stock: number; pendingOrder: number }[];
  lastDataDate: string | null;
  thresholds: WarningThresholds;
  dataAvailable: boolean;
  /** Set when the PTMT monthly workbook could not be resolved (machine kg feed). */
  sourceError: string | null;
  /** Plan target expressed in pieces. */
  plantTargetPcs: number;
  /** Produced pieces matched to plan items (from ANUJ Production sheet). */
  producedToDatePcs: number;
  /** Total produced pieces including unmapped items. */
  totalProducedPcs: number;
  /** Actual kg output from Report-5 (machine-level; independent of piece plan). */
  outputToDateKg: number;
  /** Non-Sunday working days elapsed to lastDataDate. */
  workingDaysElapsed: number;
  workingDays: number;
  workingDaysSource: "configured" | "observed" | "derived";
  workedSundayDates: string[];
  idleWeekdayDates: string[];
  /** Produced pieces per working day. */
  runRatePerDay: number;
  /** Unmapped production (codes not in plan). */
  unmappedPtmt: PtmtActuals["unmappedPtmt"];
  /** W1–W4 weekly summary rows. */
  weeks: {
    week: number; label: string; startDate: string; endDate: string;
    release: number; mapped: number; unmapped: number; actual: number;
    wkAttPct: number | null;
    cumRelease: number; cumMapped: number; cumTotal: number; cumAttPct: number | null;
  }[];
  /** Per-category data with W1–W4 release + actual breakdown. */
  categoriesDetailed: PtmtActuals["categoriesDetailed"];
}

export async function buildMonitoringBundle(month: string): Promise<MonitoringBundle> {
  // PTMT monthly workbook (Report-5 machine kg). Resolution failure is loud in
  // logs but must not hide piece-level actuals, which come from the PRODUCTION
  // mirror sheet — machine kg is a separate KPI.
  let sheetId: string | null = null;
  let workbookResolutionError: string | null = null;
  try {
    sheetId = await getWorkbookIdForMonth("PTMT-Machine", month);
  } catch (err) {
    workbookResolutionError = err instanceof Error ? err.message : String(err);
    logger.error({ month, err: workbookResolutionError }, "monitoring: PTMT workbook resolution failed");
  }
  const [planItems, config, thresholds, overrides, actuals] = await Promise.all([
    buildPlanItems(month),
    loadConfig(month),
    loadThresholds(),
    loadOverridesForMonth(month),
    // PTMT piece-level actuals: same Google Sheet the corrective engine reads,
    // so monitoring producedToDate will agree with corrective producedToDate.
    fetchDailyActuals(month).catch((err) => {
      logger.warn({ err, month }, "monitoring: failed to fetch PTMT daily actuals");
      return [] as DailyActualRow[];
    }),
  ]);

  // Plan targets in pieces (no BOM weights stored for PTMT items).
  const pcConversion = convertTargetsToPcs(planItems);

  // Aggregate actuals by category + week.
  const ptmtActuals = computePtmtActuals(planItems, actuals, pcConversion);

  let report5Machines: Awaited<ReturnType<typeof parseReport5>>["machines"] = [];
  let report5LastDate: string | null = null;
  let machineDataAvailable = true;
  if (!sheetId) {
    machineDataAvailable = false;
    logger.warn({ month }, "monitoring: no PTMT daily workbook resolved for month — machine kg unavailable");
  } else {
    try {
      const result = await parseReport5(sheetId, month);
      report5Machines = result.machines;
      report5LastDate = result.lastDataDate;
    } catch (err) {
      machineDataAvailable = false;
      workbookResolutionError = `Report-5 machine data unavailable: ${err instanceof Error ? err.message : String(err)}`;
      logger.error({ err, month, sheetId }, "monitoring: failed to parse Report-5");
    }
  }

  // lastDataDate: prefer ANUJ Production (the piece-plan source) over Report-5.
  const lastDataDate = ptmtActuals.lastDataDate ?? report5LastDate;
  // Data is available when either the piece actuals or the machine report have rows.
  const dataAvailable = machineDataAvailable || lastDataDate !== null;

  const lifecycle = resolvePlantMonthLifecycle(month).state;
  const snapshotDate = config.snapshotDate ?? lastDataDate;
  const positiveDates = actuals
    .filter((row) => row.qty > 0)
    .map((row) => row.date);
  const workingDaysResolution = resolveWorkingDays(
    month,
    config.workingDaysSource === "configured" ? config.workingDays : null,
    positiveDates,
    snapshotDate,
    lifecycle,
  );
  const dailyByDate = new Map<string, number>();
  for (const row of actuals) dailyByDate.set(row.date, (dailyByDate.get(row.date) ?? 0) + row.qty);
  const elapsedDays = actuals.length > 0
    ? buildElapsedProductionDays(month, dailyByDate, snapshotDate)
    : [];
  const elapsed = lifecycle === "closed" || lifecycle === "grace"
    ? workingDaysResolution.workingDays
    : Math.min(elapsedDays.length, workingDaysResolution.workingDays);
  const calendarPlant = buildCalendarModel(workingDaysResolution.workingDays, elapsed);

  const outputToDateKg = report5Machines
    .filter((m) => !m.isGrinder)
    .reduce((sum, m) => sum + m.days.reduce((s, d) => s + d.outputKg, 0), 0);

  // Now that we have real produced pcs, both plan and actual are in the same unit.
  const plantPace = computePaceMetrics(pcConversion.plantTargetPcs, ptmtActuals.totalMapped, calendarPlant);

  const categoryPaces: CategoryPace[] = [...pcConversion.targetPcsByCategory.entries()].map(([category, targetPcs]) => {
    const actArr = ptmtActuals.catActual.get(category) ?? [0, 0, 0, 0];
    const producedPcs = actArr.reduce((s, v) => s + v, 0);
    return { category, pace: computePaceMetrics(targetPcs, producedPcs, calendarPlant) };
  });

  const machineQuality = report5Machines.map((m) => computeMachineQuality(m, overrides.get(m.machineId)));

  const stockoutItems = planItems
    .filter((i) => i.stock < i.pendingOrder)
    .map((i) => ({
      itemCode: i.itemCode,
      colour: i.colour,
      category: i.category,
      stock: i.stock,
      pendingOrder: i.pendingOrder,
    }));

  // ── W1–W4 weekly summary rows (same shape as Plumbing weeks) ─────────────
  const [yr, mo] = month.split("-").map(Number);
  const lastDayOfMonth = new Date(yr, mo, 0).getDate();
  const p2 = ptmtActuals.p2;
  const weekCalendar = [
    { week: 1, label: `W1 (${mo}/1–7)`,           startDay: 1,  endDay: 7,              startDate: `${yr}-${p2(mo)}-01`, endDate: `${yr}-${p2(mo)}-07` },
    { week: 2, label: `W2 (${mo}/8–14)`,           startDay: 8,  endDay: 14,             startDate: `${yr}-${p2(mo)}-08`, endDate: `${yr}-${p2(mo)}-14` },
    { week: 3, label: `W3 (${mo}/15–21)`,          startDay: 15, endDay: 21,             startDate: `${yr}-${p2(mo)}-15`, endDate: `${yr}-${p2(mo)}-21` },
    { week: 4, label: `W4 (${mo}/22–${lastDayOfMonth})`, startDay: 22, endDay: lastDayOfMonth, startDate: `${yr}-${p2(mo)}-22`, endDate: `${yr}-${p2(mo)}-${p2(lastDayOfMonth)}` },
  ];

  const plantRelease: [number, number, number, number] = [0, 0, 0, 0];
  const plantMapped:  [number, number, number, number] = [0, 0, 0, 0];
  for (const [, arr] of ptmtActuals.catRelease) for (let i = 0; i < 4; i++) plantRelease[i] += arr[i];
  for (const [, arr] of ptmtActuals.catActual)  for (let i = 0; i < 4; i++) plantMapped[i]  += arr[i];
  for (let i = 0; i < 4; i++) plantRelease[i] = Math.round(plantRelease[i]);

  // Non-Sunday working days elapsed through lastDataDate
  const workingDaysElapsed = elapsed;
  const workedSundayDates = elapsedDays.filter(
    (date) => new Date(`${date}T00:00:00Z`).getUTCDay() === 0 && (dailyByDate.get(date) ?? 0) > 0,
  );
  const idleWeekdayDates = lastDataDate
    ? [...Array(parseInt((lifecycle === "closed" || lifecycle === "grace" ? `${month}-${p2(lastDayOfMonth)}` : snapshotDate ?? lastDataDate).slice(8), 10))]
      .map((_, index) => `${month}-${p2(index + 1)}`)
      .filter((date) => new Date(`${date}T00:00:00Z`).getUTCDay() !== 0 && (dailyByDate.get(date) ?? 0) <= 0)
    : [];

  const today = new Date().toISOString().slice(0, 10);
  let cumRelease = 0, cumMapped = 0, cumTotal = 0;
  const weeks = weekCalendar.map((wk, i) => {
    const release  = plantRelease[i]!;
    const mapped   = plantMapped[i]!;
    const unmapped = ptmtActuals.unmappedByWeek[i]!;
    const actual   = mapped + unmapped;
    cumRelease += release;
    cumMapped  += mapped;
    cumTotal   += actual;
    const wkStarted = today.slice(0, 7) === month && today >= wk.startDate;
    const cumAttPct = cumRelease > 0 && wkStarted ? Math.round((cumMapped / cumRelease) * 1000) / 10 : null;
    const wkAttPct  = release   > 0 && wkStarted ? Math.round((mapped    / release)    * 1000) / 10 : null;
    return { week: wk.week, label: wk.label, startDate: wk.startDate, endDate: wk.endDate,
      release, mapped, unmapped, actual, wkAttPct,
      cumRelease, cumMapped, cumTotal, cumAttPct };
  });

  const runRatePerDay = workingDaysElapsed > 0 ? Math.round(ptmtActuals.totalProduced / workingDaysElapsed) : 0;

  return {
    month,
    calendarPlant,
    plantPace,
    categoryPaces,
    machineQuality,
    needsReviewItems: [],   // piece-based: no weight lookup → no items flagged
    stockoutItems,
    lastDataDate,
    thresholds,
    dataAvailable,
    sourceError: workbookResolutionError,
    plantTargetPcs: pcConversion.plantTargetPcs,
    producedToDatePcs: ptmtActuals.totalMapped,
    totalProducedPcs: ptmtActuals.totalProduced,
    outputToDateKg,
    workingDaysElapsed,
    workingDays: workingDaysResolution.workingDays,
    workingDaysSource: workingDaysResolution.workingDaysSource,
    workedSundayDates,
    idleWeekdayDates,
    runRatePerDay,
    unmappedPtmt: ptmtActuals.unmappedPtmt,
    weeks,
    categoriesDetailed: ptmtActuals.categoriesDetailed,
  };
}

router.get("/monitoring/dashboard", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }

  const segment = normalizePlantSegment(req.query.segment);
  if (segment === null) {
    res.status(400).json({
      error: "Unrecognised segment",
      value: String(req.query.segment),
      recognised: PLANT_SEGMENTS,
    });
    return;
  }

  // ── Plumbing: pieces-based data from Sheet3 ────────────────────────────────
  if (segment === "Plumbing") {
    let data: Awaited<ReturnType<typeof getPlumbingMonitoringPayloadCached>>;
    try {
      data = await getPlumbingMonitoringPayloadCached(month);
    } catch (err) {
      handlePlanError(res, err);
      return;
    }
    res.json({
      month,
      segment: "PLUMBING",
      dataAvailable: !!data.lastDataDate,
      lastDataDate: data.lastDataDate,
       workingDaysElapsed: data.workingDaysElapsed,
       workingDays: data.workingDays,
       workingDaysSource: data.workingDaysSource,
       workedSundayDates: data.workedSundayDates,
       idleWeekdayDates: data.idleWeekdayDates,
      plant: {
        produced: data.totalProduced,
        mapped: data.totalMapped,
        unmapped: data.totalUnmapped,
        runRatePerDay: data.runRatePerDay,
      },
      categories: data.categories,
       items: data.items,
      weeks: data.weeks,
      unmapped: data.unmapped,
    });
    return;
  }

  // ── PTMT: piece-based plan targets + piece-based actuals from ANUJ Production ─
  // Keep input failures consistent with the Plumbing monitoring branch. In
  // particular, pending-join reconciliation must remain a named 422 rather
  // than becoming an opaque 500 from this route.
  let bundle: MonitoringBundle;
  try {
    bundle = await buildMonitoringBundle(month);
  } catch (err) {
    handlePlanError(res, err);
    return;
  }
  res.json({
    month,
    segment: "PTMT",
    dataAvailable: bundle.dataAvailable,
    sourceError: bundle.sourceError,
    lastDataDate: bundle.lastDataDate,
    workingDaysElapsed: bundle.workingDaysElapsed,
    workingDays: bundle.workingDays,
    workingDaysSource: bundle.workingDaysSource,
    workedSundayDates: bundle.workedSundayDates,
    idleWeekdayDates: bundle.idleWeekdayDates,
    calendar: bundle.calendarPlant,
    plant: {
      ...bundle.plantPace,
      // targetKg slot in PaceMetrics holds the piece plan total (field renamed for clarity below).
      targetPcs: bundle.plantTargetPcs,
      produced: bundle.producedToDatePcs,    // mapped pcs (for plan attainment)
      mapped: bundle.producedToDatePcs,
      unmapped: bundle.totalProducedPcs - bundle.producedToDatePcs,
      totalProduced: bundle.totalProducedPcs,
      runRatePerDay: bundle.runRatePerDay,
      outputToDateKg: bundle.outputToDateKg, // machine-level kg from Report-5 (separate KPI)
      ragBand: ragBand(bundle.plantPace.paceIndex),
    },
    // Categories: merge pace metrics with W1–W4 detail (same shape as Plumbing categories)
    categories: bundle.categoriesDetailed.map((c) => {
      const pace = bundle.categoryPaces.find((p) => p.category === c.category);
      return {
        ...c,
        target: c.targetPcs,            // alias kept for backward compat
        requiredPerDay: pace?.pace.requiredPerDay ?? 0,
        ragBand: ragBand(pace?.pace.paceIndex ?? 0),
      };
    }),
    weeks: bundle.weeks,
    unmapped: bundle.unmappedPtmt,
    needsReviewItems: bundle.needsReviewItems,
    warningCount: buildBehindPaceAndWillMissWarnings("Plant", bundle.plantPace, bundle.thresholds).length,
    utilisationHeadline: (() => {
      const active = bundle.machineQuality.filter((m) => m.utilisationPct !== null);
      if (active.length === 0) return null;
      const avg = active.reduce((s, m) => s + (m.utilisationPct ?? 0), 0) / active.length;
      return `${avg.toFixed(1)}%`;
    })(),
  });
});

router.get("/monitoring/velocity", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const bundle = await buildMonitoringBundle(month);
  res.json({
    month,
    plant: { ...bundle.plantPace, ragBand: ragBand(bundle.plantPace.paceIndex) },
    categories: bundle.categoryPaces.map((c) => ({ category: c.category, ...c.pace, ragBand: ragBand(c.pace.attainmentPct) })),
  });
});

export function buildWarningsList(month: string, bundle: MonitoringBundle): Warning[] {
  const warnings: Warning[] = [
    ...buildBehindPaceAndWillMissWarnings("Plant", bundle.plantPace, bundle.thresholds),
    ...bundle.categoryPaces.flatMap((c) => buildBehindPaceAndWillMissWarnings(c.category, c.pace, bundle.thresholds)),
    ...buildQualityWarnings(bundle.machineQuality, bundle.thresholds),
    ...buildStockoutWarnings(bundle.stockoutItems),
    ...bundle.needsReviewItems.map((i) => ({
      code: "DATA_MISSING" as const,
      severity: "info" as const,
      scope: `${i.itemCode}${i.colour ? " / " + i.colour : ""}`,
      message: `${i.itemCode} has no weight entered — excluded from kg attainment`,
      value: null,
      threshold: null,
      source: "data",
    })),
  ];
  if (!bundle.dataAvailable) {
    warnings.push({
      code: "DATA_MISSING",
      severity: "info",
      scope: "Plant",
      message: `No Report-5 daily data available for ${month}`,
      value: null,
      threshold: null,
      source: "data",
    });
  }
  const severityOrder = { critical: 0, high: 1, medium: 2, info: 3 };
  warnings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  return warnings;
}

router.get("/monitoring/warnings", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const bundle = await buildMonitoringBundle(month);
  res.json({ month, warnings: buildWarningsList(month, bundle) });
});

router.get("/monitoring/actions", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const bundle = await buildMonitoringBundle(month);
  const actions = buildRecommendedActions(bundle.plantPace, bundle.categoryPaces, bundle.stockoutItems, bundle.thresholds);
  res.json({ month, actions });
});

router.get("/monitoring/quality", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const bundle = await buildMonitoringBundle(month);
  res.json({ month, dataAvailable: bundle.dataAvailable, machines: bundle.machineQuality });
});

router.get("/monitoring/backlog", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const bundle = await buildMonitoringBundle(month);
  res.json({ month, stockoutItems: bundle.stockoutItems });
});

router.get("/monitoring/export/excel", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const bundle = await buildMonitoringBundle(month);
  const data: MonitoringExportData = {
    month,
    dataAvailable: bundle.dataAvailable,
    lastDataDate: bundle.lastDataDate,
    plant: { ...bundle.plantPace, ragBand: ragBand(bundle.plantPace.paceIndex) },
    categories: bundle.categoryPaces.map((c) => ({
      category: c.category,
      target: c.pace.targetKg,
      requiredPerDay: c.pace.requiredPerDay,
      ragBand: ragBand(c.pace.attainmentPct),
    })),
    warnings: buildWarningsList(month, bundle),
    actions: buildRecommendedActions(bundle.plantPace, bundle.categoryPaces, bundle.stockoutItems, bundle.thresholds),
    machines: bundle.machineQuality,
    stockoutItems: bundle.stockoutItems,
  };
  const buffer = await exportMonitoringExcel(data);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="PTMT_Monitoring_${month}_${exportTimestamp()}.xlsx"`);
  res.send(buffer);
});

router.get("/monitoring/export/pdf", async (req, res): Promise<void> => {
  res.status(503).json({ error: "PDF export is not available in this deployment" });
  return;
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const bundle = await buildMonitoringBundle(month);
  const data: MonitoringExportData = {
    month,
    dataAvailable: bundle.dataAvailable,
    lastDataDate: bundle.lastDataDate,
    plant: { ...bundle.plantPace, ragBand: ragBand(bundle.plantPace.paceIndex) },
    categories: bundle.categoryPaces.map((c) => ({
      category: c.category,
      target: c.pace.targetKg,
      requiredPerDay: c.pace.requiredPerDay,
      ragBand: ragBand(c.pace.attainmentPct),
    })),
    warnings: buildWarningsList(month, bundle),
    actions: buildRecommendedActions(bundle.plantPace, bundle.categoryPaces, bundle.stockoutItems, bundle.thresholds),
    machines: bundle.machineQuality,
    stockoutItems: bundle.stockoutItems,
  };
  const buffer = await exportMonitoringPdf(data);
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="PTMT_Monitoring_${month}_${exportTimestamp()}.pdf"`);
  res.send(buffer);
});

// --- Data-input CRUD: item weights, ideal-hours overrides, thresholds ---

router.get("/monitoring/weights", async (_req, res): Promise<void> => {
  const rows = await db.select().from(itemWeightsTable);
  res.json(rows);
});

router.put("/monitoring/weights", async (req, res): Promise<void> => {
  const { itemCode, colour, weightKg } = req.body ?? {};
  if (!itemCode) {
    res.status(400).json({ error: "itemCode is required" });
    return;
  }
  const normalizedColour = colour ?? "";
  const [existing] = await db
    .select()
    .from(itemWeightsTable)
    .where(and(eq(itemWeightsTable.itemCode, itemCode), eq(itemWeightsTable.colour, normalizedColour)));
  if (existing) {
    await db
      .update(itemWeightsTable)
      .set({ weightKg: weightKg === null || weightKg === undefined ? null : String(weightKg) })
      .where(eq(itemWeightsTable.id, existing.id));
  } else {
    await db.insert(itemWeightsTable).values({
      itemCode,
      colour: normalizedColour,
      weightKg: weightKg === null || weightKg === undefined ? null : String(weightKg),
    });
  }
  res.json({ ok: true });
});

router.get("/monitoring/ideal-hours-overrides", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  const rows = month
    ? await db.select().from(idealHoursOverridesTable).where(eq(idealHoursOverridesTable.month, month))
    : await db.select().from(idealHoursOverridesTable);
  res.json(rows);
});

router.put("/monitoring/ideal-hours-overrides", async (req, res): Promise<void> => {
  const { machineId, month, hours } = req.body ?? {};
  if (!machineId || !month || hours === undefined) {
    res.status(400).json({ error: "machineId, month, hours are required" });
    return;
  }
  const [existing] = await db
    .select()
    .from(idealHoursOverridesTable)
    .where(and(eq(idealHoursOverridesTable.machineId, machineId), eq(idealHoursOverridesTable.month, month)));
  if (existing) {
    await db.update(idealHoursOverridesTable).set({ hours: String(hours) }).where(eq(idealHoursOverridesTable.id, existing.id));
  } else {
    await db.insert(idealHoursOverridesTable).values({ machineId, month, hours: String(hours) });
  }
  res.json({ ok: true });
});

router.get("/monitoring/thresholds", async (_req, res): Promise<void> => {
  const thresholds = await loadThresholds();
  res.json(thresholds);
});

router.put("/monitoring/thresholds", async (req, res): Promise<void> => {
  const body = req.body ?? {};
  const [existing] = await db
    .select()
    .from(monitoringThresholdsTable)
    .where(eq(monitoringThresholdsTable.code, "default"));
  if (existing) {
    await db
      .update(monitoringThresholdsTable)
      .set({ thresholdJson: body, updatedAt: new Date() })
      .where(eq(monitoringThresholdsTable.code, "default"));
  } else {
    await db.insert(monitoringThresholdsTable).values({ code: "default", thresholdJson: body });
  }
  res.json({ ok: true });
});

router.get("/monitoring/config", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  const segment = normalizePlantSegment(req.query.segment);
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  if (!segment) {
    res.status(400).json({ error: "segment must be PTMT or Plumbing" });
    return;
  }
  const [row] = await db.select().from(monitoringConfigTable).where(and(
    eq(monitoringConfigTable.month, month),
    eq(monitoringConfigTable.segment, segment),
  ));
  const workingDaysConfig = resolveWorkingDays(month, row?.workingDays);
  res.json({
    month,
    segment,
    workingDays: workingDaysConfig.workingDays,
    workingDaysSource: workingDaysConfig.workingDaysSource,
    shiftsPerDay: row?.shiftsPerDay ?? 2,
    shiftHours: row?.shiftHours ?? 12,
    snapshotDate: row?.snapshotDate ?? null,
  });
});

router.put("/monitoring/config", async (req, res): Promise<void> => {
  const { month, workingDays, shiftsPerDay, shiftHours, snapshotDate } = req.body ?? {};
  const segment = normalizePlantSegment(req.body?.segment);
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  if (!segment) {
    res.status(400).json({ error: "segment must be PTMT or Plumbing" });
    return;
  }
  const [existing] = await db.select().from(monitoringConfigTable).where(and(
    eq(monitoringConfigTable.month, month),
    eq(monitoringConfigTable.segment, segment),
  ));
  const values = {
    workingDays: workingDays ?? existing?.workingDays ?? null,
    shiftsPerDay: shiftsPerDay ?? existing?.shiftsPerDay ?? 2,
    shiftHours: shiftHours ?? existing?.shiftHours ?? 12,
    snapshotDate: snapshotDate ?? existing?.snapshotDate ?? null,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(monitoringConfigTable).set(values).where(and(
      eq(monitoringConfigTable.month, month),
      eq(monitoringConfigTable.segment, segment),
    ));
  } else {
    await db.insert(monitoringConfigTable).values({ month, segment, ...values });
  }
  res.json({ ok: true });
});

export default router;
