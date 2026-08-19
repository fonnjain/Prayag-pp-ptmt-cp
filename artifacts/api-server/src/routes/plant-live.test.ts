/**
 * API-layer regression tests for the plant-live routes.
 *
 * These tests verify that the Express routes in plant-live.ts return the
 * correct HTTP status codes and response body shapes for each error scenario:
 *
 *   • upstream timeout  → 504 with code=UPSTREAM_TIMEOUT, upstreamErrorType="timeout"
 *   • upstream non-2xx  → 502 with upstreamErrorType="non-2xx" (no code field)
 *   • missing API key   → 503 (fetch is never called)
 *
 * UI-layer error-classification tests live in the production-monitoring
 * package alongside the helper they test:
 *   artifacts/production-monitoring/src/lib/plant-live-error.test.ts
 *
 * The test HTTP client uses node:http directly so that mocking globalThis.fetch
 * (for upstream calls inside the route) never intercepts test-harness requests.
 *
 * Run with:
 *   pnpm --filter @workspace/api-server run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import express from "express";
import plantLiveRouter from "./plant-live.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Spin up a disposable HTTP server around the plant-live router. */
async function startTestServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const app = express();
  app.use("/api", plantLiveRouter);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/api`,
    close: () => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res()))),
  };
}

/**
 * Make a plain HTTP GET using node:http (NOT globalThis.fetch) so that mocking
 * globalThis.fetch for upstream calls never intercepts test-harness requests.
 */
function httpGet(url: string): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let raw = "";
      res.on("data", (chunk: string) => (raw += chunk));
      res.on("end", () => {
        let body: unknown = null;
        try { body = JSON.parse(raw); } catch { body = raw; }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on("error", reject);
  });
}

// ── upstream timeout → 504 ────────────────────────────────────────────────────

test("plant-live/summary: upstream timeout → 504 with UPSTREAM_TIMEOUT code", async () => {
  process.env["PRAYAG_PLANT_API_KEY"] = "test-key";
  const realFetch = globalThis.fetch;
  // Simulate AbortSignal.timeout() firing inside upstreamFetch()
  globalThis.fetch = async () => {
    const err = new Error("The operation was aborted due to timeout");
    (err as any).name = "TimeoutError";
    throw err;
  };

  const { url, close } = await startTestServer();
  try {
    const { status, body } = await httpGet(
      `${url}/plant-live/summary?period=2026-08&plant=PIPE`,
    );
    assert.equal(status, 504, "should return 504 on upstream timeout");
    assert.equal((body as any).code, "UPSTREAM_TIMEOUT", "body.code must be UPSTREAM_TIMEOUT");
    assert.equal(
      (body as any).upstreamErrorType,
      "timeout",
      "body.upstreamErrorType must be 'timeout'",
    );
    assert.match((body as any).error, /timed out/i, "error message should mention timeout");
  } finally {
    globalThis.fetch = realFetch;
    await close();
    delete process.env["PRAYAG_PLANT_API_KEY"];
  }
});

// ── upstream non-2xx → 502 ────────────────────────────────────────────────────

test("plant-live/summary: upstream non-2xx → 502 with upstreamErrorType non-2xx", async () => {
  process.env["PRAYAG_PLANT_API_KEY"] = "test-key";
  const realFetch = globalThis.fetch;
  // Simulate prayag-plant.com itself returning a server-side error
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "internal error from upstream" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });

  const { url, close } = await startTestServer();
  try {
    const { status, body } = await httpGet(
      `${url}/plant-live/summary?period=2026-08&plant=PIPE`,
    );
    assert.equal(status, 502, "should return 502 when upstream returns non-2xx");
    assert.equal(
      (body as any).upstreamErrorType,
      "non-2xx",
      "body.upstreamErrorType must be 'non-2xx'",
    );
    assert.ok(
      !(body as any).code,
      "body.code must NOT be set for a generic upstream error (reserved for UPSTREAM_TIMEOUT)",
    );
  } finally {
    globalThis.fetch = realFetch;
    await close();
    delete process.env["PRAYAG_PLANT_API_KEY"];
  }
});

// ── upstream auth redirect → structured 502 ───────────────────────────────────

test("plant-live/summary: upstream sign-in redirect → structured auth-redirect 502", async () => {
  process.env["PRAYAG_PLANT_API_KEY"] = "test-key";
  const realFetch = globalThis.fetch;
  let receivedInit: RequestInit | undefined;
  globalThis.fetch = async (_input, init) => {
    receivedInit = init;
    return new Response(null, {
      status: 302,
      headers: { Location: "/login" },
    });
  };

  const { url, close } = await startTestServer();
  try {
    const { status, body } = await httpGet(
      `${url}/plant-live/summary?period=2026-08&plant=PTMT`,
    );
    assert.equal(status, 502, "a browser sign-in redirect must not be followed");
    assert.equal((body as any).code, "UPSTREAM_AUTH_REDIRECT");
    assert.equal((body as any).upstreamErrorType, "auth-redirect");
    assert.match((body as any).error, /sign-in/i);
    assert.equal(receivedInit?.redirect, "manual", "the upstream sign-in page must never be followed");
    const headers = new Headers(receivedInit?.headers);
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(headers.get("x-api-key"), "test-key");
  } finally {
    globalThis.fetch = realFetch;
    await close();
    delete process.env["PRAYAG_PLANT_API_KEY"];
  }
});

test("plant-live/summary: 2xx HTML response → structured bad-json 502", async () => {
  process.env["PRAYAG_PLANT_API_KEY"] = "test-key";
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response("<!doctype html><title>Sign in</title>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    });

  const { url, close } = await startTestServer();
  try {
    const { status, body } = await httpGet(
      `${url}/plant-live/summary?period=2026-08&plant=PTMT`,
    );
    assert.equal(status, 502);
    assert.equal((body as any).upstreamErrorType, "bad-json");
  } finally {
    globalThis.fetch = realFetch;
    await close();
    delete process.env["PRAYAG_PLANT_API_KEY"];
  }
});

// ── missing API key → 503 ─────────────────────────────────────────────────────

test("plant-live/summary: no API key → 503", async () => {
  delete process.env["PRAYAG_PLANT_API_KEY"];
  const realFetch = globalThis.fetch;
  // fetch must not be called when the key is missing
  globalThis.fetch = async (input: string | URL | Request) => {
    throw new Error(
      `fetch should not be called when API key is absent; called with: ${input}`,
    );
  };

  const { url, close } = await startTestServer();
  try {
    const { status } = await httpGet(
      `${url}/plant-live/summary?period=2026-08&plant=PIPE`,
    );
    assert.equal(status, 503, "should return 503 when PRAYAG_PLANT_API_KEY is absent");
  } finally {
    globalThis.fetch = realFetch;
    await close();
  }
});
