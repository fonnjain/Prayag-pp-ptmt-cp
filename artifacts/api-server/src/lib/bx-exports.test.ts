import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import { normalizeStoredMachinePlanning, type StoredMachinePlanningInput } from "./machine-planning";
import {
  assertBxConservation,
  buildBxPayload,
  exportMachineFeasibleExcel,
  exportWeeklyReleaseBxExcel,
} from "./bx-exports";
import { governedLineageExportFilename } from "./export-filename";

function fixture(): StoredMachinePlanningInput {
  const run = {
    id: 44, month: "2026-09", segment: "Plumbing", planType: "production",
    temporaryRunId: 42, supersedesRunId: null, status: "finalized",
    createdAt: new Date("2026-09-01T00:00:00Z"),
  } as any;
  return {
    run,
    sourceRun: { ...run, id: 42, planType: "temporary", status: "finalized" },
    sourceResults: [
      {
        itemCode: "P-1", itemName: "Pipe one", category: "CPVC Pipe", material: "CPVC",
        demandPlan: 12.5, temporaryPlan: 12.5, productionPlan: 12.5,
        pendingLastMonth: 1.5, pendingCurrent: 2.5, totalKg: 1.25,
      },
      {
        itemCode: "P-2", itemName: "Pipe two", category: "CPVC Pipe", material: "",
        demandPlan: 5.25, temporaryPlan: 5.25, productionPlan: 5.25,
        pendingLastMonth: 0, pendingCurrent: 0, totalKg: 1,
      },
      {
        itemCode: "X-1", itemName: "Unclassified", category: "Unclassified", material: "UPVC",
        sourceRole: "Unclassified", demandPlan: 7.4, temporaryPlan: 7.4, productionPlan: 7.4,
        pendingLastMonth: 0, pendingCurrent: 0, totalKg: 0,
      },
    ] as any,
    results: [] as any,
    machines: [{ machineId: "M1", pool: "PIPE", rates: { CPVC: 1 }, shiftsPerDay: 1, hoursPerShift: 10 }] as any,
    schedules: [{
      kind: "pipe", batchId: "bx", weekDays: [7, 6, 6, 8],
      createdAt: new Date("2026-09-02T00:00:00Z"),
      demandPieces: 12.5, scheduledPieces: 10.25,
      requestJson: { demand: [{ item_code: "P-1", qty_pcs: 12.5 }] },
      resultJson: {
        allocations: [{
          item_code: "P-1", machine: "M1", day: 2, planned_hours: 2,
          scheduled_net_pcs: 10.25, scheduled_gross_pcs: 11, scheduled_kg: 1.1,
        }],
        weekly_fill: [{ machine: "M1", week: 1, capacity_hrs: 10, scheduled_hrs: 2, idle_hrs: 8 }],
        coverage: { items: [{ item_code: "P-1", requested_pcs: 12.5, status: "schedulable" }] },
        unfinished: [{ item_code: "P-1", remaining_net_pcs: 2.25 }],
      },
    }] as any,
  };
}

test("BX payload uses stored allocation/day placement and conserves every row", () => {
  const bx = buildBxPayload(normalizeStoredMachinePlanning(fixture()));
  assert.equal(bx.productionRunId, 44);
  assert.equal(bx.temporaryRunId, 42);
  assert.equal(bx.calendar, "September 2026 Plumbing [7,6,6,8] working days");
  const scheduled = bx.items.find((item) => item.itemCode === "P-1")!;
  assert.equal(scheduled.machineScheduled, 10.25);
  assert.equal(scheduled.demand, 13);
  assert.equal(scheduled.assumed, 2.75);
  assert.equal(scheduled.status, "PART SCHEDULED");
  assert.equal(scheduled.reason, "unfinished due to capacity");
  assert.deepEqual(scheduled.machineWeeks, [10.25, 0, 0, 0]);
  assert.equal(scheduled.assumedWeeks[0], 2.75 * 7 / 27 + 0);
  const unknown = bx.items.find((item) => item.itemCode === "P-2")!;
  assert.equal(unknown.status, "NOT SENT — assumed");
  assert.equal(unknown.reason, "material unknown");
  const unclassified = bx.items.find((item) => item.itemCode === "X-1")!;
  assert.equal(unclassified.demand, 7, "export demand uses the fit-summary per-row rounded basis");
  assert.equal(unclassified.reason, "allocation shortfall");
  assert.equal(bx.totals.demand, bx.totals.w1 + bx.totals.w2 + bx.totals.w3 + bx.totals.w4);
  assertBxConservation(bx.items);
});

test("BX exports have exactly the governed sheets and frozen B6 layout", async () => {
  const payload = normalizeStoredMachinePlanning(fixture());
  const machine = new ExcelJS.Workbook();
  await machine.xlsx.load(await exportMachineFeasibleExcel(payload) as any);
  assert.deepEqual(machine.worksheets.map((sheet) => sheet.name), [
    "Plan at a glance", "Item plan", "Assumed feasible", "How to read this plan",
  ]);
  for (const sheet of machine.worksheets) {
    assert.equal((sheet.views[0] as any)?.showGridLines, false);
    assert.equal((sheet.views[0] as any)?.xSplit, 1);
    assert.equal((sheet.views[0] as any)?.ySplit, 5);
    assert.equal(sheet.getCell("B6").value != null, true);
  }

  const weekly = new ExcelJS.Workbook();
  await weekly.xlsx.load(await exportWeeklyReleaseBxExcel(payload) as any);
  assert.deepEqual(weekly.worksheets.map((sheet) => sheet.name), [
    "Week summary", "Week 1", "Week 2", "Week 3", "Week 4", "How to read this plan",
  ]);
  assert.equal(weekly.getWorksheet("Week 1")!.getCell("B6").value, "Item code");
});

test("BX lineage filename is derived from both stored runs", () => {
  assert.equal(
    governedLineageExportFilename({
      segment: "Plumbing",
      kind: "MachineFeasible",
      month: "2026-09",
      temporaryRunId: 42,
      productionRunId: 44,
      extension: "xlsx",
    }),
    "Plumbing_MachineFeasible_2026-09_Run42_Run44.xlsx",
  );
  assert.equal(
    governedLineageExportFilename({
      segment: "Plumbing",
      kind: "WeeklyRelease",
      month: "2026-09",
      temporaryRunId: 42,
      productionRunId: 44,
      extension: "xlsx",
    }),
    "Plumbing_WeeklyRelease_2026-09_Run42_Run44.xlsx",
  );
});
