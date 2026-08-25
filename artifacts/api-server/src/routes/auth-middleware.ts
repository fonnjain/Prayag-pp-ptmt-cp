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
import { normalizePlantSegment } from "../lib/plant-segments";

declare global {
  namespace Express {
    interface Request {
      apiKey?: {
        id: number;
        consumer: string;
        scopes: string[];
        segmentScopes: string[];
      };
    }
  }
}

const RATE_LIMITS: Record<string, number> = {
  "machine-analysis": 60,
  mis: 120,
  legacy: 60,
};
const RATE_WINDOW_MS = 60_000;
const rateWindows = new Map<number, { startedAt: number; count: number }>();

export function rateLimit(req: Request, res: Response, key: NonNullable<Request["apiKey"]>): boolean {
  const limit = RATE_LIMITS[key.consumer] ?? RATE_LIMITS.legacy;
  const now = Date.now();
  const previous = rateWindows.get(key.id);
  const window = !previous || now - previous.startedAt >= RATE_WINDOW_MS
    ? { startedAt: now, count: 0 }
    : previous;
  window.count++;
  rateWindows.set(key.id, window);
  const remaining = Math.max(limit - window.count, 0);
  const reset = Math.ceil((window.startedAt + RATE_WINDOW_MS) / 1000);
  res.set({
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
    "X-RateLimit-Reset": String(reset),
  });
  if (window.count > limit) {
    res.set("Retry-After", String(Math.max(1, Math.ceil((window.startedAt + RATE_WINDOW_MS - now) / 1000))));
    res.status(429).json({ error: "RATE_LIMITED", message: "Too many requests for this API key." });
    return false;
  }
  return true;
}

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
    req.apiKey = {
      id: key.id,
      consumer: key.consumer,
      scopes: key.scopes,
      segmentScopes: key.segmentScopes,
    };
    next();
  } catch (err) {
    logger.error({ err }, "API key validation failed");
    res.status(500).json({ error: "API key validation failed" });
  }
}

export function requireApiKeyScope(
  scope: "read" | "write",
  segment?: "PTMT" | "Plumbing",
  options: {
    defaultSegment?: "PTMT" | "Plumbing" | null;
    enforceQuerySegment?: boolean;
  } = {},
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    await requireApiKey(req, res, () => {
      const key = req.apiKey;
      const requestedSegment = segment
        ?? (req.query.segment === undefined
          ? (options.defaultSegment === undefined ? "PTMT" : options.defaultSegment)
          : normalizePlantSegment(req.query.segment));
      if (!key || !key.scopes.includes(scope)) {
        res.status(403).json({ error: "FORBIDDEN", message: `API key does not have the ${scope} scope.` });
        return;
      }
      if (options.enforceQuerySegment !== false && requestedSegment && !key.segmentScopes.includes(requestedSegment)) {
        res.status(403).json({ error: "FORBIDDEN", message: `API key is not scoped for ${requestedSegment}.` });
        return;
      }
      if (!rateLimit(req, res, key)) return;
      next();
    });
  };
}

export function _resetApiKeyRateLimitsForTest(): void {
  rateWindows.clear();
}
