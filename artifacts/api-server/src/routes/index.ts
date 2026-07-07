import { Router, type IRouter } from "express";
import bufferCategoriesRouter from "./buffer-categories";
import uploadsRouter from "./uploads";
import syncRouter from "./sync";
import planRouter from "./plan";
import dashboardRouter from "./dashboard";
import monitoringRouter from "./monitoring";
import aiRouter from "./ai";
import plantRouter from "./plant";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

router.use(bufferCategoriesRouter);
router.use(uploadsRouter);
router.use(syncRouter);
router.use(planRouter);
router.use(dashboardRouter);
router.use(monitoringRouter);
router.use(aiRouter);
router.use(plantRouter);

export default router;
