import { Router, type IRouter } from "express";
import { db, syncSourcesTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { SHEET_IDS, SHEET_LABELS, listTabs } from "../lib/sheets";

const router: IRouter = Router();

async function syncOne(id: keyof typeof SHEET_IDS): Promise<void> {
  const name = SHEET_LABELS[id];
  try {
    const tabs = await listTabs(SHEET_IDS[id]);
    await db
      .insert(syncSourcesTable)
      .values({
        id,
        name,
        status: "success",
        message: `${tabs.length} tab(s) found`,
        rows: tabs.map((tab) => ({ tab })),
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: syncSourcesTable.id,
        set: {
          name,
          status: "success",
          message: `${tabs.length} tab(s) found`,
          rows: tabs.map((tab) => ({ tab })),
          lastSyncedAt: new Date(),
        },
      });
  } catch (err) {
    logger.warn({ err, id }, "Failed to sync sheet source");
    await db
      .insert(syncSourcesTable)
      .values({
        id,
        name,
        status: "error",
        message: err instanceof Error ? err.message : "Unknown error",
        rows: [],
        lastSyncedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: syncSourcesTable.id,
        set: {
          name,
          status: "error",
          message: err instanceof Error ? err.message : "Unknown error",
          lastSyncedAt: new Date(),
        },
      });
  }
}

router.post("/sync/sheets", async (_req, res): Promise<void> => {
  const ids = Object.keys(SHEET_IDS) as (keyof typeof SHEET_IDS)[];
  for (const id of ids) {
    await syncOne(id);
    await new Promise((resolve) => setTimeout(resolve, 1100));
  }
  const results = await db.select().from(syncSourcesTable).orderBy(syncSourcesTable.name);
  res.json(results);
});

router.get("/sync/status", async (_req, res): Promise<void> => {
  const results = await db.select().from(syncSourcesTable).orderBy(syncSourcesTable.name);
  res.json(results);
});

export default router;
