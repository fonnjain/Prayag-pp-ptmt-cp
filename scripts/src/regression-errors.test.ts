import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyEndpointFailure,
  classifyTransportFailure,
  UpstreamAvailabilityError,
} from "./regression-errors.js";

test("classifies the API timeout response as an upstream availability issue", () => {
  const error = classifyEndpointFailure(
    "http://api.test/api/plan/validate",
    504,
    JSON.stringify({
      error: "UPSTREAM_TIMEOUT",
      message: "Google Sheets did not respond in time",
      retryable: true,
    }),
  );

  assert.ok(error instanceof UpstreamAvailabilityError);
  assert.equal(error.kind, "upstream-availability");
  assert.equal(error.code, "UPSTREAM_TIMEOUT");
  assert.match(error.message, /UPSTREAM AVAILABILITY/);
  assert.match(error.message, /retry the regression run/);
});

test("keeps application failures distinct from upstream availability failures", () => {
  const error = classifyEndpointFailure(
    "http://api.test/api/plan/validate",
    500,
    '{"error":"Failed to compute plan"}',
  );

  assert.equal(error instanceof UpstreamAvailabilityError, false);
  assert.match(error.message, /HTTP 500/);
  assert.match(error.message, /Failed to compute plan/);
});

test("classifies a transport timeout as an upstream availability issue", () => {
  const error = classifyTransportFailure(
    "http://api.test/api/plan/validate",
    Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }),
  );

  assert.ok(error instanceof UpstreamAvailabilityError);
  assert.equal(error.status, 0);
  assert.match(error.message, /UPSTREAM AVAILABILITY/);
});