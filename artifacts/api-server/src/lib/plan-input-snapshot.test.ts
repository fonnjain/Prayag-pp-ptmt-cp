import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildPlanRunInputSnapshot,
  parsePendingRows,
  pendingSnapshotStatus,
} from "./plan-input-snapshot";

test("pending snapshot preserves source identity, raw rows, parsed zero, and diagnostics", () => {
  const rows = [
    { Segment: "PTMT", "Item Code": "144", Colour: "WHITE", "Balance Qty": 0 },
    { Segment: "PTMT", "Item Code": "145", Colour: "BLUE" },
  ];
  const snapshot = buildPlanRunInputSnapshot({
    segment: "PTMT",
    sourceRole: "pending_current",
    sourceKind: "pending_orders",
    source: {
      id: 42,
      filename: "DATA.xlsx",
      rowCount: 2,
      uploadedAt: new Date("2026-08-17T10:00:00.000Z"),
    },
    rows,
    aliases: {
      code: ["Item Code"],
      colour: ["Colour"],
      quantity: ["Balance Qty"],
    },
  });

  assert.equal(snapshot.sourceUploadId, 42);
  assert.equal(snapshot.sourceFilename, "DATA.xlsx");
  assert.deepEqual(snapshot.rawRows, rows);
  assert.deepEqual(snapshot.parsedRows, [{ itemCode: "144", colour: "WHITE", qty: 0 }]);
  assert.equal(snapshot.diagnostics.rowCount, 2);
  assert.equal(snapshot.diagnostics.recognizedRows, 1);
  assert.equal(snapshot.diagnostics.skippedRows, 1);
  assert.deepEqual(snapshot.diagnostics.presentHeaders, ["Balance Qty", "Colour", "Item Code", "Segment"]);
});

test("negative FG stock quantities are parsed as last-month pending without changing source rows", () => {
  const rows = [
    { "Item Code": "PIPE-1", "Net Stock": -12 },
    { "Item Code": "PIPE-2", "Net Stock": 4 },
  ];
  assert.deepEqual(
    parsePendingRows(rows, { code: ["Item Code"], colour: [], quantity: ["Net Stock"] }, (qty) => Math.max(-qty, 0)),
    [
      { itemCode: "PIPE-1", colour: "", qty: 12 },
      { itemCode: "PIPE-2", colour: "", qty: 0 },
    ],
  );
});

test("legacy plan runs are explicitly distinguishable from captured runs", () => {
  assert.equal(pendingSnapshotStatus(2), "captured");
  assert.equal(pendingSnapshotStatus(0), "not-captured");
});

test("live pending snapshot keeps a reproducible source content hash in diagnostics", () => {
  const snapshot = buildPlanRunInputSnapshot({
    segment: "Plumbing",
    sourceRole: "pending_current",
    sourceKind: "pending_order_live_sheet",
    source: {
      id: null,
      filename: "Pending order / report",
      rowCount: 1,
      uploadedAt: null,
      sourceContentHash: "sha256:test",
    },
    rows: [{ "Item Code": "PIPE-1", Colour: "WHITE", "Bal. Qty": 12, Segment: "P" }],
    aliases: {
      code: ["Item Code"],
      colour: ["Colour"],
      quantity: ["Bal. Qty"],
    },
  });

  assert.equal(snapshot.sourceUploadId, null);
  assert.equal(snapshot.sourceKind, "pending_order_live_sheet");
  assert.equal((snapshot.diagnostics as InputReadDiagnosticsWithHash).sourceContentHash, "sha256:test");
});

type InputReadDiagnosticsWithHash = ReturnType<typeof buildPlanRunInputSnapshot>["diagnostics"] & {
  sourceContentHash?: string;
};