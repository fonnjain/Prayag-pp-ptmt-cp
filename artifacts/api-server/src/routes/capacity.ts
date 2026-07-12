import { Router } from "express";
import { db, categoryCapacityTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { computeCategoryCapacity } from "../lib/capacity-engine";
import { logger } from "../lib/logger";

const router = Router();

router.get("/capacity/categories", async (req, res) => {
  try {
    const rows = await db.select().from(categoryCapacityTable);
    const result = rows.map(r => ({
      ...r,
      appliedCapacity: r.overrideCapacity != null ? r.overrideCapacity : r.suggestedCapacity,
    }));
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "capacity: list failed");
    res.status(500).json({ error: "Failed to list category capacities" });
  }
});

router.patch("/capacity/categories/:category", async (req, res) => {
  const { category } = req.params;
  const { overrideCapacity, workingDaysPerWeek } = req.body as {
    overrideCapacity?: number | null;
    workingDaysPerWeek?: number;
  };

  try {
    const update: Record<string, unknown> = {};
    if ("overrideCapacity" in req.body) {
      update.overrideCapacity = overrideCapacity != null ? Number(overrideCapacity) : null;
    }
    if (workingDaysPerWeek != null) {
      update.workingDaysPerWeek = Number(workingDaysPerWeek);
    }

    const [updated] = await db
      .update(categoryCapacityTable)
      .set(update)
      .where(eq(categoryCapacityTable.category, category))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Category not found" });
    }

    logger.info({ category, update }, "capacity: override updated");
    return res.json({
      ...updated,
      appliedCapacity: updated.overrideCapacity != null ? updated.overrideCapacity : updated.suggestedCapacity,
    });
  } catch (err) {
    req.log.error({ err }, "capacity: patch failed");
    return res.status(500).json({ error: "Failed to update category capacity" });
  }
});

router.post("/capacity/recompute", async (req, res) => {
  const trailingDays = req.query.trailingDays ? Number(req.query.trailingDays) : 90;
  try {
    const rows = await computeCategoryCapacity(trailingDays);
    const result = rows.map(r => ({
      ...r,
      appliedCapacity: r.overrideCapacity != null ? r.overrideCapacity : r.suggestedCapacity,
    }));
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "capacity: recompute failed");
    return res.status(500).json({ error: "Recompute failed" });
  }
});

export default router;
