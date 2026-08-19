import test from "node:test";
import assert from "node:assert/strict";
import { derivedWorkingDays, lastWorkingDay, resolvePlantMonthLifecycle } from "./month-lifecycle";
import { assertEffectiveDate } from "./plant-plan-timeline";

test("month lifecycle is UTC-based and preserves the 1st–7th grace window", () => {
  assert.equal(resolvePlantMonthLifecycle("2026-09", new Date("2026-08-31T23:59:00Z")).state, "future");
  assert.equal(resolvePlantMonthLifecycle("2026-08", new Date("2026-08-31T23:59:00Z")).state, "open");
  assert.equal(resolvePlantMonthLifecycle("2026-08", new Date("2026-09-07T23:59:00Z")).state, "grace");
  assert.equal(resolvePlantMonthLifecycle("2026-08", new Date("2026-09-08T00:00:00Z")).state, "closed");
  assert.equal(resolvePlantMonthLifecycle("2026-07", new Date("2026-09-01T00:00:00Z")).state, "closed");
});

test("derived calendar excludes Sundays and finds the final working day", () => {
  assert.equal(derivedWorkingDays("2026-08"), 26);
  assert.equal(lastWorkingDay("2026-08"), "2026-08-31");
  assert.equal(lastWorkingDay("2026-05"), "2026-05-30");
});

test("plan-version effective dates must be real calendar dates in the selected month", () => {
  assert.equal(assertEffectiveDate("2026-08", "2026-08-31"), "2026-08-31");
  assert.throws(() => assertEffectiveDate("2026-08", "2026-08-00"), /valid calendar date/);
  assert.throws(() => assertEffectiveDate("2026-02", "2026-02-29"), /valid calendar date/);
  assert.throws(() => assertEffectiveDate("2026-08", "2026-09-01"), /within 2026-08/);
});