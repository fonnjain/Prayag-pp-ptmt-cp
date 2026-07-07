import { Router, type IRouter } from "express";
import { db, plantConfigsTable, plantSourceConfigsTable, plantIngestionCacheTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { fetchDailyActuals, fetchMonthlyTargets } from "../lib/plant-ingestion";
import { buildPlantBundle, type PlantBundle } from "../lib/plant-engine";
import { buildPlantWarnings, DEFAULT_PLANT_WARNING_THRESHOLDS } from "../lib/plant-warnings";
import { buildPlantRecommendations } from "../lib/plant-recommendations";
import { logger } from "../lib/logger";

const router: IRouter = Router();

async function loadPlantConfig(month: string) {
  const [row] = await db.select().from(plantConfigsTable).where(eq(plantConfigsTable.month, month));
  return {
    workingDays: row?.workingDays ?? 27,
    shiftsPerDay: row?.shiftsPerDay ?? 2,
    shiftHours: row?.shiftHours ?? 12,
    snapshotDate: row?.snapshotDate ?? null,
    elapsed: 0,
  };
}

router.get("/plant/bundle", async (req, res) => {
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month query param required (YYYY-MM)" });
    return;
  }
  try {
    const config = await loadPlantConfig(month);
    const [actuals, targets] = await Promise.all([
      fetchDailyActuals(month),
      fetchMonthlyTargets(month),
    ]);
    const bundle = buildPlantBundle(month, actuals, targets, config);
    const thresholds = DEFAULT_PLANT_WARNING_THRESHOLDS;
    const warnings = buildPlantWarnings(bundle, thresholds);
    const recommendations = buildPlantRecommendations(bundle, thresholds);
    const result: PlantBundle & { warnings: typeof warnings; recommendations: typeof recommendations } = {
      ...bundle,
      warnings,
      recommendations,
    };
    res.json(result);
  } catch (err) {
    logger.error({ err, month }, "plant/bundle failed");
    res.status(500).json({ error: "Failed to compute plant bundle" });
  }
});

router.get("/plant/config", async (req, res) => {
  const month = String(req.query.month ?? "");
  if (!/^\d{4}-\d{2}$/.test(month)) {
    res.status(400).json({ error: "month required" });
    return;
  }
  const [row] = await db.select().from(plantConfigsTable).where(eq(plantConfigsTable.month, month));
  const sourceConfigs = await db.select().from(plantSourceConfigsTable);
  res.json({
    month,
    workingDays: row?.workingDays ?? 27,
    shiftsPerDay: row?.shiftsPerDay ?? 2,
    shiftHours: row?.shiftHours ?? 12,
    snapshotDate: row?.snapshotDate ?? null,
    sourceConfigs,
  });
});

router.put("/plant/config", async (req, res) => {
  const { month, workingDays, shiftsPerDay, shiftHours, snapshotDate } = req.body as {
    month: string;
    workingDays?: number;
    shiftsPerDay?: number;
    shiftHours?: number;
    snapshotDate?: string | null;
  };
  if (!month) {
    res.status(400).json({ error: "month required" });
    return;
  }
  const [existing] = await db.select().from(plantConfigsTable).where(eq(plantConfigsTable.month, month));
  if (existing) {
    await db.update(plantConfigsTable).set({
      ...(workingDays !== undefined && { workingDays }),
      ...(shiftsPerDay !== undefined && { shiftsPerDay }),
      ...(shiftHours !== undefined && { shiftHours }),
      ...(snapshotDate !== undefined && { snapshotDate }),
      updatedAt: new Date(),
    }).where(eq(plantConfigsTable.month, month));
  } else {
    await db.insert(plantConfigsTable).values({
      month,
      workingDays: workingDays ?? 27,
      shiftsPerDay: shiftsPerDay ?? 2,
      shiftHours: shiftHours ?? 12,
      snapshotDate: snapshotDate ?? null,
    });
  }
  res.json({ ok: true });
});

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
