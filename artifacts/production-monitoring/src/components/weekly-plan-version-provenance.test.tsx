import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WeeklyPlanVersionProvenance } from "./weekly-plan-version-provenance";

test("a boundary week renders both governing issued-plan versions and effective dates", () => {
  const html = renderToStaticMarkup(
    <WeeklyPlanVersionProvenance
      versions={[
        "Original plan #1 · effective 2026-08-01",
        "Corrective plan #2 · effective 2026-08-10",
      ]}
    />,
  );

  assert.match(html, /Issued plan/);
  assert.match(html, /Original plan #1 · effective 2026-08-01/);
  assert.match(html, /Corrective plan #2 · effective 2026-08-10/);
});