/**
 * Shared Express middleware for managed API key authentication.
 *
 * Used by any route that requires a valid Bearer token issued via the
 * /api/api-keys management surface. Currently: plant-live /records and
 * corrective PATCH /runs/:id.
 *
 * Any future route that requires the same guard should import from here
 * rather than defining a local copy — two independent copies drift and
 * a security fix to one won't reach the other.
 */
import type { Request, Response, NextFunction } from "express";
import { validateApiKey } from "./api-keys";
import { logger } from "../lib/logger";

export async function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const header = req.get("authorization") ?? "";
  const token  = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
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
