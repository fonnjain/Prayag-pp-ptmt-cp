import { Router, type IRouter } from "express";
import { db, plantConfigsTable, plantSourceConfigsTable, plantIngestionCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchDailyActuals, fetchMonthlyTargets } from "../lib/plant-ingestion";
import { buildPlantBundle, type PlantBundle } from "../lib/plant-engine";
import { buildPlantWarnings, DEFAULT_PLANT_WARNING_THRESHOLDS, type PlantWarningThresholds } from "../lib/plant-warnings";
import { buildPlantRecommendations } from "../lib/plant-recommendations";
import { logger } from "../lib/logger";
import puppeteer from "puppeteer";

const router: IRouter = Router();

async function loadPlantConfigRow(month: string) {
  const [row] = await db.select().from(plantConfigsTable).where(eq(plantConfigsTable.month, month));
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

async function computeBundle(month: string) {
  const row = await loadPlantConfigRow(month);
  const config = {
    workingDays: row?.workingDays ?? 27,
    shiftsPerDay: row?.shiftsPerDay ?? 2,
    shiftHours: row?.shiftHours ?? 12,
    snapshotDate: row?.snapshotDate ?? null,
    elapsed: 0,
  };
  const [actuals, targets] = await Promise.all([fetchDailyActuals(month), fetchMonthlyTargets(month)]);
  const bundle = buildPlantBundle(month, actuals, targets, config);
  const thresholds = loadThresholds(row);
  const warnings = buildPlantWarnings(bundle, thresholds);
  const recommendations = buildPlantRecommendations(bundle, thresholds);
  return { ...bundle, warnings, recommendations };
}

// --- GET /plant/bundle ---
router.get("/plant/bundle", async (req, res) => {
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month query param required (YYYY-MM)" });
    return;
  }
  try {
    const result = await computeBundle(month);
    res.json(result);
  } catch (err) {
    logger.error({ err, month }, "plant/bundle failed");
    res.status(500).json({ error: "Failed to compute plant bundle" });
  }
});

// --- GET /plant/trend ---
router.get("/plant/trend", async (req, res) => {
  try {
    const sourceRows = await db.select().from(plantSourceConfigsTable);
    const configRows = await db.select().from(plantConfigsTable);
    const allMonths = [...new Set([
      ...sourceRows.map((r) => r.month),
      ...configRows.map((r) => r.month),
    ])].sort();

    const summaries = await Promise.allSettled(allMonths.map(async (month) => {
      try {
        const row = await loadPlantConfigRow(month);
        const config = {
          workingDays: row?.workingDays ?? 27,
          shiftsPerDay: row?.shiftsPerDay ?? 2,
          shiftHours: row?.shiftHours ?? 12,
          snapshotDate: row?.snapshotDate ?? null,
          elapsed: 0,
        };
        const [actuals, targets] = await Promise.all([fetchDailyActuals(month), fetchMonthlyTargets(month)]);
        const bundle = buildPlantBundle(month, actuals, targets, config);
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
          workingDays: config.workingDays,
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
  const month = String(req.query.month ?? "");
  const section = String(req.query.section ?? "control-board");
  if (!month) {
    res.status(400).json({ error: "month is required" });
    return;
  }
  try {
    const bundle = await computeBundle(month);
    const { plant, categories, warnings, recommendations, context } = bundle;

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
  <div class="kpi"><div class="label">Max PP Attainment</div><div class="value class="${plant.ragBand ?? ""}">${plant.attainmentMonthPct?.toFixed(1) ?? "–"}%</div></div>
  <div class="kpi"><div class="label">Cumulative Attainment</div><div class="value">${plant.attainmentCumPct?.toFixed(1) ?? "–"}%</div></div>
  <div class="kpi"><div class="label">Projected End</div><div class="value">${plant.projectedAttainmentPct?.toFixed(1) ?? "–"}%</div></div>
</div>

<div class="section-title">Category Summary</div>
<table>
  <thead><tr><th>Category</th><th>Max PP</th><th>Produced</th><th>Gap</th><th>Cum Att %</th><th>Proj End %</th><th>RAG</th></tr></thead>
  <tbody>
    ${categories.map((c) => `
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
    ${warnings.slice(0, 20).map((w) => `<tr><td>${w.code}</td><td class="${w.severity === "critical" || w.severity === "high" ? "red" : "amber"}">${w.severity.toUpperCase()}</td><td>${w.scope}</td><td>${w.message}</td></tr>`).join("")}
    ${warnings.length === 0 ? "<tr><td colspan='4'>No warnings</td></tr>" : ""}
  </tbody>
</table>` : ""}

${section === "control-board" ? `
<div class="section-title">Recommended Actions (${recommendations.length})</div>
<table>
  <thead><tr><th>#</th><th>Code</th><th>Scope</th><th>Action</th><th>Effort</th></tr></thead>
  <tbody>
    ${recommendations.map((r) => `<tr><td>${r.priority}</td><td>${r.code}</td><td>${r.scope}</td><td>${r.action}</td><td>${r.effort}</td></tr>`).join("")}
  </tbody>
</table>` : ""}

<div style="margin-top: 30px; color: #999; font-size: 10px;">Generated ${new Date().toISOString()} · PTMT Production Performance &amp; Monitoring</div>
</body></html>`;

    const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    try {
      const page = await browser.newPage();
      await page.setContent(htmlContent, { waitUntil: "networkidle0" });
      const pdf = await page.pdf({ format: "A4", margin: { top: "15mm", bottom: "15mm", left: "15mm", right: "15mm" } });
      await browser.close();
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="PTMT_Plant_${section}_${month}.pdf"`);
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
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month required" });
    return;
  }
  const row = await loadPlantConfigRow(month);
  const sourceConfigs = await db.select().from(plantSourceConfigsTable);
  const thresholds = loadThresholds(row);
  res.json({
    month,
    workingDays: row?.workingDays ?? 27,
    shiftsPerDay: row?.shiftsPerDay ?? 2,
    shiftHours: row?.shiftHours ?? 12,
    snapshotDate: row?.snapshotDate ?? null,
    thresholds,
    sourceConfigs,
  });
});

// --- PUT /plant/config (kept for backward compat) + PATCH /plant/config ---
async function handleConfigUpdate(req: import("express").Request, res: import("express").Response) {
  const { month, workingDays, shiftsPerDay, shiftHours, snapshotDate, thresholds } = req.body as {
    month: string;
    workingDays?: number;
    shiftsPerDay?: number;
    shiftHours?: number;
    snapshotDate?: string | null;
    thresholds?: Record<string, unknown>;
  };
  if (!month) {
    res.status(400).json({ error: "month required" });
    return;
  }
  const existing = await loadPlantConfigRow(month);
  if (existing) {
    await db.update(plantConfigsTable).set({
      ...(workingDays !== undefined ? { workingDays } : {}),
      ...(shiftsPerDay !== undefined ? { shiftsPerDay } : {}),
      ...(shiftHours !== undefined ? { shiftHours } : {}),
      ...(snapshotDate !== undefined ? { snapshotDate } : {}),
      ...(thresholds !== undefined ? { thresholdsJson: thresholds } : {}),
      updatedAt: new Date(),
    }).where(eq(plantConfigsTable.month, month));
  } else {
    await db.insert(plantConfigsTable).values({
      month,
      workingDays: workingDays ?? 27,
      shiftsPerDay: shiftsPerDay ?? 2,
      shiftHours: shiftHours ?? 12,
      snapshotDate: snapshotDate ?? null,
      thresholdsJson: thresholds ?? {},
    });
  }
  res.json({ ok: true });
}

router.put("/plant/config", handleConfigUpdate);
router.patch("/plant/config", handleConfigUpdate);

// --- PUT /plant/source-config ---
router.put("/plant/source-config", async (req, res) => {
  const { month, fileId, notes } = req.body as { month: string; fileId: string; notes?: string };
  if (!month || !fileId) {
    res.status(400).json({ error: "month and fileId required" });
    return;
  }
  await db.insert(plantSourceConfigsTable).values({ month, fileId, notes: notes ?? null }).onConflictDoUpdate({
    target: plantSourceConfigsTable.month,
    set: { fileId, notes: notes ?? null },
  });
  res.json({ ok: true });
});

// --- POST /plant/cache/invalidate ---
router.post("/plant/cache/invalidate", async (req, res) => {
  const month = String(req.body?.month ?? req.query.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month required (YYYY-MM)" });
    return;
  }
  await db.delete(plantIngestionCacheTable).where(eq(plantIngestionCacheTable.month, month));
  logger.info({ month }, "plant cache invalidated");
  res.json({ ok: true });
});

export default router;
