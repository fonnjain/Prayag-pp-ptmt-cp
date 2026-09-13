import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import {
  machinePlanningUnavailable,
  normalizeStoredMachinePlanning,
  type StoredMachinePlanningInput,
} from "./machine-planning";
import { exportMachineWiseExcel, exportPlanningFormatExcel } from "./machine-planning-export";

function fixture(): StoredMachinePlanningInput {
  const run = {
    id: 91, month: "2026-09", segment: "Plumbing", planType: "production",
    temporaryRunId: 77, supersedesRunId: null, status: "draft", createdAt: new Date("2026-09-01T00:00:00Z"),
  } as any;
  return {
    run,
    sourceRun: { ...run, id: 77, planType: "temporary", status: "finalized" },
    sourceResults: [{
      itemCode: "P-1", itemName: "Pipe one", category: "CPVC Pipe", material: "CPVC",
      demandPlan: 12.5, productionPlan: 12.5, temporaryPlan: 12.5, totalKg: 1.25,
    }] as any,
    results: [] as any,
    machines: [{
      machineId: "M1", pool: "PIPE", rates: { CPVC: 1 }, shiftsPerDay: 1, hoursPerShift: 10,
    }, {
      machineId: "M2", pool: "MOULDING", rates: { ALL: 1 }, shiftsPerDay: 1, hoursPerShift: 10,
    }] as any,
    schedules: [{
      kind: "pipe", batchId: "b1", weekDays: [5, 5, 5, 5], createdAt: new Date("2026-09-02T00:00:00Z"),
      demandPieces: 12.5, scheduledPieces: 10.25, requestJson: { demand: [{ item_code: "P-1", qty_pcs: 12.5 }] },
      resultJson: {
        allocations: [{ item_code: "P-1", machine: "M1", week: 1, planned_hours: 2, scheduled_net_pcs: 10.25, scheduled_gross_pcs: 11, scheduled_kg: 1.1 }],
        blocks: [{ item_code: "P-1", machine: "M1", week: 1, scheduled_net_pcs: 10.25, scheduled_gross_pcs: 11, scheduled_kg: 1.1, planned_hours: 2 }],
        weekly_fill: [{ machine: "M1", week: 1, capacity_hrs: 10, scheduled_hrs: 2, idle_hrs: 8 }],
        coverage: { items: [{ item_code: "P-1", requested_pcs: 12.5, status: "schedulable" }] },
        unfinished: [{ item_code: "P-1", remaining_net_pcs: 2.25, remaining_gross_pcs: 2.5, remaining_kg: 0.2 }],
        data_limited: [],
      },
    }] as any,
  };
}

test("machine planning normalizes persisted fractional net/gross quantities", () => {
  const payload = normalizeStoredMachinePlanning(fixture());
  assert.equal(payload.headline.scheduledPieces, 10.25);
  assert.equal(payload.allocations[0]?.netPieces, 10.25);
  assert.equal(payload.allocations[0]?.grossPieces, 11);
  assert.equal(payload.allocations[0]?.isFallback, false);
  assert.equal(payload.coverage[0]?.requestedPieces, 12.5);
  assert.equal(payload.machines[0]?.month.idle, 8);
});

test("machine-wise export has governed seven sheets and first-sheet coverage", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportMachineWiseExcel(normalizeStoredMachinePlanning(fixture())) as any);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), [
    "Plan at a glance", "Machine load by week", "Allocations by machine",
    "Not scheduled", "Coverage", "How to read this plan", "RUN TRACE",
  ]);
  assert.equal(workbook.getWorksheet("Plan at a glance")?.getCell("A13").value, "Coverage");
});

test("PTMT machine planning is explicitly unavailable", () => {
  const result = machinePlanningUnavailable("PTMT", "2026-09");
  assert.equal(result.available, false);
  assert.equal(result.reason, "Machine planning is not available for PTMT. It requires item-to-machine routing, machine rates and a machine roster, which do not exist for this segment.");
});

test("planning-format export keeps quantity basis and manager sheets", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await exportPlanningFormatExcel(normalizeStoredMachinePlanning(fixture())) as any);
  assert.ok(workbook.getWorksheet("Plan at a glance"));
  assert.ok(workbook.getWorksheet("Coverage"));
  assert.ok(workbook.getWorksheet("Quantity basis"));
  assert.ok(workbook.getWorksheet("By master group"));
  assert.ok(workbook.getWorksheet("What needs attention"));
});