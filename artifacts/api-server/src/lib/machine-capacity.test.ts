import { test } from "node:test";
import assert from "node:assert/strict";
import { calendarWorkingDaysInWeek, isCalendarWorkingDay } from "./machine-capacity-engine";

test("machine capacity excludes Sunday 2026-08-02 from the first week", () => {
  assert.equal(isCalendarWorkingDay(2026, 8, 2), false);
  assert.equal(isCalendarWorkingDay(2026, 8, 3), true);
  assert.equal(calendarWorkingDaysInWeek(2026, 8, 1), 6);
});