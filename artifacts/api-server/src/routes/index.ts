import { Router, type IRouter } from "express";
import { commitSha } from "../lib/buildInfo";
import bufferCategoriesRouter from "./buffer-categories";
import uploadsRouter from "./uploads";
import syncRouter from "./sync";
import planRouter from "./plan";
import planRunsRouter from "./plan-runs";
import dashboardRouter from "./dashboard";
import monitoringRouter from "./monitoring";
import aiRouter from "./ai";
import plantRouter from "./plant";
import reportsRouter from "./reports";
import opsRouter from "./ops";
import correctiveRouter from "./corrective";
import capacityRouter from "./capacity";
import apiKeysRouter from "./api-keys";
import plantLiveRouter, { plantLiveMachineRouter } from "./plant-live";
import sheetConfigRouter from "./sheet-config";
import plantPlanUploadRouter from "./plant-plan-upload";
import authRouter from "./auth";
import { requireSession } from "./session-middleware";
import apiV1Router from "./api-v1";

const router: IRouter = Router();

router.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/healthz", (_req, res) => {
  // dbHostname: identifies which database this API process is connected to.
  // Lets the regression suite confirm it is querying the intended DB — not helium
  // (dev) when running against the production URL, or vice-versa.
  const rawDbUrl = process.env["DATABASE_URL"] ?? "";
  let dbHostname = "(unknown)";
  if (rawDbUrl) {
    try { dbHostname = new URL(rawDbUrl).hostname; } catch { /* ignore */ }
  }
  // commitSha: SHA of the git commit that produced this running process.
  // The regression suite can compare it against the local source tree to confirm
  // production is not serving a stale bundle that was never pushed to GitHub.
  res.json({ status: "ok", dbHostname, commitSha });
});

router.use(authRouter);
// The records feed is machine-to-machine and has its own managed Bearer API
// key. Browser-facing plant-live reads are mounted below requireSession.
router.use(plantLiveMachineRouter);
router.use("/v1", apiV1Router);
router.use(requireSession);

router.use(plantLiveRouter);
router.use(bufferCategoriesRouter);
router.use(uploadsRouter);
router.use(syncRouter);
router.use(planRouter);
router.use(planRunsRouter);
router.use(dashboardRouter);
router.use(monitoringRouter);
router.use(aiRouter);
router.use(plantRouter);
router.use(reportsRouter);
router.use(opsRouter);
router.use(correctiveRouter);
router.use(capacityRouter);
router.use(apiKeysRouter);
router.use(sheetConfigRouter);
router.use("/monitoring", plantPlanUploadRouter);

export default router;
