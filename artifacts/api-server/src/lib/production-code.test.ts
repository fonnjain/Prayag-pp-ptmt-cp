import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeProductionCode } from "./production-code";
import { normalizeCodeStrict } from "./sheets";

test("production code normalization is shared with the Sheet3 compatibility export", () => {
  const variants = ["A465", "A-465", " a 465 ", "a.465"];
  const normalized = variants.map((code) => normalizeProductionCode(code));

  assert.deepEqual(normalized, ["A465", "A465", "A465", "A465"]);
  assert.equal(normalizeCodeStrict("A-465"), normalizeProductionCode("A-465"));
});