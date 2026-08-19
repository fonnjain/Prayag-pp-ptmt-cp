/**
 * Unit tests for classifyPlantLiveError — the shared helper used by
 * plumbing-velocity.tsx to map API error shapes to user-facing copy.
 *
 * These tests cover the three distinct HTTP status paths the plant-live API
 * returns:
 *   503  — API key absent (infrastructure misconfiguration)
 *   504  — upstream timed out (slow / overloaded)
 *   502  — upstream returned a non-2xx error (down / bad key / network)
 *
 * Run with:
 *   pnpm --filter @workspace/production-monitoring run test
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyPlantLiveError, type PlantLiveErrorShape } from "./plant-live-error.js";

const MONTH = "2026-08";

// ── 504 / timeout paths ───────────────────────────────────────────────────────

test("504 via upstreamErrorType=timeout → 'Plant live API timed out' heading", () => {
  // This is the primary path: the API returns 504 + UPSTREAM_TIMEOUT code;
  // the custom fetch wrapper attaches the parsed body as error.data.
  const err: PlantLiveErrorShape = {
    message: "HTTP 504",
    data: { code: "UPSTREAM_TIMEOUT", upstreamErrorType: "timeout" },
  };
  const { heading, detail, hint } = classifyPlantLiveError(err, MONTH);

  assert.equal(heading, "Plant live API timed out");
  assert.match(detail, /did not respond within 20 s/, "detail must explain the 20 s timeout");
  assert.match(detail, /prayag-plant\.com/, "detail must reference the upstream service name");
  assert.match(hint, /if it also times out/, "hint must point ops to the upstream bottleneck");
  assert.match(hint, new RegExp(`period=${MONTH}`), "hint must embed the current month");
});

test("504 detected via status code in message (no parsed body) → 'Plant live API timed out'", () => {
  // Fallback: if the fetch wrapper surfaces only the HTTP status in message
  // without attaching a parsed body, the "504" substring triggers timeout copy.
  const err: PlantLiveErrorShape = {
    message: `Unexpected status 504 from /api/plant-live/summary?period=${MONTH}&plant=PIPE`,
    data: undefined,
  };
  const { heading, detail } = classifyPlantLiveError(err, MONTH);

  assert.equal(heading, "Plant live API timed out");
  assert.match(detail, /20 s/);
});

test("timeout code alone — no numeric status in message → 'Plant live API timed out'", () => {
  // Edge case: message says "Gateway Timeout" without the literal "504" but
  // the parsed body carries code=UPSTREAM_TIMEOUT.  Classification must still
  // be correct so ops never see the generic error for a timeout.
  const err: PlantLiveErrorShape = {
    message: "Gateway Timeout",
    data: { code: "UPSTREAM_TIMEOUT", upstreamErrorType: "timeout" },
  };
  const { heading } = classifyPlantLiveError(err, MONTH);

  assert.equal(heading, "Plant live API timed out");
});

// ── 502 upstream-error paths ─────────────────────────────────────────────────

test("502 non-2xx upstream error → 'Could not load plant live data' heading", () => {
  // 502 means the proxy reached prayag-plant.com but got an error back.
  // This is distinct from a timeout and must NOT show timeout copy.
  // Note: message must not contain "503" or "504" to avoid mis-classification.
  const err: PlantLiveErrorShape = {
    message: "HTTP 502 — upstream plant service error",
    data: { upstreamErrorType: "non-2xx" },
  };
  const { heading, detail, hint } = classifyPlantLiveError(err, MONTH);

  assert.equal(
    heading,
    "Could not load plant live data",
    "502 must show generic heading, not the timeout heading",
  );
  assert.match(detail, /upstream plant service returned an error/);
  assert.match(detail, /prayag-plant\.com is reachable/);
  assert.match(detail, /API key is valid/);
  assert.match(hint, /Diagnostic:/);
});

test("502 detail embeds the original error message so ops can copy it", () => {
  const err: PlantLiveErrorShape = {
    message: "HTTP 502 — connection refused",
    data: { upstreamErrorType: "non-2xx" },
  };
  const { detail } = classifyPlantLiveError(err, MONTH);

  assert.match(detail, /HTTP 502 — connection refused/);
});

test("502 hint embeds the current month for quick manual verification", () => {
  const err: PlantLiveErrorShape = {
    message: "HTTP 502 — upstream error",
    data: { upstreamErrorType: "non-2xx" },
  };
  const { hint } = classifyPlantLiveError(err, MONTH);

  assert.match(hint, new RegExp(`period=${MONTH}`));
});

test("upstream sign-in redirect → specific recoverable live-data copy", () => {
  const { heading, detail, hint } = classifyPlantLiveError(
    {
      message: "API error 502: Bad Gateway",
      data: { code: "UPSTREAM_AUTH_REDIRECT", upstreamErrorType: "auth-redirect" },
    },
    MONTH,
  );

  assert.equal(heading, "Live machine data needs attention");
  assert.match(detail, /sign-in page/i);
  assert.match(hint, /monthly and weekly monitoring data is still available/i);
});

test("non-JSON upstream response → specific recoverable live-data copy", () => {
  const { heading, detail, hint } = classifyPlantLiveError(
    {
      message: "API error 502: Bad Gateway",
      data: { upstreamErrorType: "bad-json" },
    },
    MONTH,
  );

  assert.equal(heading, "Live machine data returned an unexpected response");
  assert.match(detail, /non-JSON/i);
  assert.match(hint, /Refresh this card/i);
});

// ── 503 missing-key path ──────────────────────────────────────────────────────

test("503 missing API key → 'Plant live API not configured' heading", () => {
  const err: PlantLiveErrorShape = {
    message: "HTTP 503 — PRAYAG_PLANT_API_KEY not configured",
    data: undefined,
  };
  const { heading, detail } = classifyPlantLiveError(err, MONTH);

  assert.equal(heading, "Plant live API not configured");
  assert.match(detail, /PRAYAG_PLANT_API_KEY/);
  assert.match(detail, /deployment secrets panel/);
});

// ── priority ordering ─────────────────────────────────────────────────────────

test("503 takes priority over timeout signals in the same error", () => {
  // Pathological case: message includes both "503" and "504".  503 wins because
  // the missing-key message is evaluated first in the component.
  const err: PlantLiveErrorShape = {
    message: "HTTP 503 — also contains 504 somehow",
    data: { code: "UPSTREAM_TIMEOUT" },
  };
  const { heading } = classifyPlantLiveError(err, MONTH);

  assert.equal(heading, "Plant live API not configured", "503 must take priority over timeout");
});
