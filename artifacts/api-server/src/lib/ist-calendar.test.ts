// Unit tests for the IST calendar helpers behind the month-end workbook
// pre-check (day-25 gate + next-month math). Run with:
//   pnpm --filter @workspace/api-server run test
import { test } from "node:test";
import assert from "node:assert/strict";
import { istDayOfMonth, istPlanningMonth, istNextPlanningMonth } from "./sheets";

// IST = UTC + 5:30. IST midnight on day N corresponds to 18:30 UTC on day N-1.

test("istDayOfMonth: UTC evening of the 24th is already day 25 in IST", () => {
  // 2026-08-24 18:30:00 UTC == 2026-08-25 00:00:00 IST
  assert.equal(istDayOfMonth(new Date("2026-08-24T18:30:00Z")), 25);
  // one second before IST midnight — still day 24
  assert.equal(istDayOfMonth(new Date("2026-08-24T18:29:59Z")), 24);
});

test("istDayOfMonth: UTC midday on day 24/25 matches IST day", () => {
  assert.equal(istDayOfMonth(new Date("2026-08-24T12:00:00Z")), 24);
  assert.equal(istDayOfMonth(new Date("2026-08-25T12:00:00Z")), 25);
});

test("istDayOfMonth: late UTC night on the 25th stays day 25/26 correctly", () => {
  // 2026-08-25 18:29:59 UTC == 2026-08-25 23:59:59 IST → day 25
  assert.equal(istDayOfMonth(new Date("2026-08-25T18:29:59Z")), 25);
  // 2026-08-25 18:30:00 UTC == 2026-08-26 00:00:00 IST → day 26
  assert.equal(istDayOfMonth(new Date("2026-08-25T18:30:00Z")), 26);
});

test("istPlanningMonth: UTC/IST month straddle at month rollover", () => {
  // 2026-08-31 18:30 UTC == 2026-09-01 00:00 IST → planning month is Sep
  assert.equal(istPlanningMonth(new Date("2026-08-31T18:30:00Z")), "2026-09");
  assert.equal(istPlanningMonth(new Date("2026-08-31T18:29:59Z")), "2026-08");
});

test("istNextPlanningMonth: mid-month gives the following month", () => {
  assert.equal(istNextPlanningMonth(new Date("2026-08-25T12:00:00Z")), "2026-09");
  assert.equal(istNextPlanningMonth(new Date("2026-04-25T12:00:00Z")), "2026-05");
});

test("istNextPlanningMonth: Dec→Jan year rollover", () => {
  // Mid-December → next month is January of the NEXT year
  assert.equal(istNextPlanningMonth(new Date("2026-12-25T12:00:00Z")), "2027-01");
  // IST-midnight straddle on Dec 24/25: 18:30 UTC on the 24th is IST day 25
  assert.equal(istNextPlanningMonth(new Date("2026-12-24T18:30:00Z")), "2027-01");
  assert.equal(istDayOfMonth(new Date("2026-12-24T18:30:00Z")), 25);
  // New Year's Eve straddle: 18:30 UTC Dec 31 is IST Jan 1 → next month Feb
  assert.equal(istNextPlanningMonth(new Date("2026-12-31T18:30:00Z")), "2027-02");
  assert.equal(istNextPlanningMonth(new Date("2026-12-31T18:29:59Z")), "2027-01");
});

test("istNextPlanningMonth: Jan 31 → Feb (no month-length skip)", () => {
  assert.equal(istNextPlanningMonth(new Date("2027-01-31T12:00:00Z")), "2027-02");
});
