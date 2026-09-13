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
  exportWeeklyReleaseExcel,
} from "./weekly-excel-export";
import {
  addRunTraceSheet,
  buildPtmtTargetDecomposition,
  exportPrayagPlanExcel,
} from "./excel-export";
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
    bufferReq: 100,
    minProduction: 0,
    demandPlan: productionPlan,
    productionPlan,
    temporaryPlan: productionPlan,
    cannotBeMade: 0,
    feasibilityStatus: "fitted",
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

test("Plumbing export reads persisted executable net without subtracting unfinished again", () => {
  const pipe = row("P-1", "CPVC Pipe", 80);
  pipe.demandPlan = 100;
  pipe.temporaryPlan = 100;
  pipe.cannotBeMade = 20;
  const fitting = row("F-1", "UPVC Fitting", 45);
  fitting.demandPlan = 50;
  fitting.temporaryPlan = 50;
  fitting.cannotBeMade = 5;
  const rows = applyPlumbingScheduleToFrozenRows(
    [
      pipe,
      fitting,
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
  assert.equal(rows[1]!.cannotBeMade, 5);
  assert.equal(rows[2]!.w1, 25);
  assert.equal(rows.reduce((sum, item) => sum + item.productionPlan, 0), 150);
  assert.equal(rows.reduce((sum, item) => sum + item.w1 + item.w2 + item.w3 + item.w4, 0), 150);
  assertWeeklyProductionConservation(rows);
});

test("Plumbing export keeps Unclassified fitted rows visible without assigning machine weeks", () => {
  const unresolved = row("4507", "Unclassified", 0);
  unresolved.demandPlan = 125;
  unresolved.temporaryPlan = 125;
  unresolved.cannotBeMade = 125;
  unresolved.feasibilityStatus = "unfulfillable";
  const rows = applyPlumbingScheduleToFrozenRows(
    [unresolved, row("P-1", "CPVC Pipe", 100)],
    [
      schedule("pipe", ["P-1"], [{ item_code: "P1", week: 1, day: 1, planned_hours: 1, is_idle: false }]),
      schedule("fitting", [], []),
    ],
  );

  assert.equal(rows[0]!.productionPlan, 0);
  assert.equal(rows[0]!.cannotBeMade, 125);
  assert.equal(rows[0]!.releaseWeek, null);
  assert.deepEqual([rows[0]!.w1, rows[0]!.w2, rows[0]!.w3, rows[0]!.w4], [0, 0, 0, 0]);
});

test("Plumbing export refuses a stored batch when zero positive-demand rows were promoted", () => {
  const pipe = row("P-1", "CPVC Pipe", 100);
  const fitting = row("F-1", "UPVC Fitting", 50);
  pipe.feasibilityStatus = "not-scheduled";
  fitting.feasibilityStatus = "not-scheduled";

  assert.throws(
    () => applyPlumbingScheduleToFrozenRows(
      [pipe, fitting],
      [
        schedule("pipe", ["P-1"], []),
        schedule("fitting", ["F-1"], []),
      ],
    ),
    (error) => {
      assert.ok(error instanceof PlumbingScheduleExportError);
      assert.equal(error.code, "PLUMBING_SCHEDULE_EXPORT_NOT_PROMOTED");
      assert.match(error.message, /never promoted/);
      assert.match(error.message, /0 of 2 positive-demand rows \(2 total rows\)/);
      return true;
    },
  );
});

test("Plumbing export refuses a stored batch when only some positive-demand rows were promoted", () => {
  const pipe = row("P-1", "CPVC Pipe", 100);
  const fitting = row("F-1", "UPVC Fitting", 50);
  fitting.feasibilityStatus = "not-scheduled";

  assert.throws(
    () => applyPlumbingScheduleToFrozenRows(
      [pipe, fitting],
      [
        schedule("pipe", ["P-1"], []),
        schedule("fitting", ["F-1"], []),
      ],
    ),
    (error) => {
      assert.ok(error instanceof PlumbingScheduleExportError);
      assert.equal(error.code, "PLUMBING_SCHEDULE_EXPORT_PARTIALLY_PROMOTED");
      assert.match(error.message, /partially promoted/);
      assert.match(error.message, /1 of 2 positive-demand rows \(2 total rows\)/);
      return true;
    },
  );
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
  const dataLimitedRow = row("DL-1", "CPVC Pipe", 100);
  dataLimitedRow.feasibilityStatus = "data-limited";
  const result = applyPlumbingScheduleToFrozenRows(
    [dataLimitedRow],
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

  const sheetNames = workbook.worksheets.map((sheet) => sheet.name);
  assert.equal(sheetNames.includes("Plan at a glance"), true);
  assert.equal(sheetNames.includes("By master group"), true);
  assert.equal(sheetNames.includes("What needs attention"), true);
  assert.equal(sheetNames.includes("How to read this plan"), true);
  assert.equal(sheetNames.includes("Summary"), true);
  assert.equal(sheetNames.includes("Cocks Standard"), true);
  assert.equal(sheetNames.includes("Legend"), true);

  const attnSheet = workbook.getWorksheet("What needs attention");
  assert.ok(attnSheet!.rowCount <= 60, "attention rows should be under 60");

  const legendSheet = workbook.getWorksheet("Legend");
  const legendVals: string[] = [];
  legendSheet!.eachRow(r => {
    if (r.getCell(2).value) legendVals.push(String(r.getCell(2).value));
    if (r.getCell(3).value) legendVals.push(String(r.getCell(3).value));
    if (r.getCell(4).value) legendVals.push(String(r.getCell(4).value));
  });
  assert.ok(legendVals.includes("MAKE THIS MONTH > 0 (must produce this month)"), "Legend missing make this month");
  assert.ok(legendVals.includes("Final production quantity required this month to meet buffer, pending orders, and minimums."), "Legend missing formula");

  const cocksSheet = workbook.getWorksheet("Cocks Standard");
  assert.equal(cocksSheet!.views[0].state, "frozen");
  assert.equal(cocksSheet!.getCell("J3").numFmt, "#,##0");




  const summary = workbook.getWorksheet("Summary");
  assert.equal(summary?.getCell("A1").value, "PTMT Production Plan — 2026-09");
  const summaryHeaders = summary?.getRow(2).values;
  assert.ok(Array.isArray(summaryHeaders));
  assert.deepEqual(summaryHeaders.slice(1), [
    "Category",
    "Minimum",
    "MAKE THIS MONTH",
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
    "3-month average sale",
    "Live orders",
    "Already sold, undelivered",
    "Buffer target",
    "Stock in hand",
    "Minimum",
    "MAKE THIS MONTH",
    "Order",
    "Source Role",
    "Unmapped Reason",
    "Master Category",
    "Sub-category",
  ]);
  assert.equal(categorySheet?.getCell("A2").value, "P-1");
  assert.equal(categorySheet?.getCell("J2").value, 100);
});

test("PTMT target decomposition recomputes Prayag demand and preserves Ball Cock subtype ambiguity", () => {
  const decomposition = buildPtmtTargetDecomposition(
    "2026-09",
    [
      row("A-1", "Accessorise", 100),
      row("B-1", "Ball Cock", 100),
      row("C-1", "Cocks Standard", 100),
    ],
    {
      Accessorise: 1.0,
      "Ball Cock": 1.0,
      "Cocks Standard": 1.0,
    },
  );

  const accessorise = decomposition.find((item) => item.category === "Accessorise");
  assert.ok(accessorise);
  assert.equal(accessorise.appDemand, 100);
  assert.equal(accessorise.prayagMultiplier, 1.5);
  assert.equal(accessorise.prayagMultiplierReadDate, "2026-09-10");
  assert.equal(accessorise.multiplierEffect, -50);
  assert.equal(accessorise.residual, -38_270);

  const ballCock = decomposition.find((item) => item.category === "Ball Cock");
  assert.ok(ballCock);
  assert.equal(ballCock.appMultiplier, 1.0);
  assert.equal(ballCock.prayagMultiplier, null);
  assert.equal(ballCock.multiplierEffect, null);
  assert.match(ballCock.note, /sub-type lookup/);

  const cocksStandard = decomposition.find((item) => item.category === "Cocks Standard");
  assert.ok(cocksStandard);
  assert.equal(cocksStandard.multiplierEffect, 0);
});

test("PTMT target decomposition matches the current production Accessorise and Cocks Standard example", () => {
  const decomposition = buildPtmtTargetDecomposition(
    "2026-09",
    [
      {
        ...row("A-PROD", "Accessorise", 25_252),
        avg3MoSale: 25_252,
        bufferReq: 25_252,
      },
      {
        ...row("C-PROD", "Cocks Standard", 389_048),
        avg3MoSale: 389_048,
        bufferReq: 389_048,
      },
    ],
    {
      Accessorise: 1.0,
      "Cocks Standard": 1.0,
    },
  );

  const accessorise = decomposition.find((item) => item.category === "Accessorise");
  assert.ok(accessorise);
  assert.equal(accessorise.appDemand, 25_252);
  assert.equal(accessorise.difference, -13_168);
  assert.equal(accessorise.multiplierEffect, -12_626);
  assert.equal(accessorise.residual, -542);

  const cocksStandard = decomposition.find((item) => item.category === "Cocks Standard");
  assert.ok(cocksStandard);
  assert.equal(cocksStandard.appDemand, 389_048);
  assert.equal(cocksStandard.difference, 20_703);
  assert.equal(cocksStandard.multiplierEffect, 0);
  assert.equal(cocksStandard.residual, 20_703);
});

test("PTMT target decomposition shows effective frozen factor separately from recorded factor", () => {
  const decomposition = buildPtmtTargetDecomposition(
    "2026-09",
    [{
      ...row("A-EFFECTIVE", "Accessorise", 114),
      avg3MoSale: 100,
      bufferReq: 114,
    }],
    { Accessorise: 1.0 },
  );

  const accessorise = decomposition.find((item) => item.category === "Accessorise");
  assert.ok(accessorise);
  assert.equal(accessorise.appMultiplier, 1.14);
  assert.equal(accessorise.recordedMultiplier, 1.0);
  assert.equal(accessorise.factorStatus, "DISCREPANCY");
  assert.match(accessorise.note, /recorded factor 1\.00x disagrees with effective frozen-row factor 1\.14x/);
});

test("Temporary Plan RUN TRACE exposes source and factor provenance", () => {
  const workbook = new ExcelJS.Workbook();
  addRunTraceSheet(workbook, {
    version: 1,
    capturedAt: "2026-09-10T10:00:00.000Z",
    roster: {
      source: "REPORT_1_9",
      workbookId: "roster-workbook",
      rowCount: 123,
      fallbackReason: null,
    },
    salesHistory: {
      workbookId: "sales-workbook",
      label: "Sale 26-27",
    },
    uploads: {
      current_stock: {
        sourceKind: "current_stock",
        sourceUploadId: 11,
        sourceFilename: "current.xlsx",
        rowCount: 10,
        uploadedAt: "2026-09-10T09:00:00.000Z",
        usedForPlanning: true,
      },
    },
    factors: {
      Accessorise: {
        effectiveMultiplier: 1.14,
        recordedMultiplier: 1.5,
        status: "DISCREPANCY",
      },
    },
  });

  const trace = workbook.getWorksheet("RUN TRACE");
  assert.ok(trace);
  assert.equal(trace.getCell("B6").value, "REPORT_1_9");
  assert.equal(trace.getCell("B7").value, "roster-workbook");
  assert.equal(trace.getCell("B10").value, "sales-workbook");
  assert.equal(trace.getCell("A14").value, "current_stock");
  assert.equal(trace.getCell("A17").value, "Accessorise");
  assert.equal(trace.getCell("D17").value, "DISCREPANCY");
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

test("PTMT plan exports include new summary sheets and preserve correct column order", async () => {
  const r = row("101", "Cocks Standard", 100.5);
  r.itemName = "My Cock";
  const workbookBuffer = await exportPrayagPlanExcel(
    "2026-09",
    "production",
    [r],
    { "Cocks Standard": 1.5 },
    undefined,
    "PTMT",
    37,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  assert.equal(workbook.worksheets.map(s => s.name).includes("Plan at a glance"), true);
  assert.equal(workbook.worksheets.map(s => s.name).includes("By master group"), true);
  assert.equal(workbook.worksheets.map(s => s.name).includes("What needs attention"), true);
  assert.equal(workbook.worksheets.map(s => s.name).includes("How to read this plan"), true);
  assert.equal(workbook.worksheets.map(s => s.name).includes("Cocks Standard"), true);
  assert.equal(workbook.worksheets.map(s => s.name).includes("Legend"), true);
  assert.equal(
    workbook.getWorksheet("Plan at a glance")?.getCell("A1").value,
    "PTMT Production Plan at a glance — 2026-09 (Run 37)",
  );
  assert.equal(
    workbook.getWorksheet("Summary")?.getCell("A1").value,
    "PTMT Production Plan — 2026-09 (Run 37)",
  );

  const catSheet = workbook.getWorksheet("Cocks Standard")!;
  const catHeaders = catSheet.getRow(1).values as string[];
  // Check column names and order
  assert.equal(catHeaders[1], "Item Code");
  assert.equal(catHeaders[2], "Colour");
  assert.equal(catHeaders[3], "Item Name");
  assert.equal(catHeaders[4], "3-month average sale");
  assert.equal(catHeaders[10], "MAKE THIS MONTH");
  assert.equal(catHeaders[14], "Master Category");

  // Check fractional values preserved, but numFmt is #,##0
  const planCell = catSheet.getCell("J2"); // MAKE THIS MONTH is col J (10)
  assert.equal(planCell.value, 100.5);
  assert.equal(planCell.numFmt, "#,##0");

  // Check mapping fallback
  const masterCatCell = catSheet.getCell("N2"); // Master Category is col N (14)
  assert.equal(masterCatCell.value, "PTMT"); // 101 is mapped to PTMT
});

test("Weekly export appends W1-W4 sheets and conserves W1-W4", async () => {
  const r = row("101", "Cocks Standard", 100);
  r.w1 = 20; r.w2 = 30; r.w3 = 40; r.w4 = 10;

  const workbookBuffer = await exportWeeklyReleaseExcel("2026-09", [r], "capacity-fitted");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  assert.equal(workbook.getWorksheet("Week 1") !== undefined, true);
  assert.equal(workbook.getWorksheet("Week Summary") !== undefined, true);
  assert.equal(workbook.getWorksheet("Master Week Summary") !== undefined, true);

  const w1Sheet = workbook.getWorksheet("Week 1")!;
  assert.equal(w1Sheet.getCell("D3").value, 20); // Pieces This Week
  assert.equal(w1Sheet.getCell("E3").value, 20); // Running total

  const summarySheet = workbook.getWorksheet("Week Summary")!;
  assert.equal(summarySheet.getCell("F3").value, 100); // total for category

  const masterSheet = workbook.getWorksheet("Master Week Summary")!;
  assert.equal(masterSheet.getCell("G3").value, 100); // total for master category
});


test("Weekly export verifies requested CG requirements", async () => {
  const r1 = row("101", "Cocks Standard", 100);
  r1.pendingLastMonth = 50;
  r1.w1 = 20.5; r1.w2 = 30.5; r1.w3 = 40; r1.w4 = 9; // Top 20 volume in Week 1

  const r2 = row("102", "Cocks Premium", 0);
  r2.pendingLastMonth = 20;
  r2.cannotBeMade = 20;
  r2.w1 = 0; r2.w2 = 0; r2.w3 = 0; r2.w4 = 0; // Already sold but unscheduled

  const r3 = row("103", "Accessorise", 40);
  r3.w1 = 0; r3.w2 = 40; r3.w3 = 0; r3.w4 = 0; // Whole month scheduled in single week

  const r4 = row("104", "Faucets & Jetsprays & Shower", 30);
  r4.w1 = 0; r4.w2 = 0; r4.w3 = 0; r4.w4 = 30; // Scheduled exclusively in W4


  const workbookBuffer = await exportWeeklyReleaseExcel("2026-09", [r1, r2, r3, r4], "capacity-fitted", "Plumbing", {
    planType: "production",
    runId: 42,
    currentWeek: 1
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(workbookBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);

  // Check Calendar Header is exact and on every worksheet
  const expectedCalendar = "Working-day basis: September 2026 Plumbing [7,6,6,8]. Plumbing counts worked Sunday 2026-09-06 because its production evidence includes it; PTMT excludes the same Sunday.";
  workbook.worksheets.forEach(sheet => {
    assert.equal(sheet.getCell("A1").value, expectedCalendar, `Sheet ${sheet.name} missing calendar header at A1`);
  });

  // Check dual view in Master Week Summary
  const masterSheet = workbook.getWorksheet("By master group")!;
  const planCatHeader = masterSheet.getColumn("A").values;
  assert.ok(planCatHeader.includes("Planning Category"), "First table missing Planning Category header");
  assert.ok(planCatHeader.includes("Master Category"), "Second table missing Master Category header");

  // Check Plan at a glance contains 4 rows and exact totals
  const glanceSheet = workbook.getWorksheet("Plan at a glance")!;
  // Title should include segment, plan type, month, runId
  assert.equal(glanceSheet.getCell("A2").value, "Plumbing Production Plan at a glance — 2026-09 (Run 42)");

  const glanceMetrics = glanceSheet.getColumn("A").values;
  assert.ok(glanceMetrics.includes("Items Scheduled (count)"));
  assert.ok(glanceMetrics.includes("Pieces Scheduled"));
  assert.ok(glanceMetrics.includes("Already-Sold Pending Scheduled"));
  assert.ok(glanceMetrics.includes("Unscheduled / Cannot Be Made"));

  // Fractional weekly values unchanged (20.5 should be formatted but preserved)
  const w1Sheet = workbook.getWorksheet("Week 1")!;
  assert.equal(w1Sheet.getCell("D3").value, 20.5, "Fractional value lost");
  assert.equal(w1Sheet.getCell("D3").numFmt, "#,##0");

  // Check what needs attention is < 60 rows
  const attentionSheet = workbook.getWorksheet("What needs attention")!;
  assert.ok(attentionSheet.rowCount <= 61, "Attention sheet should be capped at 59 data rows (row count <= 61)");

  // Check attention sheet has deduplicated items based on 4 rules
  const reasons = attentionSheet.getColumn("A").values as string[];
  assert.ok(reasons.includes("Top 20 volume in Week 1"), "Missing Reason 1");
  assert.ok(reasons.includes("Already sold but unscheduled"), "Missing Reason 2");
  assert.ok(reasons.includes("Whole month scheduled in single week"), "Missing Reason 3");
  assert.ok(reasons.includes("Scheduled exclusively in W4"), "Missing Reason 4");

  const ptmtBuffer = await exportWeeklyReleaseExcel("2026-09", [r1, r2, r3, r4], "capacity-fitted", "PTMT", {
    planType: "production",
    runId: 37,
    currentWeek: 1,
  });
  const ptmtWorkbook = new ExcelJS.Workbook();
  await ptmtWorkbook.xlsx.load(ptmtBuffer as unknown as Parameters<typeof ptmtWorkbook.xlsx.load>[0]);
  const ptmtCalendar = "Working-day basis: September 2026 PTMT [6,6,6,8]. PTMT excludes Sunday 2026-09-06 because its calendar does not infer Sunday evidence; Plumbing counts the same Sunday as worked.";
  ptmtWorkbook.worksheets.forEach(sheet => {
    assert.equal(sheet.getCell("A1").value, ptmtCalendar, `Sheet ${sheet.name} missing PTMT calendar header at A1`);
  });
});