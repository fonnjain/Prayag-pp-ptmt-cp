import test from "node:test";
import assert from "node:assert/strict";
import { derivedWorkingDays, lastWorkingDay, resolvePlantMonthLifecycle } from "./month-lifecycle";

test("month lifecycle is UTC-based and preserves the 1st–6th grace window", () => {
  assert.equal(resolvePlantMonthLifecycle("2026-09", new Date("2026-08-31T23:59:00Z")).state, "future");
  assert.equal(resolvePlantMonthLifecycle("2026-08", new Date("2026-08-31T23:59:00Z")).state, "open");
  assert.equal(resolvePlantMonthLifecycle("2026-08", new Date("2026-09-06T23:59:00Z")).state, "grace");
  assert.equal(resolvePlantMonthLifecycle("2026-08", new Date("2026-09-07T00:00:00Z")).state, "closed");
  assert.equal(resolvePlantMonthLifecycle("2026-07", new Date("2026-09-01T00:00:00Z")).state, "closed");
});

test("derived calendar excludes Sundays and finds the final working day", () => {
  assert.equal(derivedWorkingDays("2026-08"), 26);
  assert.equal(lastWorkingDay("2026-08"), "2026-08-31");
  assert.equal(lastWorkingDay("2026-05"), "2026-05-30");
});