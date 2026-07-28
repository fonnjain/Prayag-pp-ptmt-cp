import { Router, type IRouter } from "express";
import {
  db,
  itemWeightsTable,
  idealHoursOverridesTable,
  monitoringThresholdsTable,
  monitoringConfigTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { buildPlanItems, computePlumbingMonitoringPayload } from "./plan";
import { parseReport5 } from "../lib/report5";
import { getWorkbookIdForMonth } from "../lib/sheets";
import {
  buildCalendarModel,
  countWorkingDaysElapsed,
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
  type Warning,
} from "../lib/monitoring-calc";
import { logger } from "../lib/logger";
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
  const [row] = await db.select().from(monitoringConfigTable).where(eq(monitoringConfigTable.month, month));
  return {
    workingDays: row?.workingDays ?? 27,
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
  /** Plan target expressed in pieces (plan items have no BOM weight data for PTMT). */
  plantTargetPcs: number;
  /** Actual kg output from Report-5 (machine-level; independent of piece plan). */
  outputToDateKg: number;
}

export async function buildMonitoringBundle(month: string): Promise<MonitoringBundle> {
  const sheetId = await getWorkbookIdForMonth("PTMT", month);
  const [planItems, config, thresholds, overrides] = await Promise.all([
    buildPlanItems(month),
    loadConfig(month),
    loadThresholds(),
    loadOverridesForMonth(month),
  ]);

  // PTMT monitoring is piece-based: item weights are not stored in the monitoring
  // weight table, so convertTargetsToKg would flag every item as needsReview and
  // produce targetKg=0.  Use convertTargetsToPcs instead so category paces and
  // the RAG band are computed from the piece plan.
  const pcConversion = convertTargetsToPcs(planItems);

  let report5Machines: Awaited<ReturnType<typeof parseReport5>>["machines"] = [];
  let lastDataDate: string | null = null;
  let dataAvailable = true;
  if (!sheetId) {
    dataAvailable = false;
    logger.warn({ month }, "monitoring: no PTMT daily workbook file ID configured for month");
  } else {
    try {
      const result = await parseReport5(sheetId, month);
      report5Machines = result.machines;
      lastDataDate = result.lastDataDate;
    } catch (err) {
      dataAvailable = false;
      logger.error({ err, month }, "monitoring: failed to parse Report-5");
    }
  }

  const elapsed = config.snapshotDate
    ? countWorkingDaysElapsed(month, config.snapshotDate)
    : countWorkingDaysElapsed(month, lastDataDate);
  const calendarPlant = buildCalendarModel(config.workingDays, elapsed);

  const outputToDateKg = report5Machines
    .filter((m) => !m.isGrinder)
    .reduce((sum, m) => sum + m.days.reduce((s, d) => s + d.outputKg, 0), 0);

  // plantPace.targetKg slot holds the piece total (no kg equivalent available).
  // outputToDateKg from Report-5 is stored separately and exposed in the response.
  const plantPace = computePaceMetrics(pcConversion.plantTargetPcs, 0, calendarPlant);

  const categoryPaces: CategoryPace[] = [...pcConversion.targetPcsByCategory.entries()].map(([category, targetPcs]) => ({
    category,
    // Show plan burn-down only; produced pcs by category not available from Report-5.
    pace: computePaceMetrics(targetPcs, 0, calendarPlant),
  }));

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

  return {
    month,
    calendarPlant,
    plantPace,
    categoryPaces,
    machineQuality,
    needsReviewItems: [],  // piece-based: no weight lookup → no items flagged
    stockoutItems,
    lastDataDate,
    thresholds,
    dataAvailable,
    plantTargetPcs: pcConversion.plantTargetPcs,
    outputToDateKg,
  };
}

router.get("/monitoring/dashboard", async (req, res): Promise<void> => {
  const month = String(req.query.month ?? "");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }

  const segment = String(req.query.segment ?? "PTMT");

  // ── Plumbing: pieces-based data from Sheet3 ────────────────────────────────
  if (segment.toUpperCase() === "PLUMBING") {
    const data = await computePlumbingMonitoringPayload(month);
    res.json({
      month,
      segment: "PLUMBING",
      dataAvailable: !!data.lastDataDate,
      lastDataDate: data.lastDataDate,
      workingDaysElapsed: data.workingDaysElapsed,
      plant: {
        produced: data.totalProduced,
        mapped: data.totalMapped,
        unmapped: data.totalUnmapped,
        runRatePerDay: data.runRatePerDay,
      },
      categories: data.categories,
      weeks: data.weeks,
      unmapped: data.unmapped,
    });
    return;
  }

  // ── PTMT: piece-based plan targets + kg-based actuals from Report-5 ─────────
  const bundle = await buildMonitoringBundle(month);
  res.json({
    month,
    segment: "PTMT",
    dataAvailable: bundle.dataAvailable,
    lastDataDate: bundle.lastDataDate,
    calendar: bundle.calendarPlant,
    plant: {
      ...bundle.plantPace,
      // targetKg slot holds the piece plan total (no per-item kg weights for PTMT).
      // targetPcs is the explicit alias; outputToDateKg is the machine-level actuals.
      targetPcs: bundle.plantTargetPcs,
      outputToDateKg: bundle.outputToDateKg,
      ragBand: ragBand(bundle.plantPace.paceIndex),
    },
    categories: bundle.categoryPaces.map((c) => ({
      category: c.category,
      target: c.pace.targetKg,       // holds targetPcs (piece plan for this category)
      targetPcs: c.pace.targetKg,    // explicit alias
      requiredPerDay: c.pace.requiredPerDay,
      ragBand: ragBand(c.pace.attainmentPct),
    })),
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
  res.setHeader("Content-Disposition", `attachment; filename="PTMT_Monitoring_${month}.xlsx"`);
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
  res.setHeader("Content-Disposition", `attachment; filename="PTMT_Monitoring_${month}.pdf"`);
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
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const config = await loadConfig(month);
  res.json({ month, ...config });
});

router.put("/monitoring/config", async (req, res): Promise<void> => {
  const { month, workingDays, shiftsPerDay, shiftHours, snapshotDate } = req.body ?? {};
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  const [existing] = await db.select().from(monitoringConfigTable).where(eq(monitoringConfigTable.month, month));
  const values = {
    workingDays: workingDays ?? existing?.workingDays ?? 27,
    shiftsPerDay: shiftsPerDay ?? existing?.shiftsPerDay ?? 2,
    shiftHours: shiftHours ?? existing?.shiftHours ?? 12,
    snapshotDate: snapshotDate ?? existing?.snapshotDate ?? null,
    updatedAt: new Date(),
  };
  if (existing) {
    await db.update(monitoringConfigTable).set(values).where(eq(monitoringConfigTable.month, month));
  } else {
    await db.insert(monitoringConfigTable).values({ month, ...values });
  }
  res.json({ ok: true });
});

export default router;
