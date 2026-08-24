import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeCapByCategory,
  fetchCorrectiveLivePending,
  fetchCorrectivePtmtActuals,
  sumPendingUploads,
} from "./corrective-engine";
import { LivePendingReadError } from "./corrective-errors";

test("corrective Cap/Day excludes Sundays to match the calendar remainder", () => {
  const capacities = computeCapByCategory(new Map([
    ["Test", new Map([
      ["2026-08-01", 100],
      ["2026-08-02", 10_000],
      ["2026-08-03", 200],
      ["2026-08-09", 20_000],
    ])],
  ]));

  assert.deepEqual(capacities.get("Test"), { cap: 150, method: "mean", days: 2 });
});

test("corrective PTMT actuals failure rejects instead of becoming zero production", async () => {
  const expected = new Error("production source unavailable");

  await assert.rejects(
    fetchCorrectivePtmtActuals("2026-08", async () => {
      throw expected;
    }),
    (err: unknown) => err === expected,
  );
});

test("corrective live pending fetch failure rejects before a zero delta can be computed", async () => {
  const expected = new Error("pending sheet unavailable");
  const pendingAtPlan = 275;

  await assert.rejects(
    fetchCorrectiveLivePending(async () => {
      throw expected;
    }),
    (err: unknown) => {
      if (!(err instanceof LivePendingReadError)) return false;
      assert.equal(err.code, "LIVE_PENDING_READ_FAILED");
      assert.equal(err.causeMessage, expected.message);
      assert.equal(err.diagnostics.source, "Pending order / report");
      assert.equal(err.diagnostics.error, expected.message);
      assert.deepEqual(err.diagnostics.reasons, [`source read failed: ${expected.message}`]);
      // The failed read never supplies pendingNow, so the engine cannot turn
      // it into the misleading fallback 0 - pendingAtPlan.
      assert.notEqual(err, 0 - pendingAtPlan);
      return true;
    },
  );
});

test("corrective live pending keeps a successful zero-quantity read valid", async () => {
  const totals = await fetchCorrectiveLivePending(async () => ({
    exact: new Map([["144-O::WHITE", 0]]),
    byCode: new Map([["144-O", 0]]),
    diagnostics: {
      source: "Pending order / report",
      uploadId: null,
      filename: null,
      rowCount: 1,
      codeRows: 1,
      quantityRows: 1,
      recognizedRows: 1,
      skippedRows: 0,
      resolvedFields: { code: "Item Code", colour: "Colour", quantity: "Bal. Qty" },
      acceptedAliases: { code: ["Old ERP Code", "Item Code", "Item No."], colour: ["Colour"], quantity: ["Bal. Qty"] },
      presentHeaders: ["Bal. Qty", "Colour", "Item Code"],
      missingRequiredFields: [],
      reasons: [],
    },
  }));

  assert.equal(totals.byCode.get("144-O"), 0);
  assert.equal(totals.diagnostics?.recognizedRows, 1);
  assert.equal(totals.diagnostics?.error, undefined);
});

test("corrective live pending keeps an empty recognized-data read distinct from failure", async () => {
  const totals = await fetchCorrectiveLivePending(async () => ({
    exact: new Map(),
    byCode: new Map(),
    diagnostics: {
      source: "Pending order / report",
      uploadId: null,
      filename: null,
      rowCount: 2,
      codeRows: 2,
      quantityRows: 0,
      recognizedRows: 0,
      skippedRows: 2,
      resolvedFields: { code: "Item Code", colour: "Colour", quantity: null },
      acceptedAliases: { code: ["Old ERP Code", "Item Code", "Item No."], colour: ["Colour"], quantity: ["Bal. Qty"] },
      presentHeaders: ["Colour", "Item Code"],
      missingRequiredFields: ["quantity"],
      reasons: ["missing required fields: quantity"],
    },
  }));

  assert.equal(totals.exact.size, 0);
  assert.equal(totals.diagnostics?.recognizedRows, 0);
  assert.deepEqual(totals.diagnostics?.missingRequiredFields, ["quantity"]);
  assert.equal(totals.diagnostics?.error, undefined);
});

test("pending upload aggregation uses Bal. Qty and ignores invoice Quantity", () => {
  const result = sumPendingUploads(
    [{ "Item Code": "144-O", Colour: "WHITE", "Bal. Qty": 12, Quantity: 999 }],
    { source: "DATA.xlsx (pending orders)" },
  );

  assert.equal(result.totals.get("144-O::WHITE"), 12);
  assert.equal(result.diagnostics.resolvedFields.code, "Item Code");
  assert.equal(result.diagnostics.resolvedFields.quantity, "Bal. Qty");
  assert.equal(result.diagnostics.recognizedRows, 1);
});