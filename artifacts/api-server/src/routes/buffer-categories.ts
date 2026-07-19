import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, bufferCategoriesTable } from "@workspace/db";
import { runSeasonalityEngine, runPlumbingSeasonalityEngine, computeReliabilityFlag, Z_VALUES } from "../lib/seasonality-engine";
import { logger } from "../lib/logger";

const router: IRouter = Router();

// ─── GET /buffer-categories ───────────────────────────────────────────────────

router.get("/buffer-categories", async (req, res): Promise<void> => {
  const segment = req.query.segment ? String(req.query.segment) : undefined;
  const categories = segment
    ? await db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, segment)).orderBy(bufferCategoriesTable.name)
    : await db.select().from(bufferCategoriesTable).orderBy(bufferCategoriesTable.name);
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

  const [current] = await db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.id, id));
  if (!current) {
    res.status(404).json({ error: "Buffer category not found" });
    return;
  }

  const updates: Partial<typeof bufferCategoriesTable.$inferInsert> = {};

  if (hasOverride) {
    const rawOverride = body["overrideMultiplier"];
    if (rawOverride === null || rawOverride === undefined) {
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
    const m = Number(body["multiplier"]);
    if (Number.isNaN(m) || m < 0) {
      res.status(400).json({ error: "multiplier must be a non-negative number" });
      return;
    }
    updates.multiplier = m;
  }

  const [updated] = await db.update(bufferCategoriesTable).set(updates).where(eq(bufferCategoriesTable.id, id)).returning();
  if (!updated) {
    res.status(404).json({ error: "Buffer category not found" });
    return;
  }

  res.json(updated);
});

// ─── POST /buffer-categories/recompute ───────────────────────────────────────

let _ptmtRecomputeInFlight: Promise<void> | null = null;
let _plumbingRecomputeInFlight: Promise<void> | null = null;

router.post("/buffer-categories/recompute", async (req, res): Promise<void> => {
  const rawZ = req.query.z ?? req.body?.z;
  const zInput = rawZ !== undefined ? Number(rawZ) : 1.65;
  const validZValues = Object.values(Z_VALUES);
  const zScore = validZValues.includes(zInput as typeof validZValues[number]) ? zInput : 1.65;
  const segmentParam = req.query.segment ? String(req.query.segment) : "PTMT";

  if (segmentParam === "Plumbing") {
    // ── Plumbing recompute ─────────────────────────────────────────────────
    if (_plumbingRecomputeInFlight) {
      res.status(202).json({ message: "Plumbing recompute already in progress — please wait" });
      return;
    }

    const runPlumbing = async () => {
      try {
        logger.info({ zScore }, "plumbing-seasonality: starting recompute");
        const result = await runPlumbingSeasonalityEngine(zScore);

        for (const cat of result.categories) {
          const reliabilityFlag = computeReliabilityFlag(cat);

          const [row] = await db
            .select({ overrideMultiplier: bufferCategoriesTable.overrideMultiplier, multiplier: bufferCategoriesTable.multiplier })
            .from(bufferCategoriesTable)
            .where(and(eq(bufferCategoriesTable.name, cat.category), eq(bufferCategoriesTable.segment, "Plumbing")));

          // Applied = Override when set; otherwise keep the existing DB multiplier (sheet-derived default).
          // suggestedMultiplier is ADVISORY ONLY — never auto-applied.
          const appliedMultiplier = row?.overrideMultiplier ?? row?.multiplier ?? 1.5;

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
              reliabilityFlag,
            })
            .where(and(eq(bufferCategoriesTable.name, cat.category), eq(bufferCategoriesTable.segment, "Plumbing")));
        }

        logger.info({
          categories: result.categories.length,
          segmentCV: result.segmentBenchmark.cv,
          segmentSuggested: result.segmentBenchmark.suggestedMultiplier,
          peakMonth: result.segmentBenchmark.peakMonth,
        }, "plumbing-seasonality: recompute persisted to DB");
      } catch (err) {
        logger.error({ err }, "plumbing-seasonality: recompute failed");
      } finally {
        _plumbingRecomputeInFlight = null;
      }
    };

    _plumbingRecomputeInFlight = runPlumbing();
    try { await _plumbingRecomputeInFlight; } catch { /* already logged */ }

  } else {
    // ── PTMT recompute ────────────────────────────────────────────────────
    if (_ptmtRecomputeInFlight) {
      res.status(202).json({ message: "PTMT recompute already in progress — please wait" });
      return;
    }

    const runPtmt = async () => {
      try {
        logger.info({ zScore }, "seasonality: starting recompute");
        const result = await runSeasonalityEngine(zScore);

        for (const cat of result.categories) {
          const [row] = await db
            .select({ overrideMultiplier: bufferCategoriesTable.overrideMultiplier, multiplier: bufferCategoriesTable.multiplier })
            .from(bufferCategoriesTable)
            .where(eq(bufferCategoriesTable.name, cat.category));
          // Applied = Override when set; otherwise keep the existing business multiplier.
          // suggestedMultiplier is ADVISORY ONLY — it must never silently replace the plan value.
          const appliedMultiplier = row?.overrideMultiplier ?? row?.multiplier ?? 1;

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
        _ptmtRecomputeInFlight = null;
      }
    };

    _ptmtRecomputeInFlight = runPtmt();
    try { await _ptmtRecomputeInFlight; } catch { /* already logged */ }
  }

  const categories = await db
    .select()
    .from(bufferCategoriesTable)
    .where(eq(bufferCategoriesTable.segment, segmentParam))
    .orderBy(bufferCategoriesTable.name);

  res.json({ categories, computedAt: new Date().toISOString(), zScore, segment: segmentParam });
});

export default router;
