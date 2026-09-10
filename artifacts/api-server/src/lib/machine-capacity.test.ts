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
    totalKg: 0,
    noBomKg: true,
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

test("cascade rejects a per-piece BOM value copied into totalKg for a large row", () => {
  const item = {
    itemCode: "UNIT-GUARD",
    colour: "",
    category: "CPVC Fitting",
    avg3MoSale: 0,
    stock: 0,
    stockNeedsReview: false,
    bufferReq: 0,
    minProduction: 0,
    maxProduction: 25_000,
    pendingOrderLastMonth: 0,
    pendingOrder: 0,
    order: 0,
    achievementPct: null,
    cover: "OS" as const,
    week: 1 as const,
    w1: 25_000,
    w2: 0,
    w3: 0,
    w4: 0,
    kgPerPiece: 0.62,
    totalKg: 0.62,
    noBomKg: false,
    machineW1: 0,
    machineW2: 0,
    machineW3: 0,
    machineW4: 0,
    assignedMachineId: null,
    machineWeek: null,
    machineUnfulfillable: false,
  };

  assert.throws(
    () => runMachineCascade([item], [], "2026-08"),
    /expected totalKg.*kgPerPiece/i,
  );
});

test("cascade accepts a legitimate light product when totalKg matches kgPerPiece", () => {
  const item = {
    itemCode: "LIGHT-PRODUCT",
    colour: "",
    category: "UPVC Pipe",
    avg3MoSale: 0,
    stock: 0,
    stockNeedsReview: false,
    bufferReq: 0,
    minProduction: 0,
    maxProduction: 1_168,
    pendingOrderLastMonth: 0,
    pendingOrder: 0,
    order: 0,
    achievementPct: null,
    cover: "OS" as const,
    week: 1 as const,
    w1: 1_168,
    w2: 0,
    w3: 0,
    w4: 0,
    kgPerPiece: 11.45 / 1_168,
    totalKg: 11.45,
    noBomKg: false,
    machineW1: 0,
    machineW2: 0,
    machineW3: 0,
    machineW4: 0,
    assignedMachineId: null,
    machineWeek: null,
    machineUnfulfillable: false,
  };

  assert.doesNotThrow(() => runMachineCascade([item], [], "2026-08"));
});

test("machine cascade prioritizes dummy demand before lower-cover buffer demand", () => {
  const base = {
    colour: "",
    category: "CPVC Pipe",
    avg3MoSale: 100,
    stockNeedsReview: false,
    bufferReq: 0,
    minProduction: 0,
    pendingOrder: 0,
    order: 0,
    achievementPct: null,
    week: 1 as const,
    w1: 2,
    w2: 0,
    w3: 0,
    w4: 0,
    totalKg: 4,
    noBomKg: false,
    machineW1: 0,
    machineW2: 0,
    machineW3: 0,
    machineW4: 0,
    assignedMachineId: null,
    machineWeek: null,
    machineUnfulfillable: false,
  };

  const dummy = {
    ...base,
    itemCode: "DUMMY-HIGH-COVER",
    stock: 100,
    maxProduction: 2,
    pendingOrderLastMonth: 2,
    cover: 1,
  };
  const buffer = {
    ...base,
    itemCode: "BUFFER-LOW-COVER",
    stock: 10,
    maxProduction: 20,
    totalKg: 40,
    pendingOrderLastMonth: 0,
    cover: 0.1,
  };

  runMachineCascade(
    [dummy, buffer],
    [{
      segment: "Plumbing",
      pool: "PIPE",
      machineId: "MC1",
      label: "M/C-1",
      shiftsPerDay: 2,
      hoursPerShift: 10,
      workingDays: 1,
      rates: { CPVC: 1 },
      lockedOut: false,
      id: 1,
    }],
    "2026-08",
  );

  assert.equal(dummy.machineW1, 2);
  assert.equal(buffer.machineW1, 0);
  assert.deepEqual(
    [dummy, buffer]
      .filter((item) => item.machineUnfulfillable)
      .map((item) => item.itemCode),
    ["BUFFER-LOW-COVER"],
  );
});
