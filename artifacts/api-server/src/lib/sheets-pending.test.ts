import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePendingOrderRows, pendingOrderParsedValues, pendingOrderTotalsFromRows } from "./sheets";

const rows = [
  { SEGMENT: "PT", "ITEM CODE": "PT-1", COLOR: "WHITE", "BAL QTY": "10", Quantity: "999" },
  { Segment: "PTMT", "Item Code": "PT-2", Colour: "BLUE", "Bal. Qty": 5, Quantity: 500 },
  { Segment: "P", "Item Code": "PL-1", COLOR: "GREY", "Bal. Qty": "100", Quantity: 1000 },
  { Segment: "PL", "Old ERP Code": "PL-2", COLOR: "BLACK", "Bal. Qty": 25 },
  { Segment: "AGRI", "Item Code": "AG-1", COLOR: "BROWN", "Bal. Qty": 7 },
  { Segment: "OTHER", "Item Code": "NOPE", COLOR: "WHITE", "Bal. Qty": 1000 },
];

test("live pending PTMT filter uses Bal. Qty and supports normalised headers", () => {
  const totals = pendingOrderTotalsFromRows(rows, "PTMT");

  assert.equal(totals.byCode.get("PT-1"), 10);
  assert.equal(totals.byCode.get("PT-2"), 5);
  assert.equal([...totals.byCode.values()].reduce((sum, value) => sum + value, 0), 15);
  assert.equal(totals.byCode.has("PL-1"), false);
});

test("live pending Plumbing filter includes PLUMBING aliases P/PL/AGRI", () => {
  const totals = pendingOrderTotalsFromRows(rows, "Plumbing");

  assert.equal(totals.byCode.get("PL-1"), 100);
  assert.equal(totals.byCode.get("PL-2"), 25);
  assert.equal(totals.byCode.get("AG-1"), 7);
  assert.equal([...totals.byCode.values()].reduce((sum, value) => sum + value, 0), 132);
  assert.equal(totals.byCode.has("PT-1"), false);
});

test("live pending Plumbing filter includes current material-group segments", () => {
  const totals = pendingOrderTotalsFromRows([
    { SEGMENT: "CPVC", "Item Code": "CPVC-1", COLOR: "WHITE", "Bal. Qty": 96370 },
    { SEGMENT: "UPVC", "Item Code": "UPVC-1", COLOR: "WHITE", "Bal. Qty": 32274 },
    { SEGMENT: "SWR", "Item Code": "SWR-1", COLOR: "WHITE", "Bal. Qty": 18282 },
    { SEGMENT: "AGRI", "Item Code": "AGRI-1", COLOR: "WHITE", "Bal. Qty": 5699 },
    { SEGMENT: "PPR", "Item Code": "PPR-1", COLOR: "WHITE", "Bal. Qty": 5150 },
  ], "Plumbing");

  assert.equal([...totals.byCode.values()].reduce((sum, value) => sum + value, 0), 152625);
  assert.equal(totals.byCode.has("PPR-1"), false);
});

test("live pending report honours its embedded Old ERP Code header", () => {
  const topHeader = Array.from({ length: 24 }, () => "");
  topHeader[5] = "Item Group";
  topHeader[6] = "Item Code";
  topHeader[7] = "Item Name";
  topHeader[8] = "COLOR";
  topHeader[16] = "Bal. Qty";
  topHeader[23] = "SEGMENT";

  const embeddedHeader = Array.from({ length: 24 }, () => "");
  embeddedHeader[5] = "Old ERP Code";
  embeddedHeader[6] = "Item Name";
  embeddedHeader[7] = "Color";
  embeddedHeader[8] = "Name";
  embeddedHeader[16] = "Quantity";

  const row = Array.from({ length: 24 }, () => "");
  row[5] = "PS-2";
  row[6] = "CPVC PIPE 25MM";
  row[7] = "WHITE";
  row[16] = "125";
  row[23] = "CPVC";

  assert.deepEqual(
    pendingOrderParsedValues([topHeader, embeddedHeader, row], "Plumbing"),
    [{ catNo: "PS-2", colour: "WHITE", qty: 125 }],
  );
});

test("live pending parser preserves colour joins and applies legacy code alias", () => {
  const parsed = parsePendingOrderRows(
    [{ SEGMENT: "PTMT", "Item Code": "123-LSBB", COLOR: "BLACK", "Bal. Qty": 184 }],
    "PTMT",
  );

  assert.deepEqual(parsed, [{ catNo: "123-LSB", colour: "BLUE", qty: 184 }]);
}
);