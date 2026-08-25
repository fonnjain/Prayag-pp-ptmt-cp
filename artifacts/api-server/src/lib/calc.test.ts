import assert from "node:assert/strict";
import test from "node:test";
import { reconcilePendingPlan, type CalcPlanItem } from "./calc";

function item(
  itemCode: string,
  category: string,
  bufferReq: number,
  stock: number,
  pendingOrderLastMonth: number,
  pendingOrder: number,
  maxProduction: number,
): CalcPlanItem {
  return {
    itemCode,
    colour: "",
    category,
    avg3MoSale: 0,
    stock,
    stockNeedsReview: false,
    bufferReq,
    minProduction: 0,
    maxProduction,
    pendingOrderLastMonth,
    pendingOrder,
    order: 0,
    achievementPct: null,
    cover: "OS",
    week: null,
    w1: 0,
    w2: 0,
    w3: 0,
    w4: 0,
  };
}

test("reconcilePendingPlan exposes item-level clamp loss and exact identity", () => {
  const result = reconcilePendingPlan(
    [
      // Positive pre-pending demand: all pending becomes plan movement.
      item("POSITIVE", "CPVC Pipe", 100, 40, 0, 25, 85),
      // Negative pre-pending demand: 30 of 50 pending is absorbed by max(..., 0).
      item("CLAMPED", "CPVC Fitting", 10, 40, 0, 50, 20),
    ],
    75,
    75,
    0,
  );

  assert.equal(result.planMovement, 45);
  assert.equal(result.clampLoss, 30);
  assert.equal(result.unexplainedResidual, 0);
  assert.equal(result.clampedItemCount, 1);
  assert.deepEqual(result.clampedItems.map((entry) => ({
    itemCode: entry.itemCode,
    baseDemandBeforeCurrentPending: entry.baseDemandBeforeCurrentPending,
    unclampedBaseline: entry.unclampedBaseline,
    planWithoutCurrentPending: entry.planWithoutCurrentPending,
    planWithCurrentPending: entry.planWithCurrentPending,
    pendingContribution: entry.pendingContribution,
    pendingLostToClamping: entry.pendingLostToClamping,
  })), [{
    itemCode: "CLAMPED",
    baseDemandBeforeCurrentPending: -30,
    unclampedBaseline: 20,
    planWithoutCurrentPending: 0,
    planWithCurrentPending: 20,
    pendingContribution: 20,
    pendingLostToClamping: 30,
  }]);
});
