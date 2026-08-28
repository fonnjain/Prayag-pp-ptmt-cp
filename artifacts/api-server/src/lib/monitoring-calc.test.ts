import assert from "node:assert/strict";
import test from "node:test";
import { buildQualityWarnings, computeMachineQuality, DEFAULT_WARNING_THRESHOLDS } from "./monitoring-calc";
import type { MachineMonthRecord } from "./report5";

function machine(totalCountBasis: MachineMonthRecord["total_count_basis"]): MachineMonthRecord {
  return {
    machineId: "M-01",
    idealHours: 100,
    totalRunHours: 50,
    totalOutputKg: 100,
    rejectionKg: 10,
    total_count_basis: totalCountBasis,
    isGrinder: false,
    days: [],
  };
}

test("computeMachineQuality uses gross denominator for PTMT", () => {
  const quality = computeMachineQuality(machine("gross"));

  assert.equal(quality.totalCountBasis, "gross");
  assert.equal(quality.rejectionPct, 10);
  assert.equal(quality.goodOutputKg, 90);
});

test("computeMachineQuality uses good output denominator for PIPE", () => {
  const quality = computeMachineQuality(machine("net"));

  assert.equal(quality.totalCountBasis, "net");
  assert.equal(quality.rejectionPct, 11.11);
  assert.equal(quality.goodOutputKg, 90);
});

test("quality warnings identify the rejection denominator", () => {
  const quality = computeMachineQuality(machine("net"));
  const warnings = buildQualityWarnings([quality], DEFAULT_WARNING_THRESHOLDS);

  assert.match(warnings[0]?.message ?? "", /rejects ÷ good output/);
});