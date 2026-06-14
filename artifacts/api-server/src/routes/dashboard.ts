import { Router, type IRouter } from "express";
import { asyncHandler, HttpError } from "../lib/http";
import { requireAuth } from "../lib/auth";
import { getDashboard } from "../services/dashboard";

const router: IRouter = Router();

router.get(
  "/dashboard",
  requireAuth,
  asyncHandler(async (req, res) => {
    const division = req.query["division"] as string | undefined;
    const planMonth = req.query["planMonth"] as string | undefined;
    if (!division || !planMonth) {
      throw new HttpError(400, "division and planMonth are required");
    }
    res.json(await getDashboard(division, planMonth));
  }),
);

export default router;
