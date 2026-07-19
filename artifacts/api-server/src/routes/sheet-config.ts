import { Router, type IRouter } from "express";
import { db, workbookConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { invalidateWorkbookCache, searchWorkbookCandidates } from "../lib/sheets";

const router: IRouter = Router();

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
    res.json({ id, division, month, workbookId, label });
  } catch (err) {
    logger.error({ err, id }, "PUT /workbook-config/:id failed");
    res.status(500).json({ error: "Failed to save workbook config" });
  }
});

router.delete("/workbook-config/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.delete(workbookConfigTable).where(eq(workbookConfigTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "DELETE /workbook-config/:id failed");
    res.status(500).json({ error: "Failed to delete workbook config" });
  }
});

export default router;
