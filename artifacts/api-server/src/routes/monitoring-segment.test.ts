import assert from "node:assert/strict";
import http from "node:http";
import { test } from "node:test";
import express from "express";
import monitoringRouter from "./monitoring.js";

function httpGet(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let raw = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => (raw += chunk));
      response.on("end", () => {
        try {
          resolve({ status: response.statusCode ?? 0, body: JSON.parse(raw) });
        } catch {
          resolve({ status: response.statusCode ?? 0, body: raw });
        }
      });
    });
    request.on("error", reject);
  });
}

test("monitoring dashboard rejects an unrecognised segment before selecting a data branch", async () => {
  const app = express();
  app.use("/api", monitoringRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  try {
    const response = await httpGet(
      `http://127.0.0.1:${port}/api/monitoring/dashboard?segment=NOT_A_SEGMENT&month=2026-08`,
    );
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: "Unrecognised segment",
      value: "NOT_A_SEGMENT",
      recognised: ["PTMT", "Plumbing"],
    });
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
