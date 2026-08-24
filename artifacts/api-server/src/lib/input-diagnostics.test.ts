import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseInputRows } from "./input-diagnostics";

test("input diagnostics identify a present code column with no balance quantity", () => {
  const diagnostics = diagnoseInputRows(
    [{ Segment: "PTMT", "Item Code": "144-O", Quantity: 827733 }],
    {
      code: ["Old Item Code", "Item Code", "Item No."],
      colour: ["Colour", "Color"],
      quantity: ["Balance_Qty", "Balance Qty", "Bal.Qty"],
    },
    {
      source: "DATA.xlsx (pending orders)",
      uploadId: 11,
      filename: "DATA.xlsx",
    },
  );

  assert.equal(diagnostics.rowCount, 1);
  assert.equal(diagnostics.codeRows, 1);
  assert.equal(diagnostics.quantityRows, 0);
  assert.equal(diagnostics.recognizedRows, 0);
  assert.equal(diagnostics.skippedRows, 1);
  assert.deepEqual(diagnostics.resolvedFields, {
    code: "Item Code",
    colour: null,
    quantity: null,
  });
  assert.deepEqual(diagnostics.missingRequiredFields, ["quantity"]);
  assert.equal(diagnostics.uploadId, 11);
  assert.deepEqual(diagnostics.presentHeaders, ["Item Code", "Quantity", "Segment"]);
});

test("input diagnostics recognize zero quantities when the balance field exists", () => {
  const diagnostics = diagnoseInputRows(
    [{ "Old Item Code": "144-O", Colour: "WHITE", "Bal.Qty": 0 }],
    {
      code: ["Old Item Code"],
      colour: ["Colour"],
      quantity: ["Bal.Qty"],
    },
    { source: "pending report" },
  );

  assert.equal(diagnostics.recognizedRows, 1);
  assert.equal(diagnostics.skippedRows, 0);
  assert.deepEqual(diagnostics.missingRequiredFields, []);
});

test("input diagnostics recognize the confirmed Bal. Qty open-balance header", () => {
  const diagnostics = diagnoseInputRows(
    [{ "Item Code": "144-O", Colour: "WHITE", "Bal. Qty": 12, Quantity: 999 }],
    {
      code: ["Old ERP Code", "Item Code", "Item No."],
      colour: ["Colour", "Color"],
      quantity: ["Balance_Qty", "Balance Qty", "Bal.Qty", "Bal. Qty"],
    },
    { source: "pending report" },
  );

  assert.equal(diagnostics.recognizedRows, 1);
  assert.equal(diagnostics.quantityRows, 1);
  assert.deepEqual(diagnostics.resolvedFields, {
    code: "Item Code",
    colour: "Colour",
    quantity: "Bal. Qty",
  });
  assert.deepEqual(diagnostics.missingRequiredFields, []);
});

test("input diagnostics normalise live report header casing and punctuation", () => {
  const diagnostics = diagnoseInputRows(
    [{ "ITEM CODE": "144-O", COLOR: "WHITE", "BAL QTY": 12, SEGMENT: "PT" }],
    {
      code: ["Old ERP Code", "Item Code", "Item No."],
      colour: ["Colour", "Color"],
      quantity: ["Bal. Qty"],
    },
    { source: "Pending order / report · PTMT" },
  );

  assert.equal(diagnostics.recognizedRows, 1);
  assert.deepEqual(diagnostics.resolvedFields, {
    code: "Item Code",
    colour: "Color",
    quantity: "Bal. Qty",
  });
  assert.deepEqual(diagnostics.missingRequiredFields, []);
});