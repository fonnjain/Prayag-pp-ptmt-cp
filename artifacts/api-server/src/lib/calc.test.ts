import assert from "node:assert/strict";
import test from "node:test";
import { annotateWeeklyRelease, reconcilePendingPlan, type CalcPlanItem } from "./calc";

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

function weeklyItem(
  itemCode: string,
  category: string,
  cover: number | "OS",
  maxProduction: number,
): CalcPlanItem {
  return {
    itemCode,
    colour: "",
    category,
    avg3MoSale: cover === "OS" ? 0 : 100,
    stock: cover === "OS" ? 0 : Number(cover) * 100,
    stockNeedsReview: false,
    bufferReq: 0,
    minProduction: 0,
    maxProduction,
    pendingOrderLastMonth: 0,
    pendingOrder: maxProduction,
    order: 0,
    achievementPct: null,
    cover,
    week: null,
    w1: 0,
    w2: 0,
    w3: 0,
    w4: 0,
  };
}

test("annotateWeeklyRelease schedules OS and high-cover pending demand in W1", () => {
  const items = [
    weeklyItem("OS-PENDING", "CPVC Fitting", "OS", 110),
    weeklyItem("HIGH-COVER-PENDING", "CPVC Fitting", 99, 25),
    weeklyItem("BEYOND-COVER-PENDING", "CPVC Fitting", 100, 12),
    weeklyItem("W1-COVER", "CPVC Fitting", 0.2, 10),
    weeklyItem("W2-COVER", "CPVC Fitting", 0.3, 20),
    weeklyItem("W3-COVER", "CPVC Fitting", 0.5, 30),
    weeklyItem("W4-COVER", "CPVC Fitting", 0.8, 40),
    weeklyItem("ZERO", "CPVC Fitting", "OS", 0),
  ];
  items[7]!.week = 4;
  items[7]!.w4 = 9;

  annotateWeeklyRelease(items, new Map([
    ["CPVC Fitting", { w1Upper: 0.3, w2Upper: 0.5, w3Upper: 0.8, w4Upper: 99 }],
  ]));

  assert.deepEqual(items.map((item) => item.week), [1, 1, 1, 1, 2, 3, 4, null]);
  for (const item of items) {
    assert.equal(item.w1 + item.w2 + item.w3 + item.w4, item.maxProduction);
  }
  assert.equal(items[7]!.w1, 0);
  assert.equal(items[7]!.w4, 0);
});

test("annotateWeeklyRelease uses W1 when a positive item has no category band", () => {
  const item = weeklyItem("NO-BAND", "Missing Category", "OS", 12);
  annotateWeeklyRelease([item], new Map());
  assert.equal(item.week, 1);
  assert.equal(item.w1, 12);
  assert.equal(item.w2 + item.w3 + item.w4, 0);
});
