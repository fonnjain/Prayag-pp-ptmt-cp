import assert from "node:assert/strict";
import test from "node:test";
import { annotateWeeklyRelease, computeItemPlan, reconcilePendingPlan, summarizePlan, type CalcPlanItem } from "./calc";
import {
  PLUMBING_AUGUST_CATEGORY_FIXTURES,
  AUGUST_PLAN_BASELINES,
  AUGUST_WORKBOOK_PROVENANCE,
  PTMT_AUGUST_CATEGORY_FIXTURES,
  PTMT_AUGUST_ITEM_FIXTURES,
} from "./plan-august-fixtures";

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

function buildAugustCategoryFixturePlan(fixtures: typeof PTMT_AUGUST_CATEGORY_FIXTURES): CalcPlanItem[] {
  return fixtures.map((fixture) => {
    // One synthetic row represents each manual category total. Using the
    // category minimum as a zero-stock average makes the fixture exercise the
    // same buffer/min/max formula without importing live workbook data.
    const bufferReq = Math.round(fixture.minTotal * fixture.multiplier * 100) / 100;
    const pendingLastMo = fixture.maxTotal - bufferReq;
    return computeItemPlan(
      {
        itemCode: `AUG-${fixture.category}`,
        colour: "",
        avg3MoSaleTotal3Mo: fixture.minTotal * 3,
        stock: 0,
        stockNeedsReview: false,
        pendingOrderLastMonth: pendingLastMo,
        pendingOrder: 0,
        order: 0,
      },
      fixture.category,
      fixture.multiplier,
    );
  });
}

test("August manual category fixtures reproduce PTMT and Plumbing totals", () => {
  const ptmt = summarizePlan(buildAugustCategoryFixturePlan(PTMT_AUGUST_CATEGORY_FIXTURES));
  const plumbing = summarizePlan(buildAugustCategoryFixturePlan(PLUMBING_AUGUST_CATEGORY_FIXTURES));

  assert.deepEqual(ptmt.categories, PTMT_AUGUST_CATEGORY_FIXTURES.map(({ category, minTotal, maxTotal }) => ({
    category,
    minTotal,
    maxTotal,
  })));
  assert.equal(ptmt.grandMinTotal, 335_150);
  assert.equal(ptmt.grandMaxTotal, 618_010);

  assert.deepEqual(plumbing.categories, PLUMBING_AUGUST_CATEGORY_FIXTURES.map(({ category, minTotal, maxTotal }) => ({
    category,
    minTotal,
    maxTotal,
  })));
  assert.equal(plumbing.grandMinTotal, 1_231_731);
  assert.equal(plumbing.grandMaxTotal, 2_330_815.5);
});

test("August fixtures retain source provenance and the pending-state baselines", () => {
  assert.deepEqual(AUGUST_WORKBOOK_PROVENANCE, {
    PTMT: {
      workbookName: "Daily Production PTMT AUG' 2026",
      driveId: "1jy-T1ou7r67rWE8O_I6plrbJGXRlxnL0zJbJifHTqLc",
      modifiedTime: "2026-08-25T14:11:27.104Z",
    },
    Plumbing: {
      workbookName: "Daily Production PLUMBING AUG ' 2026",
      driveId: "1XIphSUrftEKRR93GyUF_XsE5yKWQhjeKUKCpx9IeO_U",
      modifiedTime: "2026-08-25T12:53:56.054Z",
    },
  });
  assert.equal(AUGUST_PLAN_BASELINES.Plumbing.pendingFixedGrandMax, 2_447_569.1);
  assert.equal(AUGUST_PLAN_BASELINES.Plumbing.livePendingGrandMax, 2_591_466);
});

test("August PTMT item fixtures preserve manual values and clamp only the negative row", () => {
  const computed = PTMT_AUGUST_ITEM_FIXTURES.map((fixture) => computeItemPlan(
    {
      itemCode: fixture.itemCode,
      colour: fixture.colour,
      avg3MoSaleTotal3Mo: fixture.avg3MoSale * 3,
      stock: fixture.stock,
      stockNeedsReview: false,
      pendingOrderLastMonth: fixture.pendingLastMo,
      pendingOrder: fixture.pending,
      order: 0,
    },
    fixture.category,
    fixture.bufferReq / fixture.avg3MoSale,
  ));

  assert.deepEqual(computed.map((item) => ({
    itemCode: item.itemCode,
    colour: item.colour,
    avg3MoSale: item.avg3MoSale,
    pendingOrder: item.pendingOrder,
    pendingOrderLastMonth: item.pendingOrderLastMonth,
    bufferReq: item.bufferReq,
    stock: item.stock,
    maxProduction: item.maxProduction,
  })), PTMT_AUGUST_ITEM_FIXTURES.map((fixture) => ({
    itemCode: fixture.itemCode,
    colour: fixture.colour,
    avg3MoSale: fixture.avg3MoSale,
    pendingOrder: fixture.pending,
    pendingOrderLastMonth: fixture.pendingLastMo,
    bufferReq: fixture.bufferReq,
    stock: fixture.stock,
    maxProduction: Math.max(fixture.prayagPlan, 0),
  })));
  assert.equal(computed[3]!.maxProduction, 0);
  assert.equal(PTMT_AUGUST_ITEM_FIXTURES[3]!.prayagPlan, -14_903);
});
