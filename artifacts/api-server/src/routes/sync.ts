import { Router, type IRouter } from "express";
import { db, syncSourcesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import {
  SHEET_IDS,
  SHEET_LABELS,
  listTabs,
  fetchLiveDailyProductionTotals,
  fetchLiveOrderByMonthTab,
  fetchPlumbingSheet3Production,
  resolveWorkbookForMonth,
  istPlanningMonth,
  istNextPlanningMonth,
  istDayOfMonth,
  type WorkbookDivision,
} from "../lib/sheets";

import { invalidatePlumbingMonitoringCache, getPlumbingMonitoringPayloadCached } from "./plan";
import { recomputeSeasonalityForPlanningCycle } from "../lib/seasonality-service";

const router: IRouter = Router();

// Planning month follows the IST calendar (plant timezone) — a UTC-hosted
// server must not sync the prior month for the first 5.5 h of a new month.
const currentPlanningMonth = istPlanningMonth;

async function upsertSyncSource(
  id: string,
  name: string,
  status: string,
  message: string,
  rows: Record<string, unknown>[],
): Promise<void> {
  await db
    .insert(syncSourcesTable)
    .values({ id, name, status, message, rows, lastSyncedAt: new Date() })
    .onConflictDoUpdate({
      target: syncSourcesTable.id,
      set: { name, status, message, rows, lastSyncedAt: new Date() },
    });
}

async function syncSheetConnectivity(id: keyof typeof SHEET_IDS): Promise<void> {
  const name = SHEET_LABELS[id];
  try {
    const tabs = await listTabs(SHEET_IDS[id]);
    await upsertSyncSource(id, name, "success", `${tabs.length} tab(s) found`, tabs.map((tab) => ({ tab })));
  } catch (err) {
    logger.warn({ err, id }, "Failed to sync sheet source");
    await upsertSyncSource(
      id,
      name,
      "error",
      err instanceof Error ? err.message : "Unknown error",
      [],
    );
  }
}

async function syncDailyProduction(month: string): Promise<void> {
  const id = `liveProduction_${month}`;
  const name = `Daily Production (${month})`;
  try {
    const totals = await fetchLiveDailyProductionTotals(month);
    const codeCount = totals.byCode.size;
    const totalQty = [...totals.byCode.values()].reduce((a, b) => a + b, 0);
    await upsertSyncSource(
      id,
      name,
      "success",
      `${codeCount} item(s) · ${totalQty.toLocaleString()} pcs this month`,
      [{ codes: codeCount, totalQty }],
    );
  } catch (err) {
    logger.warn({ err, month }, "Failed to sync daily production");
    await upsertSyncSource(
      id,
      name,
      "error",
      err instanceof Error ? err.message : "Unknown error",
      [],
    );
  }
}

async function syncLiveOrder(month: string): Promise<void> {
  const id = `liveOrder_${month}`;
  const name = `Order Book (${month})`;
  try {
    const totals = await fetchLiveOrderByMonthTab(month);
    const codeCount = totals.byCode.size;
    const totalQty = [...totals.byCode.values()].reduce((a, b) => a + b, 0);
    await upsertSyncSource(
      id,
      name,
      "success",
      `${codeCount} item(s) · ${totalQty.toLocaleString()} open orders`,
      [{ codes: codeCount, totalQty }],
    );
  } catch (err) {
    logger.warn({ err, month }, "Failed to sync live order");
    await upsertSyncSource(
      id,
      name,
      "error",
      err instanceof Error ? err.message : "Unknown error",
      [],
    );
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Next-month workbook readiness pre-check ────────────────────────────────

const NEXT_MONTH_CHECK_DIVISIONS: WorkbookDivision[] = ["PTMT", "PTMT-Machine", "Plumbing"];

/**
 * From day 25 (IST) onward, pre-resolve next month's workbooks so a missing
 * file surfaces as a sync warning BEFORE the rollover lands on a hard error
 * on the 1st. Each division gets a stable sync-source row that is overwritten
 * every run — success when the file exists, error naming the title pattern
 * when it doesn't.
 */
export async function syncNextMonthWorkbookReadiness(now?: Date): Promise<void> {
  const day = istDayOfMonth(now);
  const nextMonth = istNextPlanningMonth(now);
  for (const division of NEXT_MONTH_CHECK_DIVISIONS) {
    const id = `nextWorkbook_${division}`;
    const name = `Next month workbook — ${division} (${nextMonth})`;
    if (day < 25) {
      await upsertSyncSource(id, name, "success", `Pre-check starts on day 25 (today is day ${day})`, []);
      continue;
    }
    try {
      const r = await resolveWorkbookForMonth(division, nextMonth);
      await upsertSyncSource(
        id, name, "success",
        `Found "${r.title ?? r.workbookId}" (${r.source})`,
        [{ workbookId: r.workbookId, title: r.title, source: r.source }],
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ division, nextMonth, err: msg }, "Next-month workbook pre-check: NOT FOUND");
      await upsertSyncSource(id, name, "error", msg, []);
    }
    await sleep(1100);
  }
}

/**
 * Probe Plumbing Sheet3 for bad date formats and record the result in sync_sources.
 * Runs during every auto-sync so the plant sees a named alert immediately on the
 * Data page — before any replan or monitoring load triggers a hard 500.
 */
async function syncPlumbingSheet3DateCheck(month: string): Promise<void> {
  const id = `plumbingSheet3DateCheck_${month}`;
  const name = `Plumbing Sheet3 date-format check (${month})`;
  try {
    await fetchPlumbingSheet3Production(month);
    await upsertSyncSource(id, name, "success", "All production-row dates parsed OK", []);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Surface bad-date errors as "warning" so the plant sees them prominently on
    // the Data page.  Any other Sheet3 error (missing workbook, API timeout, etc.)
    // is recorded as "error".
    const isDateError = msg.includes("unrecognised date formats");
    logger.warn({ month, err: msg }, isDateError
      ? "Plumbing Sheet3: unrecognised date formats — surfacing as sync warning"
      : "Plumbing Sheet3 date-check: unexpected error");
    await upsertSyncSource(id, name, "error", msg, []);
  }
}

export async function runFullSync(month?: string): Promise<void> {
  const m = month ?? currentPlanningMonth();
  logger.info({ month: m }, "Starting full sync");

  const ids = Object.keys(SHEET_IDS) as (keyof typeof SHEET_IDS)[];
  for (const id of ids) {
    await syncSheetConnectivity(id);
    await sleep(1100);
  }

  await syncDailyProduction(m);
  await sleep(1100);
  await syncLiveOrder(m);
  await sleep(1100);
  await syncNextMonthWorkbookReadiness();
  await sleep(1100);
  await syncPlumbingSheet3DateCheck(m);

  // The Plumbing workbook may have changed — drop the cached monitoring payload
  // and pre-warm it in the background so the dashboard's next hit is instant
  // AND never serves data older than this sync.
  invalidatePlumbingMonitoringCache();
  getPlumbingMonitoringPayloadCached(m).catch((err) =>
    logger.warn({ err, month: m }, "Plumbing monitoring pre-warm after sync failed"),
  );

  // PTMT Control Board calls bundle + weekly-summary in parallel. Refresh their
  // shared cache once the sync has completed so the next page load is instant.
  import("./plant")
    .then(({ invalidatePlantBundleCache, getPlantMonitoringCached }) => {
      invalidatePlantBundleCache(m);
      return import("../lib/api-read-projection")
        .then(({ invalidateApiReadProjection }) => {
          invalidateApiReadProjection(m);
          return Promise.all([
            getPlantMonitoringCached(m, "PTMT"),
            getPlantMonitoringCached(m, "Plumbing"),
          ]);
        });
    })
    .then(() => logger.info({ month: m }, "PTMT and Plumbing monitoring pre-warm after sync complete"))
    .catch((err) => logger.warn({ err, month: m }, "Plant monitoring pre-warm after sync failed"));

  logger.info({ month: m }, "Full sync complete");
}

// ── Scheduler ──────────────────────────────────────────────────────────────

async function capturePendingClosedMonths(): Promise<void> {
  const [{ captureUnfrozenClosedPlantMonths, backfillLegacyPlantMonitoringSnapshots }, { invalidatePlantBundleCache }] = await Promise.all([
    import("../lib/plant-monitoring"),
    import("./plant"),
  ]);
  const outcomes = await captureUnfrozenClosedPlantMonths();
  for (const { month, result } of outcomes) {
    if (result.ok) {
      invalidatePlantBundleCache(month);
      logger.info({ month, capturedAt: result.capturedAt }, "Closed plant month snapshot ready");
    } else {
      logger.warn({ month, code: result.code, reason: result.reason }, "Closed plant month snapshot unavailable");
    }
  }
  const backfills = await backfillLegacyPlantMonitoringSnapshots();
  for (const backfill of backfills) {
    if (!backfill.restored) continue;
    invalidatePlantBundleCache(backfill.month);
    logger.info({ month: backfill.month }, "Legacy closed-month plan timeline restored from immutable issued snapshots");
  }
}

function isISTWorkHour(): boolean {
  const istMs = Date.now() + 5.5 * 60 * 60 * 1000;
  const hour = new Date(istMs).getUTCHours();
  return hour >= 8 && hour < 20;
}

let _schedulerStarted = false;

export function startSyncScheduler(): void {
  if (_schedulerStarted) return;
  _schedulerStarted = true;

  // Startup sync — 8 s delay so DB migrations finish first
  setTimeout(() => {
    logger.info("Auto-sync: startup run");
    // Pre-warm the Plumbing monitoring payload IMMEDIATELY (in parallel with the
    // full sync, which takes ~30 s of rate-limit sleeps) so the dashboard's
    // first browser hit is served from cache instead of a ~24 s cold rebuild.
    // runFullSync re-warms it again at the end (post-invalidation).
    const warmMonth = currentPlanningMonth();
    getPlumbingMonitoringPayloadCached(warmMonth).catch((err) =>
      logger.warn({ err, month: warmMonth }, "Plumbing monitoring startup pre-warm failed"),
    );
    runFullSync(warmMonth)
      .then(() => recomputeSeasonalityForPlanningCycle(warmMonth))
      .catch((err) => logger.error({ err }, "Startup sync failed"))
      .finally(() => capturePendingClosedMonths().catch((err) =>
        logger.error({ err }, "Startup closed-month capture failed"),
      ));
  }, 8000);

  // Hourly tick during IST work hours (08:00–20:00)
  setInterval(() => {
    if (isISTWorkHour()) {
      logger.info("Auto-sync: hourly scheduled run");
      const month = currentPlanningMonth();
      runFullSync(month)
        .then(() => recomputeSeasonalityForPlanningCycle(month))
        .catch((err) => logger.error({ err }, "Scheduled sync failed"))
        .finally(() => capturePendingClosedMonths().catch((err) =>
          logger.error({ err }, "Scheduled closed-month capture failed"),
        ));
    }
  }, 60 * 60 * 1000);
}

// ── Routes ─────────────────────────────────────────────────────────────────

router.post("/sync/sheets", async (req, res): Promise<void> => {
  const month = req.body?.month ? String(req.body.month) : currentPlanningMonth();
  await runFullSync(month);
  await recomputeSeasonalityForPlanningCycle(month);
  await capturePendingClosedMonths();
  const results = await db.select().from(syncSourcesTable).orderBy(syncSourcesTable.name);
  res.json(results);
});

router.get("/sync/status", async (_req, res): Promise<void> => {
  const results = await db.select().from(syncSourcesTable).orderBy(syncSourcesTable.name);
  res.json(results);
});

export default router;
