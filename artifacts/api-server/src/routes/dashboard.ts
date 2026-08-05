import { Router, type IRouter } from "express";
import { db, itemMasterTable, bufferCategoriesTable, syncSourcesTable } from "@workspace/db";
import { buildPlanItems } from "./plan";
import { summarizePlan } from "../lib/calc";

const router: IRouter = Router();

router.get("/dashboard", async (_req, res): Promise<void> => {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const [itemRows, categoryRows, syncRows] = await Promise.all([
    db.select({ id: itemMasterTable.id }).from(itemMasterTable),
    db.select({ id: bufferCategoriesTable.id }).from(bufferCategoriesTable),
    db.select({ lastSyncedAt: syncSourcesTable.lastSyncedAt }).from(syncSourcesTable),
  ]);

  const lastSyncedTimestamps = syncRows
    .map((r: { lastSyncedAt: Date | null }) => r.lastSyncedAt)
    .filter((d: Date | null): d is Date => d !== null)
    .map((d: Date) => d.getTime());
  const lastSyncedAt = lastSyncedTimestamps.length > 0 ? new Date(Math.max(...lastSyncedTimestamps)) : null;

  let grandMinTotal = 0;
  let grandMaxTotal = 0;
  let planError: string | null = null;
  try {
    const items = await buildPlanItems(month);
    const summary = summarizePlan(items);
    grandMinTotal = summary.grandMinTotal;
    grandMaxTotal = summary.grandMaxTotal;
  } catch (err) {
    // Surface the failure instead of silently reporting zeros — the plan build
    // now throws loud, named errors for missing/broken uploads.
    planError = err instanceof Error ? err.message : String(err);
    grandMinTotal = 0;
    grandMaxTotal = 0;
  }

  res.json({
    latestMonth: month,
    itemCount: itemRows.length,
    categoryCount: categoryRows.length,
    grandMinTotal,
    grandMaxTotal,
    planError,
    lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
  });
});

export default router;
