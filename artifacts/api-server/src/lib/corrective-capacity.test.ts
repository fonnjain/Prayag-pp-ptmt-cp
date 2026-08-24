import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCapByCategory, fetchCorrectivePtmtActuals } from "./corrective-engine";

test("corrective Cap/Day excludes Sundays to match the calendar remainder", () => {
  const capacities = computeCapByCategory(new Map([
    ["Test", new Map([
      ["2026-08-01", 100],
      ["2026-08-02", 10_000],
      ["2026-08-03", 200],
      ["2026-08-09", 20_000],
    ])],
  ]));

  assert.deepEqual(capacities.get("Test"), { cap: 150, method: "mean", days: 2 });
});

test("corrective PTMT actuals failure rejects instead of becoming zero production", async () => {
  const expected = new Error("production source unavailable");

  await assert.rejects(
    fetchCorrectivePtmtActuals("2026-08", async () => {
      throw expected;
    }),
    (err: unknown) => err === expected,
  );
});