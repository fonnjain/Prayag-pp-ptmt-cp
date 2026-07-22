import { Router } from "express";
import { db, categoryCapacityTable, plumbingMachineCapacityTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { computeCategoryCapacity } from "../lib/capacity-engine";
import { runMachineCascade, type PlanItemForCascade } from "../lib/machine-capacity-engine";
import { buildPlanItems } from "./plan";
import { logger } from "../lib/logger";

const router = Router();

router.get("/capacity/categories", async (req, res) => {
  try {
    const segment = req.query.segment ? String(req.query.segment) : undefined;
    const rows = segment
      ? await db.select().from(categoryCapacityTable).where(eq(categoryCapacityTable.segment, segment))
      : await db.select().from(categoryCapacityTable);
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
  const segment = req.query.segment ? String(req.query.segment) : "PTMT";
  try {
    const rows = await computeCategoryCapacity(trailingDays, segment);
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

router.get("/capacity/machines", async (req, res) => {
  const segment = req.query.segment ? String(req.query.segment) : "Plumbing";
  const month   = req.query.month   ? String(req.query.month)   : null;

  try {
    const machines = await db
      .select()
      .from(plumbingMachineCapacityTable)
      .where(eq(plumbingMachineCapacityTable.segment, segment));

    if (!month) {
      return res.json({ machines, utilisation: [], unfulfillable: [] });
    }

    const planItems = await buildPlanItems(month, segment);

    const cascadeItems: PlanItemForCascade[] = planItems.map(item => ({
      ...(item as PlanItemForCascade),
      machineW1: 0, machineW2: 0, machineW3: 0, machineW4: 0,
      assignedMachineId: null, machineWeek: null, machineUnfulfillable: false,
    }));

    const { utilisation, unfulfillable } = runMachineCascade(cascadeItems, machines, month);
    return res.json({ machines, utilisation, unfulfillable });
  } catch (err) {
    req.log.error({ err }, "capacity: machines list failed");
    return res.status(500).json({ error: "Failed to list machine capacities" });
  }
});

router.put("/capacity/machines/:machineId", async (req, res) => {
  const { machineId } = req.params;
  const { shiftsPerDay, hoursPerShift, lockedOut, workingDays, rates } = req.body as {
    shiftsPerDay?: number;
    hoursPerShift?: number;
    lockedOut?: boolean;
    workingDays?: number;
    rates?: Record<string, number>;
  };

  try {
    const update: Record<string, unknown> = {};
    if (shiftsPerDay != null) update.shiftsPerDay = Number(shiftsPerDay);
    if (hoursPerShift != null) update.hoursPerShift = Number(hoursPerShift);
    if (lockedOut != null) update.lockedOut = Boolean(lockedOut);
    if (workingDays != null) update.workingDays = Math.max(1, Math.round(Number(workingDays)));
    if (rates != null) {
      // Validate: all values must be positive numbers
      const cleaned: Record<string, number> = {};
      for (const [k, v] of Object.entries(rates)) {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) {
          return res.status(400).json({ error: `Rate for ${k} must be a positive number` });
        }
        cleaned[k.trim().toUpperCase()] = n;
      }
      update.rates = cleaned;
    }

    const [updated] = await db
      .update(plumbingMachineCapacityTable)
      .set(update)
      .where(eq(plumbingMachineCapacityTable.machineId, machineId))
      .returning();

    if (!updated) {
      return res.status(404).json({ error: "Machine not found" });
    }
    logger.info({ machineId, update }, "capacity: machine updated");
    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "capacity: machine put failed");
    return res.status(500).json({ error: "Failed to update machine" });
  }
});

export default router;
