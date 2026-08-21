import { Router, type IRouter } from "express";
import { launchBrowser } from "../lib/browser";
import { exportTimestamp } from "../lib/export-filename";
import { db, plantConfigsTable, plantSourceConfigsTable, plantIngestionCacheTable, plantMonthSnapshotsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { DEFAULT_PLANT_WARNING_THRESHOLDS, type PlantWarningThresholds } from "../lib/plant-warnings";
import { captureClosedPlantMonth, computeLifecyclePlantMonitoring } from "../lib/plant-monitoring";
import { resolvePlantMonthLifecycle, resolveWorkingDays } from "../lib/plant-lifecycle";
import { logger } from "../lib/logger";
import type { MonitoringSegment } from "../lib/plant-monitoring";
const router: IRouter = Router();

// The dashboard asks for the bundle and weekly summary together. Cache the full
// shared computation so a cold page visit never starts two independent Sheet +
// plan rebuilds for the same month.
type PlantMonitoringResult = Awaited<ReturnType<typeof computeLifecyclePlantMonitoring>>;
type MonitoringCacheEntry = {
  result: PlantMonitoringResult;
  lifecycle: ReturnType<typeof resolvePlantMonthLifecycle>["state"];
  ts: number;
};
const monitoringCache = new Map<string, MonitoringCacheEntry>();
const monitoringInFlight = new Map<string, {
  lifecycle: ReturnType<typeof resolvePlantMonthLifecycle>["state"];
  promise: Promise<PlantMonitoringResult>;
}>();
const PLANT_MONITORING_CACHE_TTL_MS = 5 * 60 * 1000;
let plantMonitoringCacheEpoch = 0;
let computePlantMonitoringForCache = computeLifecyclePlantMonitoring;

export function invalidatePlantBundleCache(month?: string) {
  // Incrementing the epoch prevents a pre-invalidation computation from
  // repopulating the cache after source data or configuration changes.
  plantMonitoringCacheEpoch++;
  if (month) {
    for (const key of monitoringCache.keys()) {
      if (key.endsWith(`:${month}`)) monitoringCache.delete(key);
    }
    for (const key of monitoringInFlight.keys()) {
      if (key.endsWith(`:${month}`)) monitoringInFlight.delete(key);
    }
  } else {
    monitoringCache.clear();
    monitoringInFlight.clear();
  }
}

export function _setPlantMonitoringComputeForTest(
  compute: (month: string) => Promise<PlantMonitoringResult>,
): () => void {
  const previous = computePlantMonitoringForCache;
  computePlantMonitoringForCache = compute;
  return () => {
    computePlantMonitoringForCache = previous;
  };
}

export async function getPlantMonitoringCached(
  month: string,
  segment: MonitoringSegment = "PTMT",
): Promise<PlantMonitoringResult> {
  const lifecycle = resolvePlantMonthLifecycle(month).state;
  const key = `${segment}:${month}`;
  const cached = monitoringCache.get(key);
  if (
    cached
    && cached.lifecycle === lifecycle
    && Date.now() - cached.ts < PLANT_MONITORING_CACHE_TTL_MS
  ) {
    return cached.result;
  }

  const pending = monitoringInFlight.get(key);
  if (pending && pending.lifecycle === lifecycle) {
    return pending.promise;
  }

  const epoch = plantMonitoringCacheEpoch;
  const promise = computePlantMonitoringForCache(month, new Date(), {}, segment)
    .then((result) => {
      if (epoch === plantMonitoringCacheEpoch) {
        monitoringCache.set(key, { result, lifecycle, ts: Date.now() });
      }
      return result;
    })
    .finally(() => {
      if (monitoringInFlight.get(key)?.promise === promise) {
        monitoringInFlight.delete(key);
      }
    });

  monitoringInFlight.set(key, { lifecycle, promise });
  return promise;
}

async function loadPlantConfigRow(month: string, segment = "PTMT") {
  const [row] = await db.select().from(plantConfigsTable).where(and(
    eq(plantConfigsTable.month, month),
    eq(plantConfigsTable.segment, segment),
  ));
  return row ?? null;
}

function loadThresholds(row: { thresholdsJson?: unknown } | null): PlantWarningThresholds {
  if (!row?.thresholdsJson || typeof row.thresholdsJson !== "object") return DEFAULT_PLANT_WARNING_THRESHOLDS;
  const t = row.thresholdsJson as Record<string, unknown>;
  return {
    behindPaceHigh: typeof t.behindPaceHigh === "number" ? t.behindPaceHigh : DEFAULT_PLANT_WARNING_THRESHOLDS.behindPaceHigh,
    behindPaceCritical: typeof t.behindPaceCritical === "number" ? t.behindPaceCritical : DEFAULT_PLANT_WARNING_THRESHOLDS.behindPaceCritical,
    willMissPpGapMedium: typeof t.willMissPpGapMedium === "number" ? t.willMissPpGapMedium : DEFAULT_PLANT_WARNING_THRESHOLDS.willMissPpGapMedium,
    willMissPpGapHigh: typeof t.willMissPpGapHigh === "number" ? t.willMissPpGapHigh : DEFAULT_PLANT_WARNING_THRESHOLDS.willMissPpGapHigh,
    willMissPpGapCritical: typeof t.willMissPpGapCritical === "number" ? t.willMissPpGapCritical : DEFAULT_PLANT_WARNING_THRESHOLDS.willMissPpGapCritical,
    catchupInfeasibleRatio: typeof t.catchupInfeasibleRatio === "number" ? t.catchupInfeasibleRatio : DEFAULT_PLANT_WARNING_THRESHOLDS.catchupInfeasibleRatio,
    categoryLaggingGap: typeof t.categoryLaggingGap === "number" ? t.categoryLaggingGap : DEFAULT_PLANT_WARNING_THRESHOLDS.categoryLaggingGap,
    backloadingIndex: typeof t.backloadingIndex === "number" ? t.backloadingIndex : DEFAULT_PLANT_WARNING_THRESHOLDS.backloadingIndex,
    noProductionDays: typeof t.noProductionDays === "number" ? t.noProductionDays : DEFAULT_PLANT_WARNING_THRESHOLDS.noProductionDays,
  };
}

export async function computePlantBundle(month: string, segment: MonitoringSegment = "PTMT") {
  return (await getPlantMonitoringCached(month, segment)).bundle;
}

// --- GET /plant/bundle ---
router.get("/plant/bundle", async (req, res) => {
  const month = String(req.query.month ?? "");
  const segment = String(req.query.segment ?? "PTMT") as MonitoringSegment;
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month query param required (YYYY-MM)" });
    return;
  }
  try {
    if (segment !== "PTMT" && segment !== "Plumbing") {
      res.status(400).json({ error: "segment must be PTMT or Plumbing" });
      return;
    }
    const { bundle } = await getPlantMonitoringCached(month, segment);
    res.set("Cache-Control", "private, max-age=300").json(bundle);
  } catch (err) {
    logger.error({ err, month }, "plant/bundle failed");
    res.status(500).json({ error: "Failed to compute plant bundle" });
  }
});

// --- GET /plant/trend ---
router.get("/plant/trend", async (req, res) => {
  try {
    const rawMonths = req.query.months as string | undefined;
    const segment = String(req.query.segment ?? "PTMT") as MonitoringSegment;
    if (segment !== "PTMT" && segment !== "Plumbing") {
      res.status(400).json({ error: "segment must be PTMT or Plumbing" });
      return;
    }
    const sourceRows = await db.select().from(plantSourceConfigsTable).where(eq(plantSourceConfigsTable.segment, segment));
    const configRows = await db.select().from(plantConfigsTable).where(eq(plantConfigsTable.segment, segment));
    const snapshotRows = await db
      .select({ month: plantMonthSnapshotsTable.month })
      .from(plantMonthSnapshotsTable)
      .where(and(
        eq(plantMonthSnapshotsTable.planStatus, "monitoring"),
        eq(plantMonthSnapshotsTable.segment, segment),
      ));
    let allMonths = [...new Set([
      ...sourceRows.map((r) => r.month),
      ...configRows.map((r) => r.month),
      ...snapshotRows.map((r) => r.month),
    ])].sort();

    if (rawMonths) {
      if (/^\d+$/.test(rawMonths)) {
        // Numeric: return last N months
        const n = parseInt(rawMonths, 10);
        allMonths = allMonths.slice(-n);
      } else {
        // Comma-separated month list
        const requested = rawMonths.split(",").map((m) => m.trim()).filter(Boolean);
        allMonths = allMonths.filter((m) => requested.includes(m));
      }
    }

    const summaries = await Promise.allSettled(allMonths.map(async (month) => {
      try {
        const bundle = await computePlantBundle(month, segment);
        if (!bundle.targetsAvailable) return null;
        const { plant, categories } = bundle;
        const sortedCats = [...categories].sort((a, b) => (b.attainmentCumPct ?? 0) - (a.attainmentCumPct ?? 0));
        return {
          month,
          attainmentMaxPct: plant.projectedAttainmentPct,
          attainmentMinPct: plant.projectedMinAttainmentPct,
          avgDailyPcs: plant.actualPerDay,
          linearityIndex: plant.linearityIndex,
          producedTotal: plant.producedToDate,
          targetMax: plant.targetMax,
          targetMin: plant.targetMin,
          workingDays: bundle.context.workingDays,
          bestCategory: sortedCats[0]?.category ?? null,
          worstCategory: sortedCats[sortedCats.length - 1]?.category ?? null,
          ragBand: plant.ragBand,
        };
      } catch {
        return null;
      }
    }));

    const data = summaries
      .filter((r) => r.status === "fulfilled" && r.value !== null)
      .map((r) => (r as PromiseFulfilledResult<NonNullable<ReturnType<typeof Object>>>).value);

    res.json({ data });
  } catch (err) {
    logger.error({ err }, "plant/trend failed");
    res.status(500).json({ error: "Failed to compute plant trend" });
  }
});

// --- GET /plant/export/pdf ---
router.get("/plant/export/pdf", async (req, res): Promise<void> => {
  res.status(503).json({ error: "PDF export is not available in this deployment" });
  return;
  const month = String(req.query.month ?? "");
  const section = String(req.query.section ?? "control-board");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  try {
    const bundle = await computePlantBundle(month);
    const { plant, categories, warnings, recommendations, context } = bundle;

    const ragCss = (band: string | null) => band === "green" ? "color:#16a34a" : band === "amber" ? "color:#d97706" : "color:#dc2626";
  const htmlContent = `
<!DOCTYPE html><html><head>
<meta charset="utf-8">
<title>PTMT Plant ${section} — ${month}</title>
<style>
  body { font-family: Arial, sans-serif; font-size: 12px; color: #111; padding: 20px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  .subtitle { color: #666; font-size: 11px; margin-bottom: 20px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 11px; }
  th { background: #f0f0f0; text-align: left; padding: 6px 8px; border-bottom: 2px solid #ccc; }
  td { padding: 5px 8px; border-bottom: 1px solid #e0e0e0; }
  .green { color: #16a34a; } .amber { color: #d97706; } .red { color: #dc2626; }
  .kpi-row { display: flex; gap: 20px; margin-bottom: 20px; }
  .kpi { border: 1px solid #e0e0e0; border-radius: 6px; padding: 10px 16px; flex: 1; }
  .kpi .label { font-size: 10px; color: #666; text-transform: uppercase; }
  .kpi .value { font-size: 22px; font-weight: bold; margin-top: 2px; }
  .section-title { font-size: 14px; font-weight: bold; margin: 20px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
</style>
</head><body>
<h1>PTMT Plant — ${section.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}</h1>
<div class="subtitle">${month} · ${context.elapsed}/${context.workingDays} working days elapsed · snapshot ${context.snapshotDate ?? "n/a"}</div>

<div class="kpi-row">
  <div class="kpi"><div class="label">Produced to Date</div><div class="value">${plant.producedToDate.toLocaleString()} pcs</div></div>
  <div class="kpi"><div class="label">Max PP Attainment</div><div class="value" style="${ragCss(plant.ragBand)}">${plant.attainmentMonthPct?.toFixed(1) ?? "–"}%</div></div>
  <div class="kpi"><div class="label">Cumulative Attainment</div><div class="value">${plant.attainmentCumPct?.toFixed(1) ?? "–"}%</div></div>
  <div class="kpi"><div class="label">Projected End</div><div class="value">${plant.projectedAttainmentPct?.toFixed(1) ?? "–"}%</div></div>
</div>

<div class="section-title">Category Summary</div>
<table>
  <thead><tr><th>Category</th><th>Max PP</th><th>Produced</th><th>Gap</th><th>Cum Att %</th><th>Proj End %</th><th>RAG</th></tr></thead>
  <tbody>
    ${categories.map((c: { category: string; targetMax: number; producedToDate: number; gapPcs: number; attainmentCumPct: number | null; projectedAttainmentPct: number | null; ragBand: string | null }) => `
    <tr>
      <td>${c.category}</td>
      <td>${c.targetMax.toLocaleString()}</td>
      <td>${c.producedToDate.toLocaleString()}</td>
      <td class="${c.gapPcs > 0 ? "red" : "green"}">${c.gapPcs.toLocaleString()}</td>
      <td>${c.attainmentCumPct?.toFixed(1) ?? "–"}%</td>
      <td>${c.projectedAttainmentPct?.toFixed(1) ?? "–"}%</td>
      <td class="${c.ragBand ?? ""}">${(c.ragBand ?? "–").toUpperCase()}</td>
    </tr>`).join("")}
  </tbody>
</table>

${section === "warnings" || section === "control-board" ? `
<div class="section-title">Warnings (${warnings.length})</div>
<table>
  <thead><tr><th>Code</th><th>Severity</th><th>Scope</th><th>Message</th></tr></thead>
  <tbody>
    ${warnings.slice(0, 20).map((w: { code: string; severity: string; scope: string; message: string }) => `<tr><td>${w.code}</td><td class="${w.severity === "critical" || w.severity === "high" ? "red" : "amber"}">${w.severity.toUpperCase()}</td><td>${w.scope}</td><td>${w.message}</td></tr>`).join("")}
    ${warnings.length === 0 ? "<tr><td colspan='4'>No warnings</td></tr>" : ""}
  </tbody>
</table>` : ""}

${section === "control-board" ? `
<div class="section-title">Recommended Actions (${recommendations.length})</div>
<table>
  <thead><tr><th>#</th><th>Code</th><th>Scope</th><th>Action</th><th>Effort</th></tr></thead>
  <tbody>
    ${recommendations.map((r: { priority: number; code: string; scope: string; action: string; effort: string }) => `<tr><td>${r.priority}</td><td>${r.code}</td><td>${r.scope}</td><td>${r.action}</td><td>${r.effort}</td></tr>`).join("")}
  </tbody>
</table>` : ""}

<div style="margin-top: 30px; color: #999; font-size: 10px;">Generated ${new Date().toISOString()} · PTMT Production Performance &amp; Monitoring</div>
</body></html>`;

    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: "networkidle0" });
      const pdf = await page.pdf({ format: "A4", margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" } });
      await browser.close();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="PTMT_Plant_${section}_${month}_${exportTimestamp()}.pdf"`);
      res.send(pdf);
    } catch (err) {
      await browser.close();
      throw err;
    }
  } catch (err) {
    logger.error({ err, month, section }, "plant/export/pdf failed");
    res.status(500).json({ error: "PDF export failed" });
  }
});

// --- GET /plant/config ---
router.get("/plant/config", async (req, res) => {
  const month = String(req.query.month ?? "");
  const segment = String(req.query.segment ?? "PTMT");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month required" });
    return;
  }
  if (segment !== "PTMT" && segment !== "Plumbing") {
    res.status(400).json({ error: "segment must be PTMT or Plumbing" });
    return;
  }
  const row = await loadPlantConfigRow(month, segment);
  const calendar = resolveWorkingDays(month, row?.workingDays);
  const sourceConfigs = await db.select().from(plantSourceConfigsTable).where(eq(plantSourceConfigsTable.segment, segment));
  const thresholds = loadThresholds(row);
  res.json({
    month,
    segment,
    workingDays: calendar.workingDays,
    workingDaysSource: calendar.workingDaysSource,
    shiftsPerDay: row?.shiftsPerDay ?? 2,
    shiftHours: row?.shiftHours ?? 12,
    snapshotDate: row?.snapshotDate ?? null,
    thresholds,
    sourceConfigs,
  });
});

// --- PUT /plant/config (kept for backward compat) + PATCH /plant/config ---
async function handleConfigUpdate(req: import("express").Request, res: import("express").Response) {
  const { month, segment = "PTMT", workingDays, shiftsPerDay, shiftHours, snapshotDate, thresholds } = req.body as {
    month: string;
    segment?: string;
    workingDays?: number | null;
    shiftsPerDay?: number;
    shiftHours?: number;
    snapshotDate?: string | null;
    thresholds?: Record<string, unknown>;
  };
  if (!month) {
    res.status(400).json({ error: "month required" });
    return;
  }
  if (segment !== "PTMT" && segment !== "Plumbing") {
    res.status(400).json({ error: "segment must be PTMT or Plumbing" });
    return;
  }
  const existing = await loadPlantConfigRow(month, segment);
  if (existing) {
    await db.update(plantConfigsTable).set({
      ...(workingDays !== undefined ? { workingDays } : {}),
      ...(shiftsPerDay !== undefined ? { shiftsPerDay } : {}),
      ...(shiftHours !== undefined ? { shiftHours } : {}),
      ...(snapshotDate !== undefined ? { snapshotDate } : {}),
      ...(thresholds !== undefined ? { thresholdsJson: thresholds } : {}),
      updatedAt: new Date(),
    }).where(and(
      eq(plantConfigsTable.month, month),
      eq(plantConfigsTable.segment, segment),
    ));
  } else {
    await db.insert(plantConfigsTable).values({
      month,
      segment,
      workingDays: workingDays ?? null,
      shiftsPerDay: shiftsPerDay ?? 2,
      shiftHours: shiftHours ?? 12,
      snapshotDate: snapshotDate ?? null,
      thresholdsJson: thresholds ?? {},
    });
  }
  invalidatePlantBundleCache(month);
  res.json({ ok: true });
}

router.put("/plant/config", handleConfigUpdate);
router.patch("/plant/config", handleConfigUpdate);

// --- POST /plant/snapshots/backfill ---
router.post("/plant/snapshots/backfill", async (req, res) => {
  const month = String(req.body?.month ?? "");
  const segment = String(req.body?.segment ?? "PTMT") as MonitoringSegment;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    res.status(400).json({ error: "INVALID_MONTH", message: "month required (YYYY-MM)" });
    return;
  }
  if (segment !== "PTMT" && segment !== "Plumbing") {
    res.status(400).json({ error: "INVALID_SEGMENT", message: "segment must be PTMT or Plumbing" });
    return;
  }
  try {
    const result = await captureClosedPlantMonth(month, new Date(), {}, segment);
    if (!result.ok) {
      const status = result.code === "MONTH_NOT_CLOSED" ? 409 : 422;
      res.status(status).json({ error: result.code, message: result.reason, month });
      return;
    }
    invalidatePlantBundleCache(month);
    res.status(201).json({ month, segment, status: "frozen", capturedAt: result.capturedAt });
  } catch (err) {
    logger.error({ err, month }, "plant snapshot backfill failed");
    res.status(500).json({ error: "SNAPSHOT_CAPTURE_FAILED", message: "Failed to capture plant monitoring snapshot." });
  }
});

// --- PUT /plant/source-config ---
router.put("/plant/source-config", async (req, res) => {
  const { month, segment = "PTMT", fileId, notes } = req.body as { month: string; segment?: string; fileId: string; notes?: string };
  if (!month || !fileId) {
    res.status(400).json({ error: "month and fileId required" });
    return;
  }
  if (segment !== "PTMT" && segment !== "Plumbing") {
    res.status(400).json({ error: "segment must be PTMT or Plumbing" });
    return;
  }
  await db.insert(plantSourceConfigsTable).values({ month, segment, fileId, notes: notes ?? null }).onConflictDoUpdate({
    target: [plantSourceConfigsTable.month, plantSourceConfigsTable.segment],
    set: { fileId, notes: notes ?? null },
  });
  invalidatePlantBundleCache(month);
  res.json({ ok: true });
});

// --- POST /plant/cache/invalidate ---
router.post("/plant/cache/invalidate", async (req, res) => {
  const month = String(req.body?.month ?? req.query.month ?? "");
  const segment = String(req.body?.segment ?? req.query.segment ?? "PTMT");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month required (YYYY-MM)" });
    return;
  }
  const lifecycle = resolvePlantMonthLifecycle(month);
  if (lifecycle.state !== "closed") {
    await db.delete(plantIngestionCacheTable).where(and(
      eq(plantIngestionCacheTable.month, month),
      eq(plantIngestionCacheTable.segment, segment),
    ));
  }
  invalidatePlantBundleCache(month);
  logger.info({ month, lifecycle: lifecycle.state }, "plant cache invalidated");
  res.json({ ok: true, frozenSnapshotPreserved: lifecycle.state === "closed" });
});

// --- GET /plant/weekly-summary ---
router.get("/plant/weekly-summary", async (req, res) => {
  const month = String(req.query.month ?? "");
  const segment = String(req.query.segment ?? "PTMT") as MonitoringSegment;
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month query param required (YYYY-MM)" });
    return;
  }
  try {
    if (segment !== "PTMT" && segment !== "Plumbing") {
      res.status(400).json({ error: "segment must be PTMT or Plumbing" });
      return;
    }
    const { weekly } = await getPlantMonitoringCached(month, segment);
    res.set("Cache-Control", "private, max-age=300").json(weekly);
  } catch (err) {
    logger.error({ err, month }, "plant/weekly-summary failed");
    res.status(500).json({ error: "Failed to compute weekly summary" });
  }
});

export default router;
