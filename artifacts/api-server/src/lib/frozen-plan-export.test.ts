import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
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
import { exportPrayagPlanExcel } from "./excel-export";
import {
  addPlumbingAchievabilitySheets,
  buildPlumbingAchievability,
} from "./plumbing-achievability-export";

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
    totalKg: 1,
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

test("Plumbing export keeps data-limited rows separate from unfinished work", () => {
  const limited = schedule("pipe", ["DL-1"], []);
  limited.resultJson.data_limited = [{
    item_code: "DL1",
    reasons: ["missing_bom"],
    reason_text: ["No BOM weight is available."],
  }];
  const result = applyPlumbingScheduleToFrozenRows(
    [row("DL-1", "CPVC Pipe", 100)],
    [
      limited,
      schedule("fitting", ["F-1"], []),
    ],
  )[0]!;

  assert.equal(result.productionPlan, 0);
  assert.equal(result.cannotBeMade, 0);
  assert.equal(result.dataLimited, true);
  assert.equal(result.dataLimitedReason, "missing_bom; No BOM weight is available.");
  assert.deepEqual([result.w1, result.w2, result.w3, result.w4], [0, 0, 0, 0]);
});

test("weekly export guard rejects inconsistent frozen rows", () => {
  const inconsistent = row("P-1", "CPVC Pipe", 10);
  inconsistent.w1 = 9;
  assert.throws(
    () => assertWeeklyProductionConservation([inconsistent]),
    WeeklyExportInvariantError,
  );
});

test("PTMT plan exports use the compact summary and category-tab format", async () => {
  const workbookBuffer = await exportPrayagPlanExcel(
    "2026-09",
    "production",
    [row("P-1", "Cocks Standard", 100)],
    { "Cocks Standard": 1.5 },
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    workbookBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
  );

  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    "Summary",
    "Cocks Standard",
    "Legend",
  ]);

  const summary = workbook.getWorksheet("Summary");
  assert.equal(summary?.getCell("A1").value, "PTMT Production Plan — 2026-09");
  const summaryHeaders = summary?.getRow(2).values;
  assert.ok(Array.isArray(summaryHeaders));
  assert.deepEqual(summaryHeaders.slice(1), [
    "Category",
    "Min Production Required",
    "Max Production Required",
  ]);
  assert.equal(summary?.getCell("A3").value, "Cocks Standard");
  assert.equal(summary?.getCell("C3").value, 100);

  const categorySheet = workbook.getWorksheet("Cocks Standard");
  const categoryHeaders = categorySheet?.getRow(1).values;
  assert.ok(Array.isArray(categoryHeaders));
  assert.deepEqual(categoryHeaders.slice(1), [
    "Item Code",
    "Colour",
    "Item Name",
    "Source Role",
    "Unmapped Reason",
    "Avg 3-Mo Sale",
    "Pending Order",
    "Pending Last Mo",
    "Buffer Req",
    "Stock",
    "Min Production",
    "Production Plan",
    "Order",
  ]);
  assert.equal(categorySheet?.getCell("A2").value, "P-1");
  assert.equal(categorySheet?.getCell("L2").value, 100);
});

test("Plumbing achievability conserves temporary demand independently", async () => {
  const rows = [
    {
      ...row("F-1", "CPVC Fitting", 80),
      temporaryPlan: 80,
      pendingLastMonth: 20,
      pendingCurrent: 20,
      dummy: 20,
      orders: 20,
      buffer: 40,
      totalKg: 80,
      avg3MoSale: 100,
      stock: 0,
    },
    {
      ...row("F-2", "UPVC Fitting", 20),
      temporaryPlan: 20,
      pendingLastMonth: 0,
      pendingCurrent: 0,
      dummy: 0,
      orders: 0,
      buffer: 20,
      totalKg: null,
    },
  ];
  const machines = [{
    id: 1,
    segment: "Plumbing",
    machineId: "MC1",
    label: "MC1",
    pool: "MOULDING",
    lockedOut: false,
    shiftsPerDay: 2,
    hoursPerShift: 1,
    workingDays: 25,
    rates: { ALL: 1 },
  }] as never;
  const analysis = buildPlumbingAchievability("2026-09", rows, machines, [
    { categoryName: "CPVC Fitting", w1Upper: 1, w2Upper: 2, w3Upper: 3, w4Upper: 4 },
    { categoryName: "UPVC Fitting", w1Upper: 1, w2Upper: 2, w3Upper: 3, w4Upper: 4 },
  ]);

  assert.equal(analysis.totalTemporaryDemand, 100);
  assert.equal(
    Math.round((analysis.totalAchievable + analysis.totalUnfeasible) * 100) / 100,
    100,
  );
  assert.equal(analysis.reasons.find((reason) => reason.reason === "NO BOM WEIGHT")?.rowCount, 1);
  assert.equal(analysis.items.find((item) => item.itemCode === "F-1")?.achievable, 48);

  const workbook = new ExcelJS.Workbook();
  addPlumbingAchievabilitySheets(workbook, analysis);
  assert.equal(workbook.getWorksheet("WHAT CAN BE ACHIEVED")?.getCell("A1").value,
    "WHAT CAN BE ACHIEVED — Plumbing — 2026-09");
  assert.equal(workbook.getWorksheet("WHAT CAN BE ACHIEVED")?.getCell("B2").value,
    "An item may run on more than one machine; this is the first allocation machine.");
  assert.equal(workbook.getWorksheet("WHAT CAN BE ACHIEVED")?.getColumn(14).values
    .includes("First allocation machine"), true);
  assert.equal(workbook.getWorksheet("UNFEASIBLE FOR THE MONTH")?.getCell("A1").value,
    "These quantities cannot be produced in September 2026. They do NOT carry forward to October.");
  const machineLoad = workbook.getWorksheet("MACHINE LOAD BY WEEK");
  assert.equal(machineLoad?.getCell("A1").value, "MACHINE LOAD BY WEEK — Plumbing — 2026-09");
  assert.equal(machineLoad?.getCell("A4").value, "Machine hours used");
  assert.equal(machineLoad?.getRow(11).getCell(1).value, "MC1");
  assert.equal(machineLoad?.getRow(11).getCell(4).value, "No");
});
