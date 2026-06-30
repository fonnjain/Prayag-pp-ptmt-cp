import { Router, type IRouter } from "express";
import z from "zod";
import {
  PullDataBody,
  AcknowledgeDataBody,
  AddCoverageSourceBody,
  DismissCoverageCandidateBody,
} from "@workspace/api-zod";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth, requireRole, type AuthedRequest } from "../lib/auth";
import {
  pullData,
  listBatches,
  acknowledgeLatest,
  setSanityOnLatestBatch,
  getLatestBatchId,
} from "../services/ingestion";
import { runSanity, getLatestSanity, renderSanityPdf } from "../services/sanity";
import {
  runCoverageReview,
  getLatestCoverage,
  addSourceFromCandidate,
  dismissCandidate,
} from "../services/coverage";
import {
  runReconciliation,
  persistReconciliation,
  persistReconciliationError,
  getLatestReconciliation,
} from "../services/roster-reconciliation";

const ReconciliationRunBody = z.object({ month: z.string() });

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
    const batchId = await getLatestBatchId(body.division, body.planMonth);
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
      { model: sanity.model, tier: sanity.tier, downgraded: sanity.downgraded },
    );
    res.json({ batches: outcome.batches, sanity, noChange: outcome.noChange });
    void runCoverageReview(body.division, body.planMonth, outcome.diags);
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

router.get(
  "/data/sanity/report",
  requireAuth,
  asyncHandler(async (req, res) => {
    const division = req.query["division"] as string | undefined;
    const planMonth = req.query["planMonth"] as string | undefined;
    if (!division || !planMonth) {
      throw new HttpError(400, "division and planMonth are required");
    }
    const out = await renderSanityPdf(division, planMonth);
    if (!out) {
      throw new HttpError(
        404,
        "No sanity result for this division and month. Pull data first.",
      );
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${out.filename}"`,
    );
    res.send(out.buffer);
  }),
);

router.get(
  "/data/coverage",
  requireAuth,
  asyncHandler(async (req, res) => {
    const division = req.query["division"] as string | undefined;
    const planMonth = req.query["planMonth"] as string | undefined;
    if (!division || !planMonth) {
      res.json(null);
      return;
    }
    res.json(await getLatestCoverage(division, planMonth));
  }),
);

router.post(
  "/data/coverage/add-source",
  requireAuth,
  requireRole("admin", "planner"),
  asyncHandler(async (req, res) => {
    const body = AddCoverageSourceBody.parse(req.body);
    await addSourceFromCandidate({
      division: body.division,
      dataType: body.dataType,
      fileId: body.fileId,
      tabPattern: body.tabPattern ?? null,
      appliesFrom: body.appliesFrom ?? null,
    });
    res.json({ ok: true });
  }),
);

router.post(
  "/data/coverage/dismiss",
  requireAuth,
  requireRole("admin", "planner"),
  asyncHandler(async (req, res) => {
    const body = DismissCoverageCandidateBody.parse(req.body);
    await dismissCandidate(body.division, body.fileId);
    res.json({ ok: true });
  }),
);

router.get(
  "/data/reconciliation",
  requireAuth,
  asyncHandler(async (req, res) => {
    const month = req.query["month"] as string | undefined;
    if (!month) { res.json(null); return; }
    res.json(await getLatestReconciliation(month));
  }),
);

router.post(
  "/data/reconciliation/run",
  requireAuth,
  requireRole("admin", "planner"),
  asyncHandler(async (req, res) => {
    const body = ReconciliationRunBody.parse(req.body);
    let result = null;
    try {
      result = await runReconciliation(body.month);
      await persistReconciliation(body.month, result);
    } catch (err) {
      await persistReconciliationError(body.month, err);
      throw err;
    }
    res.json(result);
  }),
);

export default router;
