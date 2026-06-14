import { Router, type IRouter } from "express";
import healthRouter from "./health";
import diagnosticsRouter from "./diagnostics";
import authRouter from "./auth";
import configRouter from "./config";
import dataRouter from "./data";
import planRouter from "./plan";
import dashboardRouter from "./dashboard";
import reportsRouter from "./reports";
import legacyRouter from "./legacy";

const router: IRouter = Router();

router.use(healthRouter);
router.use(diagnosticsRouter);
router.use(authRouter);
router.use(configRouter);
router.use(dataRouter);
router.use(planRouter);
router.use(dashboardRouter);
router.use(reportsRouter);
router.use(legacyRouter);

export default router;
