import { Router } from "express";
import { logger } from "../lib/logger";
import { requireApiKey } from "./auth-middleware";

const router = Router();

const BASE_URL = "https://prayag-plant.com/data-api/v1";
const UPSTREAM_TIMEOUT_MS = 20_000;

async function upstreamFetch(path: string, apiKey: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: { "X-API-Key": apiKey },
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

router.get("/plant-live/plants", async (req, res) => {
  const apiKey = process.env.PRAYAG_PLANT_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "PRAYAG_PLANT_API_KEY not configured" });
    return;
  }
  let rawBody: string | undefined;
  try {
    const upstream = await upstreamFetch("/plants", apiKey);
    if (!upstream.ok) {
      logger.warn({ status: upstream.status }, "plant-live/plants upstream error");
      res.status(502).set("X-Upstream-Error", "non-2xx").json({ error: `Upstream responded ${upstream.status}`, upstreamErrorType: "non-2xx" });
      return;
    }
    rawBody = await upstream.text();
    res.json(JSON.parse(rawBody));
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError";
    const isBadJson = err instanceof SyntaxError;
    if (isTimeout) {
      logger.error({ err }, "plant-live/plants fetch failed: timeout");
      res.status(504).set("X-Upstream-Error", "timeout").json({
        error: `Upstream timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s — prayag-plant.com may be slow or unreachable`,
        code: "UPSTREAM_TIMEOUT",
        upstreamErrorType: "timeout",
      });
    } else if (isBadJson) {
      logger.error({ err, bodyPreview: rawBody?.slice(0, 200) }, "plant-live/plants: upstream returned non-JSON (2xx but not parseable — likely an auth/error page)");
      res.status(502).set("X-Upstream-Error", "bad-json").json({
        error: "Upstream returned a 2xx response that is not JSON — usually an auth or error page served with status 200",
        upstreamErrorType: "bad-json",
      });
    } else {
      logger.error({ err }, "plant-live/plants fetch failed");
      res.status(502).set("X-Upstream-Error", "non-2xx").json({ error: "Failed to reach prayag-plant.com", upstreamErrorType: "non-2xx" });
    }
  }
});

router.get("/plant-live/periods", async (_req, res) => {
  const apiKey = process.env.PRAYAG_PLANT_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "PRAYAG_PLANT_API_KEY not configured" });
    return;
  }
  let rawBody: string | undefined;
  try {
    const upstream = await upstreamFetch("/periods", apiKey);
    if (!upstream.ok) {
      logger.warn({ status: upstream.status }, "plant-live/periods upstream error");
      res.status(502).set("X-Upstream-Error", "non-2xx").json({ error: `Upstream responded ${upstream.status}`, upstreamErrorType: "non-2xx" });
      return;
    }
    rawBody = await upstream.text();
    res.json(JSON.parse(rawBody));
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError";
    const isBadJson = err instanceof SyntaxError;
    if (isTimeout) {
      logger.error({ err }, "plant-live/periods fetch failed: timeout");
      res.status(504).set("X-Upstream-Error", "timeout").json({
        error: `Upstream timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s — prayag-plant.com may be slow or unreachable`,
        code: "UPSTREAM_TIMEOUT",
        upstreamErrorType: "timeout",
      });
    } else if (isBadJson) {
      logger.error({ err, bodyPreview: rawBody?.slice(0, 200) }, "plant-live/periods: upstream returned non-JSON (2xx but not parseable — likely an auth/error page)");
      res.status(502).set("X-Upstream-Error", "bad-json").json({
        error: "Upstream returned a 2xx response that is not JSON — usually an auth or error page served with status 200",
        upstreamErrorType: "bad-json",
      });
    } else {
      logger.error({ err }, "plant-live/periods fetch failed");
      res.status(502).set("X-Upstream-Error", "non-2xx").json({ error: "Failed to reach prayag-plant.com", upstreamErrorType: "non-2xx" });
    }
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
  let rawBody: string | undefined;
  try {
    const upstream = await upstreamFetch(`/summary?${qs}`, apiKey);
    if (!upstream.ok) {
      logger.warn({ status: upstream.status, qs: qs.toString() }, "plant-live/summary upstream error");
      res.status(502).set("X-Upstream-Error", "non-2xx").json({ error: `Upstream responded ${upstream.status}`, upstreamErrorType: "non-2xx" });
      return;
    }
    rawBody = await upstream.text();
    res.json(JSON.parse(rawBody));
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError";
    const isBadJson = err instanceof SyntaxError;
    if (isTimeout) {
      logger.error({ err }, "plant-live/summary fetch failed: timeout");
      res.status(504).set("X-Upstream-Error", "timeout").json({
        error: `Upstream timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s — prayag-plant.com may be slow or unreachable`,
        code: "UPSTREAM_TIMEOUT",
        upstreamErrorType: "timeout",
      });
    } else if (isBadJson) {
      logger.error({ err, bodyPreview: rawBody?.slice(0, 200) }, "plant-live/summary: upstream returned non-JSON (2xx but not parseable — likely an auth/error page)");
      res.status(502).set("X-Upstream-Error", "bad-json").json({
        error: "Upstream returned a 2xx response that is not JSON — usually an auth or error page served with status 200",
        upstreamErrorType: "bad-json",
      });
    } else {
      logger.error({ err }, "plant-live/summary fetch failed");
      res.status(502).set("X-Upstream-Error", "non-2xx").json({ error: "Failed to reach prayag-plant.com", upstreamErrorType: "non-2xx" });
    }
  }
});

router.get("/plant-live/records", requireApiKey, async (req, res) => {
  const apiKey = process.env.PRAYAG_PLANT_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "PRAYAG_PLANT_API_KEY not configured" });
    return;
  }
  const qs = buildFilterQuery(req);
  let rawBody: string | undefined;
  try {
    const upstream = await upstreamFetch(`/records?${qs}`, apiKey);
    if (!upstream.ok) {
      logger.warn({ status: upstream.status, qs: qs.toString() }, "plant-live/records upstream error");
      res.status(502).set("X-Upstream-Error", "non-2xx").json({ error: `Upstream responded ${upstream.status}`, upstreamErrorType: "non-2xx" });
      return;
    }
    rawBody = await upstream.text();
    res.json(JSON.parse(rawBody));
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError";
    const isBadJson = err instanceof SyntaxError;
    if (isTimeout) {
      logger.error({ err }, "plant-live/records fetch failed: timeout");
      res.status(504).set("X-Upstream-Error", "timeout").json({
        error: `Upstream timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s — prayag-plant.com may be slow or unreachable`,
        code: "UPSTREAM_TIMEOUT",
        upstreamErrorType: "timeout",
      });
    } else if (isBadJson) {
      logger.error({ err, bodyPreview: rawBody?.slice(0, 200) }, "plant-live/records: upstream returned non-JSON (2xx but not parseable — likely an auth/error page)");
      res.status(502).set("X-Upstream-Error", "bad-json").json({
        error: "Upstream returned a 2xx response that is not JSON — usually an auth or error page served with status 200",
        upstreamErrorType: "bad-json",
      });
    } else {
      logger.error({ err }, "plant-live/records fetch failed");
      res.status(502).set("X-Upstream-Error", "non-2xx").json({ error: "Failed to reach prayag-plant.com", upstreamErrorType: "non-2xx" });
    }
  }
});

export default router;
