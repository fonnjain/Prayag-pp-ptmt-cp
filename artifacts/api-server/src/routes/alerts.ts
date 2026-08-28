import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { alertRecordsTable } from "@workspace/db";
import { requireAdmin } from "./session-middleware";
import {
  acknowledgeAlert,
  evaluateAlerts,
  listAlertHistory,
  muteAlert,
  resetAlertThreshold,
  updateAlertThreshold,
  type AlertCode,
} from "../lib/alerts";
import { normalizePlantSegment } from "../lib/plant-segments";

const router: IRouter = Router();
const alertCodes = new Set(["R1", "R2", "R3", "R4", "R5", "R6", "R7"]);

function requestScope(req: Parameters<Parameters<IRouter["get"]>[1]>[0]): { month: string; segment: "PTMT" | "Plumbing" } | null {
  const month = String(req.query.month ?? "");
  const segment = normalizePlantSegment(req.query.segment);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !segment) return null;
  return { month, segment };
}

router.get("/alerts", async (req, res): Promise<void> => {
  const scope = requestScope(req);
  if (!scope) {
    res.status(400).json({ error: "INVALID_ALERT_SCOPE", message: "month (YYYY-MM) and segment (PTMT or Plumbing) are required." });
    return;
  }
  try {
    res.json(await evaluateAlerts(scope.month, scope.segment));
  } catch (error) {
    res.status(502).json({
      error: "ALERT_EVALUATION_FAILED",
      message: error instanceof Error ? error.message : "Could not evaluate alerts.",
    });
  }
});

router.get("/alerts/history", async (req, res): Promise<void> => {
  const segment = normalizePlantSegment(req.query.segment);
  if (!segment) {
    res.status(400).json({ error: "INVALID_SEGMENT", message: "segment must be PTMT or Plumbing." });
    return;
  }
  const requested = Number(req.query.limit ?? 100);
  const limit = Number.isFinite(requested) ? Math.min(Math.max(Math.trunc(requested), 1), 500) : 100;
  res.json({ segment, history: await listAlertHistory(segment, limit) });
});

router.patch("/alerts/:id/acknowledge", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "INVALID_ALERT_ID" });
    return;
  }
  const alert = await acknowledgeAlert(id, req.sessionUser?.email ?? "admin");
  if (!alert) {
    res.status(404).json({ error: "ALERT_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, alert });
});

router.patch("/alerts/:id/mute", requireAdmin, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  const mutedUntil = new Date(String(req.body?.mutedUntil ?? ""));
  if (!Number.isInteger(id) || !reason || Number.isNaN(mutedUntil.getTime()) || mutedUntil <= new Date()) {
    res.status(400).json({ error: "INVALID_MUTE", message: "A reason and future mutedUntil timestamp are required." });
    return;
  }
  const alert = await muteAlert(id, req.sessionUser?.email ?? "admin", reason, mutedUntil);
  if (!alert) {
    res.status(404).json({ error: "ALERT_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, alert });
});

router.put("/alerts/thresholds/:code", requireAdmin, async (req, res): Promise<void> => {
  const code = String(req.params.code).toUpperCase();
  const segment = normalizePlantSegment(req.body?.segment);
  const value = Number(req.body?.value);
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
  if (!alertCodes.has(code) || !segment || !Number.isFinite(value) || value < 0 || !reason) {
    res.status(400).json({ error: "INVALID_ALERT_THRESHOLD", message: "A valid rule, segment, non-negative value, and reason are required." });
    return;
  }
  const threshold = await updateAlertThreshold(code as AlertCode, segment, value, reason, req.sessionUser?.email ?? "admin");
  if (!threshold) {
    res.status(404).json({ error: "ALERT_THRESHOLD_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, threshold });
});

router.post("/alerts/thresholds/:code/reset", requireAdmin, async (req, res): Promise<void> => {
  const code = String(req.params.code).toUpperCase();
  const segment = normalizePlantSegment(req.body?.segment);
  if (!alertCodes.has(code) || !segment) {
    res.status(400).json({ error: "INVALID_ALERT_THRESHOLD" });
    return;
  }
  const threshold = await resetAlertThreshold(code as AlertCode, segment, req.sessionUser?.email ?? "admin");
  if (!threshold) {
    res.status(404).json({ error: "ALERT_THRESHOLD_NOT_FOUND" });
    return;
  }
  res.json({ ok: true, threshold });
});

export default router;