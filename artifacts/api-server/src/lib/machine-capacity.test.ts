import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarWorkingDaysInWeek, isCalendarWorkingDay, runMachineCascade } from "./machine-capacity-engine";

test("machine capacity excludes Sunday 2026-08-02 from the first week", () => {
  assert.equal(isCalendarWorkingDay(2026, 8, 2), false);
  assert.equal(isCalendarWorkingDay(2026, 8, 3), true);
  assert.equal(calendarWorkingDaysInWeek(2026, 8, 1), 6);
});

test("pending-only no-BOM items remain visible as unfulfillable residuals", () => {
  const item = {
    itemCode: "PW63",
    colour: "",
    category: "SWR Pipe",
    avg3MoSale: 0,
    stock: 0,
    stockNeedsReview: false,
    bufferReq: 0,
    minProduction: 0,
    maxProduction: 41,
    pendingOrderLastMonth: 0,
    pendingOrder: 50,
    order: 0,
    achievementPct: null,
    cover: "OS" as const,
    week: null,
    w1: 0,
    w2: 0,
    w3: 0,
    w4: 0,
    weightKg: 0,
    noBomWeight: true,
    machineW1: 0,
    machineW2: 0,
    machineW3: 0,
    machineW4: 0,
    assignedMachineId: null,
    machineWeek: null,
    machineUnfulfillable: false,
  };

  const result = runMachineCascade([item], [], "2026-08");

  assert.equal(item.machineUnfulfillable, true);
  assert.deepEqual(result.unfulfillable, [{
    itemCode: "PW63",
    category: "SWR Pipe",
    pieces: 41,
    bindingMachine: null,
  }]);
});