import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import cookieParser from "cookie-parser";
import { logger } from "./lib/logger";
import apiRouter from "./routes";
import { loadSession, requireSession } from "./routes/session-middleware";

let databaseReady = false;

export function setDatabaseReady(ready: boolean): void {
  databaseReady = ready;
}

export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: true, credentials: true }));
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req(req) {
          return {
            id: req.id,
            method: req.method,
            url: req.url?.split("?")[0],
          };
        },
        res(res) {
          return {
            statusCode: res.statusCode,
          };
        },
      },
    }),
  );
  app.use(express.json({ limit: "10mb" }));
  // Parse HTTP-only session cookies (must come before loadSession).
  app.use(cookieParser());
  // Load the session user (if a valid cookie is present) for every request so
  // route handlers can inspect req.sessionUser without an extra DB round-trip.
  app.use(loadSession);

  // Keep health checks available while migrations/seeding run, but make
  // database-backed requests retryable instead of exposing startup 500s.
  app.use("/api", (req, res, next) => {
    const isHealthCheck = req.path === "/" || req.path === "/healthz";
    // Auth login/logout are also exempt — the frontend needs them to bootstrap.
    const isAuthPublic  = req.path.startsWith("/auth/");
    if (databaseReady || isHealthCheck || isAuthPublic) {
      next();
      return;
    }
    res.status(503).json({
      error: "API is warming up",
      code: "API_NOT_READY",
    });
  });
  // Browser routes require a valid session. The two existing machine-to-machine
  // endpoints remain independent and validate their Bearer API key themselves.
  app.use("/api", (req, res, next) => {
    const isPublicAuth = req.path.startsWith("/auth/");
    const isHealth = req.path === "/" || req.path === "/healthz";
    const isApiKeyRoute =
      req.path === "/plant-live/records" ||
      (req.method === "PATCH" && /^\/corrective\/runs\/[^/]+$/.test(req.path));
    if (isPublicAuth || isHealth || isApiKeyRoute) {
      next();
      return;
    }
    requireSession(req, res, next);
  });
  app.use("/api", apiRouter);

  return app;
}
