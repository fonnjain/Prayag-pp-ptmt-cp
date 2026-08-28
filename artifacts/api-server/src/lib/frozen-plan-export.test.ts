import { test } from "node:test";
import assert from "node:assert/strict";
import type { FrozenPlanRow } from "./excel-export";
import {
  applyPlumbingScheduleToFrozenRows,
  PlumbingScheduleExportError,
  type PersistedPlumbingScheduleRow,
} from "./plumbing-schedule-export";
import {
  assertWeeklyProductionConservation,
  WeeklyExportInvariantError,
} from "./weekly-excel-export";

function row(
  itemCode: string,
  category: string,
  productionPlan: number,
): FrozenPlanRow {
  return {
    itemCode,
    colour: "WHITE",
    category,
    avg3MoSale: 100,
    stock: 0,
    pendingCurrent: 0,
    pendingLastMonth: 0,
    bufferReq: 0,
    minProduction: 0,
    productionPlan,
    temporaryPlan: productionPlan,
    cannotBeMade: 0,
    dummy: 0,
    orders: 0,
    buffer: productionPlan,
    material: category.split(" ")[0] ?? null,
    weightKg: 1,
    urgencyRank: 1,
    releaseWeek: null,
    w1: 0,
    w2: 0,
    w3: 0,
    w4: 0,
  };
}

function schedule(
  kind: "pipe" | "fitting",
  demand: string[],
  blocks: Array<Record<string, unknown>>,
  unfinished: Array<Record<string, unknown>> = [],
  weekDays = [6, 7, 7, 9],
): PersistedPlumbingScheduleRow {
  return {
    kind,
    batchId: "batch-1",
    weekDays,
    requestJson: {
      demand: demand.map((itemCode) => ({ item_code: itemCode, qty_pcs: 100 })),
    },
    resultJson: { blocks, unfinished },
  };
}

test("Plumbing export conserves scheduled pieces while using block-hour week shares", () => {
  const rows = applyPlumbingScheduleToFrozenRows(
    [
      row("P-1", "CPVC Pipe", 100),
      row("F-1", "UPVC Fitting", 50),
      row("S-1", "CPVC Solvent", 25),
    ],
    [
      schedule(
        "pipe",
        ["P-1"],
        [
          { item_code: "P1", week: 1, day: 1, planned_hours: 6, is_idle: false },
          { item_code: "P1", week: 2, day: 7, planned_hours: 4, is_idle: false },
        ],
        [{ item_code: "P1", remaining_pcs: 20 }],
      ),
      schedule(
        "fitting",
        ["F-1"],
        [
          { item_code: "F1", week: 2, day: 7, planned_hours: 3, is_idle: false },
          { item_code: "F1", week: 4, day: 21, planned_hours: 1, is_idle: false },
        ],
        [{ item_code: "F1", remaining_pcs: 5 }],
      ),
    ],
  );

  assert.deepEqual(rows[0]!.w1, 48);
  assert.deepEqual(rows[0]!.w2, 32);
  assert.equal(rows[0]!.productionPlan, 80);
  assert.equal(rows[0]!.cannotBeMade, 20);
  assert.equal(rows[1]!.w2, 33.75);
  assert.equal(rows[1]!.w4, 11.25);
  assert.equal(rows[1]!.productionPlan, 45);
  assert.equal(rows[2]!.w1, 25);
  assert.equal(rows.reduce((sum, item) => sum + item.productionPlan, 0), 150);
  assert.equal(rows.reduce((sum, item) => sum + item.w1 + item.w2 + item.w3 + item.w4, 0), 150);
  assertWeeklyProductionConservation(rows);
});

test("Plumbing export rejects a scheduler block whose week disagrees with sent boundaries", () => {
  assert.throws(
    () => applyPlumbingScheduleToFrozenRows(
      [row("P-1", "CPVC Pipe", 10)],
      [
        schedule("pipe", ["P-1"], [{ item_code: "P1", week: 1, day: 8, planned_hours: 1, is_idle: false }]),
        schedule("fitting", ["F-1"], [{ item_code: "F1", week: 1, day: 1, planned_hours: 1, is_idle: false }]),
      ],
    ),
    PlumbingScheduleExportError,
  );
});

test("weekly export guard rejects inconsistent frozen rows", () => {
  const inconsistent = row("P-1", "CPVC Pipe", 10);
  inconsistent.w1 = 9;
  assert.throws(
    () => assertWeeklyProductionConservation([inconsistent]),
    WeeklyExportInvariantError,
  );
});