import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, sourceConfig } from "@workspace/db";
import { UpdateSourceConfigBody } from "@workspace/api-zod";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth, requireRole } from "../lib/auth";

const router: IRouter = Router();

function view(r: typeof sourceConfig.$inferSelect) {
  return {
    id: r.id,
    division: r.division,
    dataType: r.dataType,
    fileId: r.fileId,
    tabPattern: r.tabPattern,
    appliesFrom: r.appliesFrom ?? null,
    appliesTo: r.appliesTo ?? null,
    notes: r.notes ?? null,
  };
}

router.get(
  "/source-config",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const division = req.query["division"] as string | undefined;
    const rows = division
      ? await db.select().from(sourceConfig).where(eq(sourceConfig.division, division))
      : await db.select().from(sourceConfig);
    res.json(rows.map(view));
  }),
);

router.patch(
  "/source-config/:id",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const id = Number(req.params["id"]);
    if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
    const body = UpdateSourceConfigBody.parse(req.body);
    const update: Partial<typeof sourceConfig.$inferInsert> = {};
    if (body.fileId !== undefined) update.fileId = body.fileId;
    if (body.tabPattern !== undefined) update.tabPattern = body.tabPattern;
    if (body.appliesFrom !== undefined) update.appliesFrom = body.appliesFrom;
    if (body.appliesTo !== undefined) update.appliesTo = body.appliesTo;
    if (body.notes !== undefined) update.notes = body.notes;
    const [row] = await db
      .update(sourceConfig)
      .set(update)
      .where(eq(sourceConfig.id, id))
      .returning();
    if (!row) throw new HttpError(404, "Source config not found");
    res.json(view(row));
  }),
);

export default router;
