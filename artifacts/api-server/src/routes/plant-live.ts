import { Router } from "express";
import { logger } from "../lib/logger";

const router = Router();

const BASE_URL = "https://prayag-plant.com/data-api/v1";

async function upstreamFetch(path: string, apiKey: string): Promise<Response> {
  return fetch(`${BASE_URL}${path}`, {
    headers: { "X-API-Key": apiKey },
  });
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

router.get("/plant-live/summary", async (req, res) => {
  const apiKey = process.env.PRAYAG_PLANT_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "PRAYAG_PLANT_API_KEY not configured" });
    return;
  }
  const period = (req.query.period as string) || "last_updated";
  const plant = req.query.plant as string | undefined;
  const qs = new URLSearchParams({ period });
  if (plant) qs.set("plant", plant);
  try {
    const upstream = await upstreamFetch(`/summary?${qs}`, apiKey);
    if (!upstream.ok) {
      logger.warn({ status: upstream.status, period, plant }, "plant-live/summary upstream error");
      res.status(502).json({ error: `Upstream responded ${upstream.status}` });
      return;
    }
    const data = await upstream.json();
    res.json(data);
  } catch (err) {
    logger.error({ err }, "plant-live/summary fetch failed");
    res.status(502).json({ error: "Failed to reach prayag-plant.com" });
  }
});

export default router;
