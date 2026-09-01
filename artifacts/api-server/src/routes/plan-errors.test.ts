import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import {
  _setConnectorsForTest,
  listTabs,
  pendingOrderTotalsFromRows,
  UpstreamTimeoutError,
} from "../lib/sheets.js";
import {
  classifyPendingSource,
  buildPtmtPlanItemsForValidation,
  handlePlanError,
  preparePlumbingValidationEvidence,
  PLAN_PENDING_SOURCE,
  PlanningInputError,
  withSimulatedMissingUpload,
  effectivePlumbingBufferMultiplier,
} from "./plan.js";
import { computeItemPlan } from "../lib/calc.js";
import planRouter from "./plan.js";
import { parseStatusReasonInput } from "./plan-runs.js";
import { runCorrectiveReplan } from "../lib/corrective-engine.js";

test("withdrawn Plumbing codes keep pending demand but remove speculative buffer", () => {
  const demandOnlyCodes = ["C122", "C123", "U121", "U122", "U123"];
  for (const itemCode of demandOnlyCodes) {
    const item = computeItemPlan({
      itemCode,
      colour: "",
      avg3MoSaleTotal3Mo: 900,
      stock: 20,
      stockNeedsReview: false,
      pendingOrderLastMonth: 17,
      pendingOrder: 23,
      order: 0,
    }, "Plumbing Pipe", effectivePlumbingBufferMultiplier(itemCode, 1.5));

    assert.equal(item.bufferReq, null, itemCode);
    assert.equal(item.pendingOrderLastMonth, 17, itemCode);
    assert.equal(item.pendingOrder, 23, itemCode);
    assert.equal(item.maxProduction, 40, itemCode);
  }
});

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

test("plan routes surface named planning input failures as a 422 diagnostic", () => {
  let statusCode = 0;
  let body: Record<string, unknown> | undefined;
  const response = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: Record<string, unknown>) {
      body = value;
      return this;
    },
  };

  handlePlanError(
    response as never,
    new PlanningInputError("Pending join reconciliation failed for Plumbing last-month pending"),
  );

  assert.equal(statusCode, 422);
  assert.deepEqual(body, {
    error: "Pending join reconciliation failed for Plumbing last-month pending",
    kind: "PlanningInputError",
  });
});

test("validation failures include the persisted live pending capture id", () => {
  let statusCode = 0;
  let body: Record<string, unknown> | undefined;
  const response = {
    locals: { pendingReadCaptureId: 731 },
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(value: Record<string, unknown>) {
      body = value;
      return this;
    },
  };

  handlePlanError(
    response as never,
    new PlanningInputError("Pending join reconciliation failed for Plumbing current pending"),
  );

  assert.equal(statusCode, 422);
  assert.deepEqual(body, {
    error: "Pending join reconciliation failed for Plumbing current pending",
    kind: "PlanningInputError",
    pendingReadCaptureId: 731,
  });
});

test("validation evidence is persisted before an uploaded pending read can fail", async () => {
  const events: string[] = [];
  const liveTotals = pendingOrderTotalsFromRows([
    { Segment: "AGRI", "Item Code": "A-1", Color: "", "Bal. Qty": 25 },
  ], "Plumbing");
  const items = [{
    itemCode: "A-1",
    colour: "",
    category: "AGRI Pipe",
  }] as never;

  await assert.rejects(
    () => preparePlumbingValidationEvidence(
      731,
      liveTotals,
      items,
      async () => {
        events.push("uploaded-pending-read");
        throw new Error("uploaded pending source rejected");
      },
      {
        updateSnapshotDiagnostics: async () => {
          events.push("persist-live-evidence");
        },
        ensureBaseline: async () => {
          events.push("promote-baseline");
          return null;
        },
      },
    ),
    /uploaded pending source rejected/,
  );
  assert.deepEqual(events, [
    "persist-live-evidence",
    "promote-baseline",
    "uploaded-pending-read",
  ]);
});

test("Plumbing corrective live rebuild uses the month-correct source before machine checks", async () => {
  await assert.rejects(
    () => runCorrectiveReplan({
      month: "2026-07",
      segment: "Plumbing",
      weekClosed: 0,
      dryRun: true,
    }),
    (error: unknown) => {
      assert.match(
        String(error),
        /no non-idle corrective machine-hour blocks/,
      );
      return true;
    },
  );
});

test("plan-run status reason validation trims and rejects unsafe metadata", () => {
  assert.deepEqual(parseStatusReasonInput(undefined), {
    ok: false,
    error: "planStatusReason is required",
  });
  assert.deepEqual(parseStatusReasonInput({ planStatusReason: 123 }), {
    ok: false,
    error: "planStatusReason must be a string",
  });
  assert.deepEqual(parseStatusReasonInput({ planStatusReason: "   " }), {
    ok: false,
    error: "planStatusReason must not be empty",
  });
  assert.deepEqual(parseStatusReasonInput({ planStatusReason: "  reviewed upload #12  " }), {
    ok: true,
    reason: "reviewed upload #12",
  });
  assert.deepEqual(parseStatusReasonInput({ planStatusReason: "x".repeat(4_001) }), {
    ok: false,
    error: "planStatusReason must be at most 4000 characters",
  });
});

test("production-plan pending source is the uploaded file while live pending remains diagnostic-only", () => {
  assert.equal(PLAN_PENDING_SOURCE, "upload");
  assert.deepEqual(classifyPendingSource([
    { "Item Code": "120-WS", Colour: "WHITE", Quantity: 10 },
  ]), {
    layout: "invoice-register",
    hasCodeColumn: true,
    balanceColumns: [],
  });
  assert.deepEqual(classifyPendingSource([
    { "Item Code": "120-WS", Colour: "WHITE", "Bal. Qty": 10 },
  ]), {
    layout: "open-balance",
    hasCodeColumn: true,
    balanceColumns: ["Bal. Qty"],
  });
});

test("PTMT validation plan applies uploaded pending by colour and single-variant rules", () => {
  const uploadedPending = pendingOrderTotalsFromRows([
    { Segment: "PTMT", "Item Code": "MULTI", Colour: "WHITE", Balance_Qty: 12 },
    { Segment: "PTMT", "Item Code": "MULTI", Colour: "BLACK", Balance_Qty: 5 },
    { Segment: "PTMT", "Item Code": "MULTI", Colour: "GREEN", Balance_Qty: 100 },
    { Segment: "PTMT", "Item Code": "SINGLE", Colour: "RED", Balance_Qty: 7 },
    { Segment: "PTMT", "Item Code": "SINGLE", Colour: "BLUE", Balance_Qty: 8 },
  ], "PTMT");
  const emptyTotals = () => ({ exact: new Map<string, number>(), byCode: new Map<string, number>() });
  const inputs = {
    itemRows: [
      { id: 1, segment: "PTMT", category: "Cocks Standard", itemCode: "MULTI", colour: "WHITE" },
      { id: 2, segment: "PTMT", category: "Cocks Standard", itemCode: "MULTI", colour: "BLACK" },
      { id: 3, segment: "PTMT", category: "Cocks Standard", itemCode: "SINGLE", colour: "0" },
    ] as never,
    bufferRows: [{ name: "Cocks Standard", multiplier: 1 }] as never,
    avg3MoTotals: emptyTotals(),
    stockTotals: emptyTotals(),
    pendingLastMoTotals: emptyTotals(),
    liveOrderTotals: emptyTotals(),
    currentStockRows: [],
  };

  const items = buildPtmtPlanItemsForValidation({
    ...inputs,
    pendingTotals: uploadedPending,
  });

  assert.deepEqual(
    items.map((item) => ({ code: item.itemCode, colour: item.colour, pending: item.pendingOrder, plan: item.maxProduction })),
    [
      { code: "MULTI", colour: "WHITE", pending: 12, plan: 12 },
      { code: "MULTI", colour: "BLACK", pending: 5, plan: 5 },
      { code: "SINGLE", colour: "0", pending: 15, plan: 15 },
    ],
  );

  const missingUploadItems = buildPtmtPlanItemsForValidation({
    ...inputs,
    pendingTotals: emptyTotals(),
  });
  assert.notEqual(missingUploadItems[0]?.pendingOrder, 12);
  assert.notEqual(missingUploadItems[0]?.maxProduction, 12);
});

test("PTMT validation plan does not duplicate ambiguous pending across categories", () => {
  const pending = pendingOrderTotalsFromRows([
    { Segment: "PTMT", "Item Code": "SHARED", Colour: "GREEN", "Bal. Qty": 10 },
  ], "PTMT");
  const inputs = {
    itemRows: [
      { id: 1, segment: "PTMT", category: "Cocks Standard", itemCode: "SHARED", colour: "GREEN" },
      { id: 2, segment: "PTMT", category: "Cocks Premium", itemCode: "SHARED", colour: "GREEN" },
    ] as never,
    bufferRows: [
      { name: "Cocks Standard", multiplier: 1 },
      { name: "Cocks Premium", multiplier: 1 },
    ] as never,
    avg3MoTotals: { exact: new Map(), byCode: new Map() },
    stockTotals: { exact: new Map(), byCode: new Map() },
    pendingLastMoTotals: pending,
    liveOrderTotals: { exact: new Map(), byCode: new Map() },
    currentStockRows: [],
  };

  const items = buildPtmtPlanItemsForValidation({
    ...inputs,
    pendingTotals: pending,
  });

  assert.deepEqual(
    items.map((item) => ({
      category: item.category,
      pending: item.pendingOrder,
      pendingLastMonth: item.pendingOrderLastMonth,
    })),
    [
      { category: "Cocks Standard", pending: 0, pendingLastMonth: 0 },
      { category: "Cocks Premium", pending: 0, pendingLastMonth: 0 },
    ],
  );
});

test("PTMT validation endpoint rejects a missing pending upload instead of validating zero pending", async () => {
  const app = express();
  app.use("/api", planRouter);
  const server = http.createServer((req, res) => {
    void withSimulatedMissingUpload("pending_orders", async () => {
      app(req, res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;

  try {
    const response = await new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
      const request = http.get(
        `http://127.0.0.1:${port}/api/plan/validate?month=2026-08&segment=PTMT`,
        (res) => {
          let raw = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (raw += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(raw) }));
        },
      );
      request.on("error", reject);
    });
    assert.equal(response.status, 422);
    assert.equal(response.body.kind, "MissingUploadError");
    assert.match(String(response.body.error), /Current Pending Orders/);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});