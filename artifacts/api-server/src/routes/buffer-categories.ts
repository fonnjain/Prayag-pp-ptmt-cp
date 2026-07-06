import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, bufferCategoriesTable } from "@workspace/db";
import { updateBufferCategoryBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/buffer-categories", async (_req, res): Promise<void> => {
  const categories = await db
    .select()
    .from(bufferCategoriesTable)
    .orderBy(bufferCategoriesTable.name);
  res.json(categories);
});

router.patch("/buffer-categories/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const parsed = updateBufferCategoryBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn({ errors: parsed.error.message }, "Invalid buffer category update");
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [updated] = await db
    .update(bufferCategoriesTable)
    .set({ multiplier: parsed.data.multiplier })
    .where(eq(bufferCategoriesTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Buffer category not found" });
    return;
  }

  res.json(updated);
});

export default router;
