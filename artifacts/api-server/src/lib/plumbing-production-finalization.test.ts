import test from "node:test";
import assert from "node:assert/strict";
import {
  getPlumbingProductionFinalizationBlock,
} from "./plumbing-production-finalization";

test("allows an empty Plumbing roster through the zero-executable guard", () => {
  assert.equal(
    getPlumbingProductionFinalizationBlock("Plumbing", "production", []),
    null,
  );
});

test("does not apply the Plumbing guard to PTMT", () => {
  assert.equal(
    getPlumbingProductionFinalizationBlock("PTMT", "production", [
      { productionPlan: 0, demandPlan: 100 },
    ]),
    null,
  );
});

test("does not apply the guard to Temporary Plans", () => {
  assert.equal(
    getPlumbingProductionFinalizationBlock("Plumbing", "temporary", [
      { productionPlan: 0, demandPlan: 100 },
    ]),
    null,
  );
});

test("blocks a non-empty unfitted Plumbing Production Plan", () => {
  const block = getPlumbingProductionFinalizationBlock("Plumbing", "production", [
    { productionPlan: 0, demandPlan: 100, cannotBeMade: 0, feasibilityStatus: "not-scheduled" },
  ]);

  assert.equal(block?.error, "PLUMBING_PRODUCTION_NOT_FITTED");
  assert.equal(block?.classification, "UNFITTED_PLACEHOLDER");
  assert.equal(block?.rosterCount, 1);
  assert.equal(block?.executableTotal, 0);
  assert.equal(block?.demandTotal, 100);
  assert.equal(block?.unfeasibleTotal, 0);
});

test("classifies a genuine all-unfeasible zero separately", () => {
  const block = getPlumbingProductionFinalizationBlock("Plumbing", "production", [
    { productionPlan: 0, demandPlan: 70, cannotBeMade: 70, feasibilityStatus: "unfulfillable" },
    { productionPlan: 0, demandPlan: 30, cannotBeMade: 30, feasibilityStatus: "unfulfillable" },
  ]);

  assert.equal(block?.error, "PLUMBING_PRODUCTION_NOT_FITTED");
  assert.equal(block?.classification, "ALL_UNFEASIBLE");
  assert.equal(block?.demandTotal, 100);
  assert.equal(block?.unfeasibleTotal, 100);
});

test("allows a Plumbing Production Plan with executable output", () => {
  assert.equal(
    getPlumbingProductionFinalizationBlock("Plumbing", "production", [
      { productionPlan: 40, demandPlan: 100, cannotBeMade: 60 },
    ]),
    null,
  );
});