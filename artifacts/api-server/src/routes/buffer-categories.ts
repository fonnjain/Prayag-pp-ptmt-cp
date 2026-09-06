import { Router, type IRouter } from "express";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, bufferCategoriesTable, ptmtBufferMultipliersTable, seasonalityRunsTable } from "@workspace/db";
import {
  runSeasonalityEngine,
  runPlumbingSeasonalityEngine,
  runPtmtMonthlySeasonalityEngine,
  computeReliabilityFlag,
  Z_VALUES,
} from "../lib/seasonality-engine";
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

// ─── GET /buffer-categories/monthly ───────────────────────────────────────────
// Month-scoped PTMT output feeds Temporary Plans. Explicit overrides remain
// available through the buffer category controls.

router.get("/buffer-categories/monthly", async (req, res): Promise<void> => {
  const month = req.query.month ? String(req.query.month) : undefined;
  const rows = month
    ? await db.select().from(ptmtBufferMultipliersTable)
      .where(eq(ptmtBufferMultipliersTable.month, month))
      .orderBy(asc(ptmtBufferMultipliersTable.category))
    : await db.select().from(ptmtBufferMultipliersTable)
      .orderBy(asc(ptmtBufferMultipliersTable.month), asc(ptmtBufferMultipliersTable.category));
  res.json({ rows, segment: "PTMT" });
});

// ─── GET /buffer-categories/seasonality-status ────────────────────────────────
// Compact operational view used by the Data page and audit tooling. The
// multiplier column is the current applied default; an explicit override is
// returned separately so automatic-vs-user decisions remain visible.
router.get("/buffer-categories/seasonality-status", async (req, res): Promise<void> => {
  const requestedSegment = req.query.segment ? String(req.query.segment) : undefined;
  const categories = requestedSegment
    ? await db.select().from(bufferCategoriesTable)
      .where(eq(bufferCategoriesTable.segment, requestedSegment))
      .orderBy(asc(bufferCategoriesTable.name))
    : await db.select().from(bufferCategoriesTable).orderBy(asc(bufferCategoriesTable.segment), asc(bufferCategoriesTable.name));
  const runs = await db
    .select()
    .from(seasonalityRunsTable)
    .orderBy(desc(seasonalityRunsTable.startedAt))
    .limit(12);

  res.json({
    categories: categories.map((category) => ({
      ...category,
      appliedMultiplier: category.overrideMultiplier ?? category.multiplier,
      applicationMode: category.overrideMultiplier === null ? "automatic" : "override",
    })),
    runs,
  });
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
let _ptmtMonthlyRecomputeInFlight: ReturnType<typeof runPtmtMonthlySeasonalityEngine> | null = null;
let _plumbingRecomputeInFlight: Promise<void> | null = null;

router.post("/buffer-categories/recompute-monthly", async (req, res): Promise<void> => {
  const rawZ = req.query.z ?? req.body?.z;
  const zInput = rawZ !== undefined ? Number(rawZ) : 1.65;
  const validZValues = Object.values(Z_VALUES);
  const zScore = validZValues.includes(zInput as typeof validZValues[number]) ? zInput : 1.65;

  if (_ptmtMonthlyRecomputeInFlight) {
    res.status(202).json({ message: "PTMT monthly recompute already in progress — please wait" });
    return;
  }

  const run = async () => {
    const result = await runPtmtMonthlySeasonalityEngine(zScore);
    const existing = await db
      .select({
        month: ptmtBufferMultipliersTable.month,
        category: ptmtBufferMultipliersTable.category,
        overrideMultiplier: ptmtBufferMultipliersTable.overrideMultiplier,
      })
      .from(ptmtBufferMultipliersTable);
    const overrides = new Map(
      existing.map((row) => [`${row.month}:${row.category}`, row.overrideMultiplier]),
    );

    const values = result.rows.map((row) => {
      const overrideMultiplier = overrides.get(`${row.month}:${row.category}`) ?? null;
      return {
        month: row.month,
        category: row.category,
        multiplier: overrideMultiplier ?? row.suggestedMultiplier,
        suggestedMultiplier: row.suggestedMultiplier,
        overrideMultiplier,
        zScore: row.zScore,
        cvValue: row.cvValue,
        dataQuality: row.dataQuality,
        sourceObservations: row.sourceObservations,
        lastComputedAt: result.computedAt,
      };
    });

    await db
      .insert(ptmtBufferMultipliersTable)
      .values(values)
      .onConflictDoUpdate({
        target: [ptmtBufferMultipliersTable.month, ptmtBufferMultipliersTable.category],
        set: {
          multiplier: sql`excluded.multiplier`,
          suggestedMultiplier: sql`excluded.suggested_multiplier`,
          zScore: sql`excluded.z_score`,
          cvValue: sql`excluded.cv_value`,
          dataQuality: sql`excluded.data_quality`,
          sourceObservations: sql`excluded.source_observations`,
          lastComputedAt: sql`excluded.last_computed_at`,
          updatedAt: new Date(),
        },
      });

    return result;
  };

  _ptmtMonthlyRecomputeInFlight = run();
  try {
    const result = await _ptmtMonthlyRecomputeInFlight;
    const rows = await db
      .select()
      .from(ptmtBufferMultipliersTable)
      .orderBy(asc(ptmtBufferMultipliersTable.month), asc(ptmtBufferMultipliersTable.category));
    res.json({ rows, computedAt: result.computedAt.toISOString(), zScore, segment: "PTMT" });
  } catch (err) {
    logger.error({ err, zScore }, "ptmt-monthly-seasonality: recompute failed");
    res.status(500).json({ error: "PTMT monthly seasonality recompute failed" });
  } finally {
    _ptmtMonthlyRecomputeInFlight = null;
  }
});

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

          // Applied = explicit override when set; otherwise use the
          // non-null auto suggestion. Insufficient categories retain their
          // existing sheet/DB multiplier rather than receiving a guess.
          const appliedMultiplier = row?.overrideMultiplier
            ?? cat.suggestedMultiplier
            ?? row?.multiplier
            ?? 1.5;

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
          // Applied = explicit override when set; otherwise use the
          // non-null auto suggestion. Insufficient categories retain their
          // existing multiplier.
          const appliedMultiplier = row?.overrideMultiplier
            ?? cat.suggestedMultiplier
            ?? row?.multiplier
            ?? 1;

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
