import { Router, type Request, type Response } from "express";
import { requireApiKeyScope } from "./auth-middleware";
import { CacheUnavailableError, getApiReadProjection } from "../lib/api-read-projection";
import { normalizePlantSegment } from "../lib/plant-segments";

const router = Router();
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function validateQuery(req: Request, res: Response): { month: string; segment: "PTMT" | "Plumbing" } | null {
  const month = String(req.query.month ?? "");
  const segment = normalizePlantSegment(req.query.segment ?? "PTMT");
  if (!MONTH_RE.test(month)) {
    res.status(400).json({ error: "INVALID_MONTH", message: "month is required in YYYY-MM format." });
    return null;
  }
  if (!segment) {
    res.status(400).json({ error: "INVALID_SEGMENT", message: "segment must be PTMT or Plumbing." });
    return null;
  }
  return { month, segment };
}

async function sendProjection(req: Request, res: Response, kind: "items" | "calendar" | "summary" | "categories"): Promise<void> {
  const query = validateQuery(req, res);
  if (!query) return;
  try {
    const projection = await getApiReadProjection(query.month, query.segment);
    res.set({
      "Cache-Control": projection.metadata.cache.state === "stale" ? "public, max-age=0, stale-if-error=1800" : "public, max-age=300",
      "X-Data-Cache-State": projection.metadata.cache.state,
      "X-Data-Cache-Age": String(Math.round(projection.metadata.cache.ageMs / 1000)),
    });
    const body = kind === "items" ? { month: projection.month, segment: projection.segment, metadata: projection.metadata, items: projection.items }
      : kind === "calendar" ? { month: projection.month, segment: projection.segment, metadata: projection.metadata, ...projection.calendar }
      : kind === "summary" ? { month: projection.month, segment: projection.segment, metadata: projection.metadata, ...projection.summary }
      : { month: projection.month, segment: projection.segment, metadata: projection.metadata, categories: projection.categories };
    res.json(body);
  } catch (error) {
    if (error instanceof CacheUnavailableError) {
      res.status(503).json({ error: error.code, message: error.message });
      return;
    }
    req.log?.error?.({ err: error }, `api/v1/${kind} failed`);
    res.status(500).json({ error: "READ_PROJECTION_FAILED", message: "The local read projection could not be loaded." });
  }
}

router.get("/plan/items", requireApiKeyScope("read"), (req, res) => sendProjection(req, res, "items"));
router.get("/calendar", requireApiKeyScope("read"), (req, res) => sendProjection(req, res, "calendar"));
router.get("/summary", requireApiKeyScope("read"), (req, res) => sendProjection(req, res, "summary"));
router.get("/categories", requireApiKeyScope("read"), (req, res) => sendProjection(req, res, "categories"));

export default router;