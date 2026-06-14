import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { googleStatus } from "../lib/google";
import { anthropicAvailable, MODEL_FAST, MODEL_DEEP } from "../lib/anthropic";
import { asyncHandler } from "../lib/http";

const router: IRouter = Router();

router.get(
  "/diagnostics",
  asyncHandler(async (_req, res) => {
    let dbOk = false;
    try {
      await db.execute(sql`SELECT 1`);
      dbOk = true;
    } catch {
      dbOk = false;
    }
    const g = await googleStatus();
    res.json({
      db: dbOk,
      google: g.connected,
      googleMessage: g.message,
      anthropic: anthropicAvailable,
      modelFast: MODEL_FAST,
      modelDeep: MODEL_DEEP,
    });
  }),
);

export default router;
