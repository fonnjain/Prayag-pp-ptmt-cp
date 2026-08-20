import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCapByCategory } from "./corrective-engine";

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