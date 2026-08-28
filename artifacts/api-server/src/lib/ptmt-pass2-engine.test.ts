import { test } from "node:test";
import assert from "node:assert/strict";
import type { CapacityMonthlyStats, CategoryCapacity } from "@workspace/db";
import { deriveMonthlyCapacitySignals, normalizeCapacityComparison } from "./capacity-engine";
import { countWorkingDaysInWeek } from "./working-days";
import { runPtmtPass2, selectPtmtCapacityWindow } from "./ptmt-pass2-engine";

function capacity(category: string, fullP90: number, recentP90: number, driftPct: number): CategoryCapacity {
  return {
    id: 1,
    segment: "PTMT",
    category,
    meanPerDay: 0,
    p90PerDay: fullP90,
    bestDay: 0,
    daysObserved: 100,
    trailingDays: 90,
    isThinData: 0,
    suggestedCapacity: fullP90,
    overrideCapacity: null,
    workingDaysPerWeek: 6,
    planNeedsPerDay: 0,
    windowStartDate: "2026-01-01",
    windowEndDate: "2026-08-31",
    comparisonJson: {
      fullWindow: { startDate: "2026-01-01", endDate: "2026-08-31", daysObserved: 100, meanPerDay: 0, p90PerDay: fullP90, bestDay: 0 },
      recent90d: { startDate: "2026-06-03", endDate: "2026-08-31", daysObserved: 50, meanPerDay: 0, p90PerDay: recentP90, bestDay: 0 },
      monthly: [],
      driftPct,
      recoveryDriftPct: null,
      monthlyP90CvPct: null,
      latestMonthlyP90: null,
      minPositiveMonthlyP90: null,
      zeroProductionMonths: [],
    },
    lastComputedAt: new Date("2026-08-31T00:00:00Z"),
  };
}

test("PTMT selects recent p90 for endpoint drift and latest-month recovery", () => {
  assert.equal(selectPtmtCapacityWindow(capacity("Faucets & Jetsprays & Shower", 100, 150, 50)).selectedWindow, "recent90d");
  assert.equal(selectPtmtCapacityWindow(capacity("Cocks Standard", 100, 150, 20)).selectedWindow, "fullWindow");
  assert.equal(selectPtmtCapacityWindow(capacity("Ball Cock", 100, 80, -20.1)).selectedWindow, "recent90d");
  const latestAboveFull = capacity("Cistern & Seat Cover", 100, 110, 0);
  latestAboveFull.comparisonJson!.monthly = [
    { month: "2026-01", startDate: "2026-01-01", endDate: "2026-01-31", daysObserved: 10, meanPerDay: 90, p90PerDay: 100, bestDay: 120 },
    { month: "2026-08", startDate: "2026-08-01", endDate: "2026-08-31", daysObserved: 10, meanPerDay: 100, p90PerDay: 110, bestDay: 130 },
  ];
  assert.equal(selectPtmtCapacityWindow(latestAboveFull).selectedWindow, "recent90d");
});

test("monthly capacity signals expose recovery and zero-production months", () => {
  const monthly: CapacityMonthlyStats[] = [
    { month: "2026-01", startDate: "2026-01-01", endDate: "2026-01-31", daysObserved: 10, meanPerDay: 1000, p90PerDay: 1220, bestDay: 1400 },
    { month: "2026-02", startDate: "2026-02-01", endDate: "2026-02-28", daysObserved: 10, meanPerDay: 900, p90PerDay: 1190, bestDay: 1300 },
    { month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31", daysObserved: 8, meanPerDay: 700, p90PerDay: 880, bestDay: 1000 },
    { month: "2026-04", startDate: "2026-04-01", endDate: "2026-04-30", daysObserved: 0, meanPerDay: 0, p90PerDay: 0, bestDay: 0 },
    { month: "2026-05", startDate: "2026-05-01", endDate: "2026-05-31", daysObserved: 8, meanPerDay: 800, p90PerDay: 1020, bestDay: 1100 },
    { month: "2026-06", startDate: "2026-06-01", endDate: "2026-06-30", daysObserved: 8, meanPerDay: 900, p90PerDay: 1100, bestDay: 1200 },
    { month: "2026-07", startDate: "2026-07-01", endDate: "2026-07-31", daysObserved: 8, meanPerDay: 850, p90PerDay: 1080, bestDay: 1150 },
    { month: "2026-08", startDate: "2026-08-01", endDate: "2026-08-31", daysObserved: 8, meanPerDay: 1000, p90PerDay: 1240, bestDay: 1500 },
  ];
  assert.deepEqual(deriveMonthlyCapacitySignals(monthly), {
    driftPct: 1.6,
    recoveryDriftPct: 40.9,
    monthlyP90CvPct: 10.7,
    latestMonthlyP90: 1240,
    minPositiveMonthlyP90: 880,
    zeroProductionMonths: ["2026-04"],
  });
});

test("legacy capacity comparisons are normalized without rewriting their source payload", () => {
  const monthly: CapacityMonthlyStats[] = [
    { month: "2026-01", startDate: "2026-01-01", endDate: "2026-01-31", daysObserved: 5, meanPerDay: 90, p90PerDay: 100, bestDay: 120 },
    { month: "2026-02", startDate: "2026-02-01", endDate: "2026-02-28", daysObserved: 0, meanPerDay: 0, p90PerDay: 0, bestDay: 0 },
    { month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31", daysObserved: 5, meanPerDay: 110, p90PerDay: 130, bestDay: 140 },
  ];
  const legacy = {
    fullWindow: { startDate: "2026-01-01", endDate: "2026-03-31", daysObserved: 10, meanPerDay: 100, p90PerDay: 130, bestDay: 140 },
    recent90d: { startDate: "2025-12-31", endDate: "2026-03-31", daysObserved: 10, meanPerDay: 100, p90PerDay: 130, bestDay: 140 },
    monthly,
    driftPct: 30,
  } as unknown as NonNullable<CategoryCapacity["comparisonJson"]>;
  const normalized = normalizeCapacityComparison(legacy);
  assert.equal(normalized?.driftPct, 30);
  assert.equal(normalized?.recoveryDriftPct, 30);
  assert.equal(normalized?.monthlyP90CvPct, 13);
  assert.equal(normalized?.latestMonthlyP90, 130);
  assert.equal(normalized?.minPositiveMonthlyP90, 100);
  assert.deepEqual(normalized?.zeroProductionMonths, ["2026-02"]);
});

test("weekly PTMT capacity uses the shared Sunday-aware calendar", () => {
  assert.equal(countWorkingDaysInWeek("2026-08", 1), 6);
  assert.equal(countWorkingDaysInWeek("2026-08", 2), 6);
  assert.equal(countWorkingDaysInWeek("2026-08", 3), 6);
  assert.equal(countWorkingDaysInWeek("2026-08", 4), 8);
  assert.equal(countWorkingDaysInWeek("2026-08", 1, ["2026-08-02"]), 7);
});

test("PTMT fitter prioritises dummy, then orders, then lowest-cover buffer and splits items", () => {
  const result = runPtmtPass2("2026-08", [
    {
      itemCode: "DUMMY",
      colour: "",
      category: "Cabinet",
      avg3MoSale: 100,
      stock: 0,
      pendingCurrent: 0,
      pendingLastMonth: 12,
      bufferReq: 20,
      minProduction: 20,
      temporaryPlan: 32,
    },
    {
      itemCode: "ORDER",
      colour: "",
      category: "Cabinet",
      avg3MoSale: 100,
      stock: 0,
      pendingCurrent: 18,
      pendingLastMonth: 0,
      bufferReq: 18,
      minProduction: 18,
      temporaryPlan: 18,
    },
    {
      itemCode: "BUFFER",
      colour: "",
      category: "Cabinet",
      avg3MoSale: 100,
      stock: 0,
      pendingCurrent: 0,
      pendingLastMonth: 0,
      bufferReq: 20,
      minProduction: 20,
      temporaryPlan: 20,
    },
  ], [capacity("Cabinet", 2, 2, 0)], []);

  assert.deepEqual(result.items.map((item) => [item.itemCode, item.productionPlan, item.cannotBeMade]), [
    ["DUMMY", 14, 18],
    ["ORDER", 18, 0],
    ["BUFFER", 20, 0],
  ]);
  assert.deepEqual(result.items[0] && [result.items[0].w1, result.items[0].w2, result.items[0].w3, result.items[0].w4], [12, 0, 0, 2]);
  assert.equal(result.invariants.conservation, true);
  assert.equal(result.invariants.weeklyCapacity, true);
  assert.equal(result.invariants.weeklySum, true);
  assert.equal(result.invariants.dummyPriority, true);
  assert.equal(result.invariants.temporaryPlanUnchanged, true);
});

test("worked Sundays increase only the relevant weekly capacity", () => {
  const result = runPtmtPass2("2026-08", [{
    itemCode: "A",
    colour: "",
    category: "Cabinet",
    avg3MoSale: 0,
    stock: 0,
    pendingCurrent: 0,
    pendingLastMonth: 0,
    bufferReq: 10,
    minProduction: 10,
    temporaryPlan: 20,
  }], [capacity("Cabinet", 1, 1, 0)], ["2026-08-02"]);
  assert.deepEqual(result.categories[0]?.workingDays, [7, 6, 6, 8]);
  assert.equal(result.workingDays, 27);
});