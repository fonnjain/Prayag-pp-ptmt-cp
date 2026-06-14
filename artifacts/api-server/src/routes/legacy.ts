import { Router, type IRouter } from "express";
import { RunLegacyImportBody } from "@workspace/api-zod";
import { asyncHandler } from "../lib/http";
import { requireAuth, requireRole } from "../lib/auth";
import { getScopes, runLegacyImport } from "../services/legacy";

const router: IRouter = Router();

router.get(
  "/legacy/scopes",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const division = req.query["division"] as string | undefined;
    res.json(await getScopes(division));
  }),
);

router.post(
  "/legacy/import",
  requireAuth,
  requireRole("admin"),
  asyncHandler(async (req, res) => {
    const body = RunLegacyImportBody.parse(req.body);
    const result = await runLegacyImport(body.scope, body.source, body.division);
    res.json(result);
  }),
);

export default router;
