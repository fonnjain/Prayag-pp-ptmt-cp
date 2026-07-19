import { Router, type IRouter } from "express";
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
import plantLiveRouter from "./plant-live";
import sheetConfigRouter from "./sheet-config";

const router: IRouter = Router();

router.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

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
router.use(plantLiveRouter);
router.use(sheetConfigRouter);

export default router;
