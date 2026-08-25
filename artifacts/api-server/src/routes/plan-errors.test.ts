import { test } from "node:test";
import assert from "node:assert/strict";
import {
  _setConnectorsForTest,
  listTabs,
  UpstreamTimeoutError,
} from "../lib/sheets.js";
import { handlePlanError } from "./plan.js";

test("Google Sheets connector 504 becomes a named upstream timeout", async () => {
  const connectors = {
    proxy: async () => new Response("gateway timeout", { status: 504 }),
  };
  const restore = _setConnectorsForTest(connectors as never);
  try {
    await assert.rejects(
      () => listTabs(`timeout-test-${Date.now()}`),
      (error: unknown) => {
        assert.ok(error instanceof UpstreamTimeoutError);
        assert.equal(error.code, "UPSTREAM_TIMEOUT");
        assert.equal(error.upstreamErrorType, "timeout");
        assert.equal(error.statusCode, 504);
        assert.equal(error.retryable, true);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test("plan routes map an upstream timeout to a safe retryable 504 response", () => {
  let statusCode = 0;
  let headers: Record<string, string> = {};
  let body: Record<string, unknown> | undefined;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    set(field: string, value: string) {
      headers[field] = value;
      return this;
    },
    json(value: Record<string, unknown>) {
      body = value;
      return this;
    },
  };

  handlePlanError(
    response as never,
    new UpstreamTimeoutError("google-sheet", "/v4/spreadsheets/test/values/report"),
  );

  assert.equal(statusCode, 504);
  assert.equal(headers["Retry-After"], "5");
  assert.deepEqual(body, {
    error: "UPSTREAM_TIMEOUT",
    message: "Google Sheets did not respond in time while loading planning data. Retry shortly.",
    upstreamErrorType: "timeout",
    retryable: true,
  });
});