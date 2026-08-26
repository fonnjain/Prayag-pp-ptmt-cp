import { Router } from "express";
import { logger } from "../lib/logger";
import { requireApiKeyScope } from "./auth-middleware";
import { normalizePlantSegment, type PlantSegment } from "../lib/plant-segments";

const browserRouter = Router();
const machineRouter = Router();

const BASE_URL = "https://prayag-plant.com/data-api/v1";
const UPSTREAM_TIMEOUT_MS = 20_000;
const SUMMARY_FRESH_MS = 5 * 60 * 1000;
const SUMMARY_STALE_MS = 30 * 60 * 1000;

type SummaryCacheEntry = {
  body: unknown;
  fetchedAt: number;
};

const summaryCache = new Map<string, SummaryCacheEntry>();
const summaryRefreshes = new Map<string, Promise<unknown>>();

async function upstreamFetch(path: string, apiKey: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: {
      Accept: "application/json",
      "X-API-Key": apiKey,
    },
    // Never follow a browser sign-in redirect. Following it turns an upstream
    // authentication failure into a misleading 200 HTML response.
    redirect: "manual",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });
}

browserRouter.get("/plant-live/plants", async (req, res) => {
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

browserRouter.get("/plant-live/periods", async (_req, res) => {
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

function segmentForPlantFilter(value: unknown): PlantSegment | null {
  if (typeof value !== "string") return null;
  switch (value.trim().toUpperCase()) {
    case "PTMT":
      return "PTMT";
    case "PIPE":
    case "PLUMBING":
      return "Plumbing";
    default:
      return null;
  }
}

type RecordsFilter =
  | { query: URLSearchParams }
  | { status: 400 | 403; body: { error: string; message: string } };

function buildRecordsFilterQuery(
  req: { query: Record<string, unknown> },
  segmentScopes: string[],
): RecordsFilter {
  const rawSegment = req.query.segment;
  const rawPlant = req.query.plant;
  const segment = rawSegment === undefined ? null : normalizePlantSegment(rawSegment, null);
  if (rawSegment !== undefined && !segment) {
    return {
      status: 400,
      body: { error: "INVALID_SEGMENT", message: "segment must be PTMT or Plumbing." },
    };
  }

  const plantSegment = rawPlant === undefined ? null : segmentForPlantFilter(rawPlant);
  if (rawPlant !== undefined && !plantSegment) {
    return {
      status: 400,
      body: { error: "INVALID_PLANT", message: "plant must identify PTMT or Plumbing (PTMT or PIPE)." },
    };
  }
  if (segment && plantSegment && segment !== plantSegment) {
    return {
      status: 400,
      body: { error: "CONFLICTING_FILTERS", message: "plant and segment identify different plant segments." },
    };
  }

  const requestedSegment = segment ?? plantSegment;
  if (!requestedSegment && segmentScopes.length === 1) {
    return {
      status: 400,
      body: { error: "SEGMENT_REQUIRED", message: "A single-segment API key must specify segment or its plant alias." },
    };
  }
  if (requestedSegment && !segmentScopes.includes(requestedSegment)) {
    return {
      status: 403,
      body: { error: "FORBIDDEN", message: `API key is not scoped for ${requestedSegment}.` },
    };
  }

  const query = buildFilterQuery(req);
  if (requestedSegment) {
    query.set("segment", requestedSegment);
    if (rawPlant !== undefined) query.set("plant", requestedSegment === "Plumbing" ? "PIPE" : "PTMT");
  }
  return { query };
}

async function fetchSummaryFromUpstream(qs: URLSearchParams, apiKey: string): Promise<unknown> {
  let rawBody: string | undefined;
  const upstream = await upstreamFetch(`/summary?${qs}`, apiKey);
  if (upstream.status >= 300 && upstream.status < 400) {
    const error = new Error("Upstream redirected the API request to its sign-in page") as Error & {
      upstreamErrorType?: string;
      upstreamStatus?: number;
    };
    error.upstreamErrorType = "auth-redirect";
    error.upstreamStatus = upstream.status;
    throw error;
  }
  if (!upstream.ok) {
    const error = new Error(`Upstream responded ${upstream.status}`) as Error & {
      upstreamErrorType?: string;
      upstreamStatus?: number;
    };
    error.upstreamErrorType = "non-2xx";
    error.upstreamStatus = upstream.status;
    throw error;
  }

  rawBody = await upstream.text();
  try {
    return JSON.parse(rawBody);
  } catch (err) {
    if (err instanceof SyntaxError) {
      (err as SyntaxError & { rawBody?: string }).rawBody = rawBody;
    }
    throw err;
  }
}

function refreshSummaryCache(cacheKey: string, qs: URLSearchParams, apiKey: string): Promise<unknown> {
  const existing = summaryRefreshes.get(cacheKey);
  if (existing) return existing;

  const refresh = fetchSummaryFromUpstream(qs, apiKey)
    .then((body) => {
      summaryCache.set(cacheKey, { body, fetchedAt: Date.now() });
      return body;
    })
    .finally(() => {
      summaryRefreshes.delete(cacheKey);
    });

  summaryRefreshes.set(cacheKey, refresh);
  return refresh;
}

function setSummaryCacheHeaders(
  res: { set: (field: string, value: string) => unknown },
  cacheState: "HIT" | "STALE" | "MISS",
  ageMs = 0,
): void {
  res.set("X-Plant-Live-Cache", cacheState);
  res.set("X-Plant-Live-Cache-Age", String(Math.max(0, Math.round(ageMs / 1000))));
}

/**
 * Warm the current machine summary without blocking API startup. The first
 * dashboard visit can then use the in-memory result instead of waiting for the
 * plant service to parse the same report.
 */
export function warmPlantLiveSummary(period: string, plant = "PTMT"): void {
  const apiKey = process.env.PRAYAG_PLANT_API_KEY;
  if (!apiKey) return;
  const qs = new URLSearchParams({ period, plant });
  const cacheKey = qs.toString();
  void refreshSummaryCache(cacheKey, qs, apiKey).catch((err) => {
    logger.warn({ err, period, plant }, "plant-live summary startup pre-warm failed");
  });
}

browserRouter.get("/plant-live/summary", async (req, res) => {
  const apiKey = process.env.PRAYAG_PLANT_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "PRAYAG_PLANT_API_KEY not configured" });
    return;
  }
  const qs = buildFilterQuery(req);
  const cacheKey = qs.toString();
  const cached = summaryCache.get(cacheKey);
  const cacheAge = cached ? Date.now() - cached.fetchedAt : 0;

  if (cached && cacheAge < SUMMARY_FRESH_MS) {
    setSummaryCacheHeaders(res, "HIT", cacheAge);
    res.json(cached.body);
    return;
  }

  if (cached && cacheAge < SUMMARY_STALE_MS) {
    // Serve the last good result immediately. A slow or temporarily broken
    // upstream must not blank the dashboard after the cache has expired.
    setSummaryCacheHeaders(res, "STALE", cacheAge);
    res.json(cached.body);
    void refreshSummaryCache(cacheKey, qs, apiKey).catch((err) => {
      logger.warn({ err, qs: qs.toString() }, "plant-live summary stale refresh failed");
    });
    return;
  }

  try {
    const body = await refreshSummaryCache(cacheKey, qs, apiKey);
    setSummaryCacheHeaders(res, "MISS");
    res.json(body);
  } catch (err: any) {
    const isTimeout = err?.name === "TimeoutError";
    const isBadJson = err instanceof SyntaxError;
    const upstreamErrorType = err?.upstreamErrorType;
    if (isTimeout) {
      logger.error({ err }, "plant-live/summary fetch failed: timeout");
      res.status(504).set("X-Upstream-Error", "timeout").json({
        error: `Upstream timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s — prayag-plant.com may be slow or unreachable`,
        code: "UPSTREAM_TIMEOUT",
        upstreamErrorType: "timeout",
      });
    } else if (isBadJson) {
      logger.error({ err, bodyPreview: (err as SyntaxError & { rawBody?: string }).rawBody?.slice(0, 200) }, "plant-live/summary: upstream returned non-JSON (2xx but not parseable — likely an auth/error page)");
      res.status(502).set("X-Upstream-Error", "bad-json").json({
        error: "Upstream returned a 2xx response that is not JSON — usually an auth or error page served with status 200",
        upstreamErrorType: "bad-json",
      });
    } else if (upstreamErrorType === "auth-redirect") {
      logger.warn({ status: err?.upstreamStatus, qs: qs.toString() }, "plant-live/summary upstream redirected an API request");
      res.status(502).set("X-Upstream-Error", "auth-redirect").json({
        error: "Upstream redirected the API request to its sign-in page",
        code: "UPSTREAM_AUTH_REDIRECT",
        upstreamErrorType: "auth-redirect",
      });
    } else if (upstreamErrorType === "non-2xx") {
      logger.warn({ status: err?.upstreamStatus, qs: qs.toString() }, "plant-live/summary upstream error");
      res.status(502).set("X-Upstream-Error", "non-2xx").json({
        error: `Upstream responded ${err?.upstreamStatus ?? "with an error"}`,
        upstreamErrorType: "non-2xx",
      });
    } else {
      logger.error({ err }, "plant-live/summary fetch failed");
      res.status(502).set("X-Upstream-Error", "non-2xx").json({ error: "Failed to reach prayag-plant.com", upstreamErrorType: "non-2xx" });
    }
  }
});

machineRouter.get("/plant-live/records", requireApiKeyScope("read", undefined, {
  defaultSegment: null,
  enforceQuerySegment: false,
}), async (req, res) => {
  const apiKey = process.env.PRAYAG_PLANT_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "PRAYAG_PLANT_API_KEY not configured" });
    return;
  }
  const filter = buildRecordsFilterQuery(req, req.apiKey?.segmentScopes ?? []);
  if ("status" in filter) {
    res.status(filter.status).json(filter.body);
    return;
  }
  const qs = filter.query;
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

export default browserRouter;
export { machineRouter as plantLiveMachineRouter };
