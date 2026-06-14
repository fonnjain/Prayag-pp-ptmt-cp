import { Router, type IRouter } from "express";
import { PullDataBody, AcknowledgeDataBody } from "@workspace/api-zod";
import { asyncHandler } from "../lib/http";
import { requireAuth, requireRole, type AuthedRequest } from "../lib/auth";
import {
  pullData,
  listBatches,
  acknowledgeLatest,
  setSanityOnLatestBatch,
} from "../services/ingestion";
import { runSanity, getLatestSanity } from "../services/sanity";

const router: IRouter = Router();

router.post(
  "/data/pull",
  requireAuth,
  requireRole("admin", "planner"),
  asyncHandler(async (req, res) => {
    const body = PullDataBody.parse(req.body);
    const user = (req as AuthedRequest).user;
    const outcome = await pullData(
      body.division,
      body.planMonth,
      user?.email ?? null,
      body.source,
    );
    const batchId = outcome.batches.reduce<number | undefined>(
      (max, b) => (max === undefined || b.id > max ? b.id : max),
      undefined,
    );
    const sanity = await runSanity(
      body.division,
      body.planMonth,
      batchId,
      outcome.diags,
    );
    await setSanityOnLatestBatch(
      body.division,
      body.planMonth,
      sanity.verdict,
      sanity.summary,
    );
    res.json({ batches: outcome.batches, sanity, noChange: outcome.noChange });
  }),
);

router.post(
  "/data/acknowledge",
  requireAuth,
  requireRole("admin", "planner"),
  asyncHandler(async (req, res) => {
    const body = AcknowledgeDataBody.parse(req.body);
    await acknowledgeLatest(body.division, body.planMonth);
    const sanity =
      (await getLatestSanity(body.division, body.planMonth)) ?? {
        verdict: "ok",
        summary: "Acknowledged.",
        model: null,
        tier: null,
        downgraded: false,
        findings: [],
      };
    res.json(sanity);
  }),
);

router.get(
  "/data/batches",
  requireAuth,
  asyncHandler(async (req, res) => {
    const division = req.query["division"] as string | undefined;
    const planMonth = req.query["planMonth"] as string | undefined;
    res.json(await listBatches(division, planMonth));
  }),
);

router.get(
  "/data/sanity",
  requireAuth,
  asyncHandler(async (req, res) => {
    const division = req.query["division"] as string | undefined;
    const planMonth = req.query["planMonth"] as string | undefined;
    if (!division || !planMonth) {
      res.json(null);
      return;
    }
    res.json(await getLatestSanity(division, planMonth));
  }),
);

export default router;
