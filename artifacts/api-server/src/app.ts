import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { logger } from "./lib/logger";
import apiRouter from "./routes";

export function createApp(): Express {
  const app = express();

  app.use(cors());
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

  app.use("/api", apiRouter);

  return app;
}
