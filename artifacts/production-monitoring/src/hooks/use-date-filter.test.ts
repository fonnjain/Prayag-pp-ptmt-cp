import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDateRange } from "./use-date-filter";

test("month picker transient empty values never produce an invalid date", () => {
  const range = computeDateRange("month", "");
  assert.match(range.month, /^\d{4}-\d{2}$/);
  assert.match(range.start, /^\d{4}-\d{2}-01$/);
  assert.match(range.end, /^\d{4}-\d{2}-\d{2}$/);
});

test("month picker uses the selected month boundaries", () => {
  assert.deepEqual(computeDateRange("month", "2026-09"), {
    start: "2026-09-01",
    end: "2026-09-30",
    month: "2026-09",
  });
});