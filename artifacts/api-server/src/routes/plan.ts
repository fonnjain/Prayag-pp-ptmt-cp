import { Router, type IRouter } from "express";
import { BuildPlanBody } from "@workspace/api-zod";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth, requireRole, type AuthedRequest } from "../lib/auth";
import {
  buildPlan,
  listRuns,
  getRun,
  getLines,
  EmptyPlanError,
  type MultiplierMode,
} from "../services/plan";
import { isReadyToPlan } from "../services/ingestion";
import { buildWorkbook } from "../services/excel";

const router: IRouter = Router();

router.post(
  "/plan/build",
  requireAuth,
  requireRole("admin", "planner"),
  asyncHandler(async (req, res) => {
    const body = BuildPlanBody.parse(req.body);
    const ready = await isReadyToPlan(body.division, body.planMonth);
    if (!ready.ready) {
      throw new HttpError(409, ready.reason ?? "Data is not ready to plan");
    }
    const user = (req as AuthedRequest).user;
    try {
      const run = await buildPlan({
        division: body.division,
        planMonth: body.planMonth,
        mode: body.mode as MultiplierMode,
        multiplier: body.multiplier ?? null,
        multiplierMin: body.multiplierMin ?? null,
        multiplierMax: body.multiplierMax ?? null,
        includeCurrentPending: body.includeCurrentPending ?? true,
        floor0: body.floor0 ?? true,
        overrides: body.overrides ?? {},
        createdBy: user?.email ?? undefined,
      });
      res.json(run);
    } catch (err) {
      if (err instanceof EmptyPlanError) {
        throw new HttpError(409, err.message);
      }
      throw err;
    }
  }),
);

router.get(
  "/plan/runs",
  requireAuth,
  asyncHandler(async (req, res) => {
    const division = req.query["division"] as string | undefined;
    const planMonth = req.query["planMonth"] as string | undefined;
    res.json(await listRuns(division, planMonth));
  }),
);

router.get(
  "/plan/runs/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params["id"]);
    if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
    const run = await getRun(id);
    if (!run) throw new HttpError(404, "Plan run not found");
    res.json(run);
  }),
);

router.get(
  "/plan/runs/:id/lines",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params["id"]);
    if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
    res.json(await getLines(id));
  }),
);

router.get(
  "/plan/runs/:id/export",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params["id"]);
    if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
    const buf = await buildWorkbook(id);
    if (!buf) throw new HttpError(404, "Plan run not found");
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="plan-run-${id}.xlsx"`,
    );
    res.send(buf);
  }),
);

export default router;
