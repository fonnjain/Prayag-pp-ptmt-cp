import { Router, type IRouter } from "express";
import { db, workbookConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import {
  invalidateWorkbookCache,
  invalidateAllWorkbookCaches,
  invalidatePlumbingSheet3Cache,
  resolveWorkbookForMonth,
  searchWorkbookCandidates,
  WorkbookResolutionError,
} from "../lib/sheets";

const router: IRouter = Router();

/** Resolve both divisions' workbooks for a month, returning per-feed results (never throws). */
async function resolveAllFeeds(month: string) {
  const divisions = ["PTMT", "Plumbing"] as const;
  return Promise.all(
    divisions.map(async (division) => {
      try {
        const r = await resolveWorkbookForMonth(division, month);
        return { ...r, division, error: null as string | null, pattern: null as string | null };
      } catch (err) {
        const isRes = err instanceof WorkbookResolutionError;
        return {
          division,
          month,
          workbookId: null,
          title: null,
          modifiedTime: null,
          source: null,
          titleMonthMatch: null,
          error: err instanceof Error ? err.message : String(err),
          pattern: isRes ? (err as WorkbookResolutionError).pattern : null,
        };
      }
    }),
  );
}

/**
 * GET /workbook-config/resolved?month=YYYY-MM
 * Shows exactly which workbook each feed reads: ID, title, modified date, source
 * (pinned / static / auto) — or a loud error naming the searched title pattern.
 */
router.get("/workbook-config/resolved", async (req, res) => {
  const month = String(req.query.month ?? "") || new Date().toISOString().slice(0, 7);
  try {
    res.json({ month, feeds: await resolveAllFeeds(month) });
  } catch (err) {
    logger.error({ err, month }, "GET /workbook-config/resolved failed");
    res.status(500).json({ error: "Failed to resolve workbook sources" });
  }
});

/**
 * POST /workbook-config/refresh { month? } — the "Refresh sources" action.
 * Drops all resolution caches and re-resolves both feeds from Drive.
 */
router.post("/workbook-config/refresh", async (req, res) => {
  const month = String(req.body?.month ?? "") || new Date().toISOString().slice(0, 7);
  try {
    invalidateAllWorkbookCaches();
    invalidatePlumbingSheet3Cache(month);
    res.json({ month, refreshed: true, feeds: await resolveAllFeeds(month) });
  } catch (err) {
    logger.error({ err, month }, "POST /workbook-config/refresh failed");
    res.status(500).json({ error: "Failed to refresh workbook sources" });
  }
});

router.get("/workbook-config/suggest", async (req, res) => {
  const division = String(req.query.division ?? "");
  const month    = String(req.query.month    ?? "");
  const query    = req.query.query ? String(req.query.query) : undefined;

  if (!division || !month) {
    res.status(400).json({ error: "division and month are required" });
    return;
  }
  if (division !== "PTMT" && division !== "Plumbing") {
    res.status(400).json({ error: "division must be PTMT or Plumbing" });
    return;
  }

  try {
    const candidates = await searchWorkbookCandidates(division as "PTMT" | "Plumbing", month, query);
    res.json({ candidates });
  } catch (err) {
    logger.error({ err, division, month }, "GET /workbook-config/suggest failed");
    res.status(500).json({ error: "Drive search failed" });
  }
});

router.get("/workbook-config", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(workbookConfigTable)
      .orderBy(workbookConfigTable.division, workbookConfigTable.month);
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /workbook-config failed");
    res.status(500).json({ error: "Failed to load workbook config" });
  }
});

router.put("/workbook-config/:id", async (req, res) => {
  const { id } = req.params;
  const { division, month, workbookId, label } = req.body as {
    division: string;
    month: string;
    workbookId: string;
    label: string;
  };

  if (!division || !month || !workbookId || !label) {
    res.status(400).json({ error: "division, month, workbookId, label are required" });
    return;
  }

  try {
    const now = new Date();
    await db
      .insert(workbookConfigTable)
      .values({ id, division, month, workbookId, label, updatedAt: now })
      .onConflictDoUpdate({
        target: workbookConfigTable.id,
        set: { workbookId, label, updatedAt: now },
      });
    invalidateWorkbookCache(division, month);
    if (division === "Plumbing") invalidatePlumbingSheet3Cache(month);
    res.json({ id, division, month, workbookId, label });
  } catch (err) {
    logger.error({ err, id }, "PUT /workbook-config/:id failed");
    res.status(500).json({ error: "Failed to save workbook config" });
  }
});

router.delete("/workbook-config/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const [row] = await db.select().from(workbookConfigTable).where(eq(workbookConfigTable.id, id));
    await db.delete(workbookConfigTable).where(eq(workbookConfigTable.id, id));
    if (row) {
      // Unpinning must drop the resolution caches or the pin lingers up to 30 min.
      invalidateWorkbookCache(row.division, row.month);
      if (row.division === "Plumbing") invalidatePlumbingSheet3Cache(row.month);
    }
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "DELETE /workbook-config/:id failed");
    res.status(500).json({ error: "Failed to delete workbook config" });
  }
});

export default router;
