import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyOrderType,
  getOrderType,
  getOrderTypeField,
  normalizeOrderType,
  ORDER_TYPES_BY_SEGMENT,
} from "./sheets";

test("Order Sheet TYPE mapping covers all supported PTMT and Plumbing types", () => {
  for (const type of ["PTMT", "CABINET", "CISTERN", "CONNECTION", "WASTE PIPE", "SEAT COVER", "QUAA", "CORRUGATED PIPE"]) {
    assert.equal(classifyOrderType(type), "PTMT", type);
  }
  for (const type of ["CPVC", "UPVC", "SWR", "AGRI", "GARDEN PIPE", "PPR", "COLUMN", "OPVC", "LPG PIPE", "WT LID"]) {
    assert.equal(classifyOrderType(type), "Plumbing", type);
  }
});

test("Order Sheet TYPE classification normalizes only trim and case, with exact membership", () => {
  assert.equal(normalizeOrderType("  wt lid "), "WT LID");
  assert.equal(classifyOrderType("  wt lid "), "Plumbing");
  assert.equal(classifyOrderType("C P"), "Excluded");
  assert.equal(classifyOrderType("HDPE PIPE"), "Excluded");
  assert.equal(classifyOrderType("CPVC PIPE"), "Excluded");
});

test("TYPE is read from the row and is authoritative over GROUP", () => {
  assert.equal(getOrderType({ TYPE: "WT LID", GROUP: "HDPE GROUP" }), "WT LID");
  assert.equal(classifyOrderType(getOrderType({ TYPE: "WT LID", GROUP: "HDPE GROUP" })), "Plumbing");
  assert.equal(ORDER_TYPES_BY_SEGMENT.Plumbing.includes("WT LID"), true);
});

test("a present but blank TYPE is excluded instead of falling back to GROUP", () => {
  const field = getOrderTypeField({ TYPE: " ", GROUP: "PTMT" });
  assert.deepEqual(field, { present: true, value: " " });
  assert.equal(classifyOrderType(field.value), "Excluded");
  assert.deepEqual(getOrderTypeField({ GROUP: "PTMT" }), { present: false, value: "" });
});