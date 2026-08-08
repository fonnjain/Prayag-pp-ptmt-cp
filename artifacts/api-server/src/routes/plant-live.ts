import { Router, type Request, type Response as ExpressResponse, type NextFunction } from "express";
import { logger } from "../lib/logger";
import { validateApiKey } from "./api-keys";

const router = Router();

const BASE_URL = "https://prayag-plant.com/data-api/v1";
const UPSTREAM_TIMEOUT_MS = 20_000;

async function upstreamFetch(path: string, apiKey: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

/** Raw row-level data requires a valid managed API key (Bearer). */
async function requireApiKey(req: Request, res: ExpressResponse, next: NextFunction): Promise<void> {
  const header = req.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token) {
    res.status(401).json({ error: "Missing Authorization: Bearer <api key>" });
    return;
  }
  try {
    const key = await validateApiKey(token);
    if (!key) {
      res.status(401).json({ error: "Invalid or revoked API key" });
      return;
    }
    next();
  } catch (err) {
    logger.error({ err }, "API key validation failed");
    res.status(500).json({ error: "API key validation failed" });
  }
}

router.get("/plant-live/plants", async (req, res) => {
  const apiKey = process.env.PRAYAG_PLANT_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "PRAYAG_PLANT_API_KEY not configured" });
    return;
  }
  try {
    const upstream = await upstreamFetch("/plants", apiKey);
    if (!upstream.ok) {
      logger.warn({ status: upstream.status }, "plant-live/plants upstream error");
      res.status(502).json({ error: `Upstream responded ${upstream.status}` });
      return;
    }
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    logger.error({ err }, "plant-live/plants fetch failed");
    res.status(502).json({ error: "Failed to reach prayag-plant.com" });
  }
});

router.get("/plant-live/periods", async (_req, res) => {
  const apiKey = process.env.PRAYAG_PLANT_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "PRAYAG_PLANT_API_KEY not configured" });
    return;
  }
  try {
    const upstream = await upstreamFetch("/periods", apiKey);
    if (!upstream.ok) {
      logger.warn({ status: upstream.status }, "plant-live/periods upstream error");
      res.status(502).json({ error: `Upstream responded ${upstream.status}` });
      return;
    }
    res.json(await upstream.json());
  } catch (err) {
    logger.error({ err }, "plant-live/periods fetch failed");
    res.status(502).json({ error: "Failed to reach prayag-plant.com" });
  }
});

function buildFilterQuery(req: { query: Record<string, unknown> }): URLSearchParams {
  const qs = new URLSearchParams({ period: (req.query.period as string) || "last_updated" });
  for (const key of ["plant", "segment", "machine"] as const) {
    const val = req.query[key];
    if (typeof val === "string" && val) qs.set(key, val);
  }
  return qs;
}

router.get("/plant-live/summary", async (req, res) => {
  const apiKey = process.env.PRAYAG_PLANT_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "PRAYAG_PLANT_API_KEY not configured" });
    return;
  }
  const qs = buildFilterQuery(req);
  try {
    const upstream = await upstreamFetch(`/summary?${qs}`, apiKey);
    if (!upstream.ok) {
      logger.warn({ status: upstream.status, qs: qs.toString() }, "plant-live/summary upstream error");
      res.status(502).json({ error: `Upstream responded ${upstream.status}` });
      return;
    }
    res.json(await upstream.json());
  } catch (err) {
    logger.error({ err }, "plant-live/summary fetch failed");
    res.status(502).json({ error: "Failed to reach prayag-plant.com" });
  }
});

router.get("/plant-live/records", requireApiKey, async (req, res) => {
  const apiKey = process.env.PRAYAG_PLANT_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "PRAYAG_PLANT_API_KEY not configured" });
    return;
  }
  const qs = buildFilterQuery(req);
  try {
    const upstream = await upstreamFetch(`/records?${qs}`, apiKey);
    if (!upstream.ok) {
      logger.warn({ status: upstream.status, qs: qs.toString() }, "plant-live/records upstream error");
      res.status(502).json({ error: `Upstream responded ${upstream.status}` });
      return;
    }
    res.json(await upstream.json());
  } catch (err) {
    logger.error({ err }, "plant-live/records fetch failed");
    res.status(502).json({ error: "Failed to reach prayag-plant.com" });
  }
});

export default router;
