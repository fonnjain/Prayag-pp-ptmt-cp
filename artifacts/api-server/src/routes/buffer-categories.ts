import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, bufferCategoriesTable } from "@workspace/db";
import { runSeasonalityEngine, Z_VALUES } from "../lib/seasonality-engine";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /buffer-categories ───────────────────────────────────────────────────

router.get("/buffer-categories", async (req, res): Promise<void> => {
  const segment = req.query.segment ? String(req.query.segment) : undefined;
  const query = db.select().from(bufferCategoriesTable).orderBy(bufferCategoriesTable.name);
  const categories = segment
    ? await db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, segment)).orderBy(bufferCategoriesTable.name)
    : await query;
  res.json(categories);
});

// ─── PATCH /buffer-categories/:id ────────────────────────────────────────────
// Accepts: { multiplier?: number } (legacy hard-code)
//       OR { overrideMultiplier?: number | null } (new override model)

router.patch("/buffer-categories/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const body = req.body as Record<string, unknown>;
  const hasOverride = "overrideMultiplier" in body;
  const hasMultiplier = "multiplier" in body;

  if (!hasOverride && !hasMultiplier) {
    res.status(400).json({ error: "Provide overrideMultiplier or multiplier" });
    return;
  }

  // Fetch current row
  const [current] = await db
    .select()
    .from(bufferCategoriesTable)
    .where(eq(bufferCategoriesTable.id, id));

  if (!current) {
    res.status(404).json({ error: "Buffer category not found" });
    return;
  }

  const updates: Partial<typeof bufferCategoriesTable.$inferInsert> = {};

  if (hasOverride) {
    const rawOverride = body["overrideMultiplier"];
    if (rawOverride === null || rawOverride === undefined) {
      // Clear override → snap back to suggested
      updates.overrideMultiplier = null;
      updates.multiplier = current.suggestedMultiplier ?? current.multiplier;
    } else {
      const override = Number(rawOverride);
      if (Number.isNaN(override) || override < 0) {
        res.status(400).json({ error: "overrideMultiplier must be a non-negative number or null" });
        return;
      }
      updates.overrideMultiplier = override;
      updates.multiplier = override;
    }
  } else if (hasMultiplier) {
    // Legacy: plain multiplier update (hard-code, no engine context)
    const m = Number(body["multiplier"]);
    if (Number.isNaN(m) || m < 0) {
      res.status(400).json({ error: "multiplier must be a non-negative number" });
      return;
    }
    updates.multiplier = m;
  }

  const [updated] = await db
    .update(bufferCategoriesTable)
    .set(updates)
    .where(eq(bufferCategoriesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Buffer category not found" });
    return;
  }

  res.json(updated);
});

// ─── POST /buffer-categories/recompute ───────────────────────────────────────

let _recomputeInFlight: Promise<void> | null = null;

router.post("/buffer-categories/recompute", async (req, res): Promise<void> => {
  const rawZ = req.query.z ?? req.body?.z;
  const zInput = rawZ !== undefined ? Number(rawZ) : 1.65;
  const validZValues = Object.values(Z_VALUES);
  const zScore = validZValues.includes(zInput as typeof validZValues[number]) ? zInput : 1.65;

  if (_recomputeInFlight) {
    res.status(202).json({ message: "Recompute already in progress — please wait" });
    return;
  }

  const run = async () => {
    try {
      logger.info({ zScore }, "seasonality: starting recompute");
      const result = await runSeasonalityEngine(zScore);

      // Persist per-category engine results to DB
      for (const cat of result.categories) {
        const appliedMultiplier = await (async () => {
          const [row] = await db
            .select({ overrideMultiplier: bufferCategoriesTable.overrideMultiplier, multiplier: bufferCategoriesTable.multiplier })
            .from(bufferCategoriesTable)
            .where(eq(bufferCategoriesTable.name, cat.category));
          if (!row) return cat.suggestedMultiplier ?? 1;
          // If user already has an override, keep it; otherwise use suggested
          return row.overrideMultiplier ?? cat.suggestedMultiplier ?? row.multiplier;
        })();

        await db
          .update(bufferCategoriesTable)
          .set({
            suggestedMultiplier: cat.suggestedMultiplier,
            cvValue: cat.cv,
            volatilityClass: cat.volatilityClass,
            avgMonth: cat.avgMonth,
            peakMonth: cat.peakMonth,
            peakIndex: cat.peakIndex,
            yoy: cat.yoy,
            signal: cat.signal,
            seasonalIndices: cat.seasonalIndices ? JSON.stringify(cat.seasonalIndices) : null,
            lastComputedAt: new Date(),
            dataQuality: cat.dataQuality,
            zScore: cat.zScore,
            multiplier: appliedMultiplier,
          })
          .where(eq(bufferCategoriesTable.name, cat.category));
      }

      logger.info({ categories: result.categories.length }, "seasonality: recompute persisted to DB");
    } catch (err) {
      logger.error({ err }, "seasonality: recompute failed");
    } finally {
      _recomputeInFlight = null;
    }
  };

  _recomputeInFlight = run();

  // Wait for completion (up to 5 minutes — reading 24 Google Sheets tabs takes time)
  try {
    await _recomputeInFlight;
  } catch { /* already logged */ }

  const categories = await db
    .select()
    .from(bufferCategoriesTable)
    .orderBy(bufferCategoriesTable.name);

  res.json({ categories, computedAt: new Date().toISOString(), zScore });
});

export default router;
