import { Router, type IRouter } from "express";
import { GenerateReportBody } from "@workspace/api-zod";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth, requireRole } from "../lib/auth";
import {
  generateReport,
  listReports,
  renderReportPdf,
} from "../services/report";

const router: IRouter = Router();

router.get(
  "/reports",
  requireAuth,
  asyncHandler(async (req, res) => {
    const division = req.query["division"] as string | undefined;
    const planMonth = req.query["planMonth"] as string | undefined;
    res.json(await listReports(division, planMonth));
  }),
);

router.post(
  "/reports",
  requireAuth,
  requireRole("admin", "planner"),
  asyncHandler(async (req, res) => {
    const body = GenerateReportBody.parse(req.body);
    const report = await generateReport({
      runId: body.runId,
      cadence: body.cadence,
      board: body.board ?? false,
    });
    res.json(report);
  }),
);

router.get(
  "/reports/:id/download",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = Number(req.params["id"]);
    if (!Number.isFinite(id)) throw new HttpError(400, "Invalid id");
    const out = await renderReportPdf(id);
    if (!out) throw new HttpError(404, "Report not found");
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${out.filename}"`,
    );
    res.send(out.buffer);
  }),
);

export default router;
