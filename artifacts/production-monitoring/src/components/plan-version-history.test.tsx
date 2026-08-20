import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PlanVersionHistory } from "./plan-version-history";

test("shows the canonical same-day plan, issuance rule, and every superseded version", () => {
  const html = renderToStaticMarkup(
    <PlanVersionHistory
      month="2026-08"
      versions={[{
        kind: "corrective",
        sourceId: 42,
        sourceLabel: "Corrective plan #42",
        effectiveFrom: "2026-08-10",
        effectiveTo: null,
        targetCount: 68,
        selection: {
          candidateCount: 3,
          reason: "latest_source_issuance",
          canonicalIssuedAt: "2026-08-10T11:30:00.000Z",
          canonicalIssuedAtSource: "corrective_created_at",
          superseded: [
            {
              kind: "run",
              sourceId: 11,
              sourceLabel: "Original plan #11",
              issuedAt: "2026-08-10T08:30:00.000Z",
              issuedAtSource: "plan_created_at",
            },
            {
              kind: "import",
              sourceId: 31,
              sourceLabel: "Plant upload #31",
              issuedAt: "2026-08-10T10:15:00.000Z",
              issuedAtSource: "upload_timestamp",
            },
          ],
        },
      }]}
    />,
  );

  assert.match(html, /Issued plan history/);
  assert.match(html, /Used for monitoring/);
  assert.match(html, /Latest source issuance selected/);
  assert.match(html, /Superseded on 2026-08-10 \(2\)/);
  assert.match(html, /Original plan #11/);
  assert.match(html, /Plant upload #31/);
  assert.match(html, /correction issued/);
});

test("explains the frozen reconstruction used for a legacy weekly allocation", () => {
  const html = renderToStaticMarkup(
    <PlanVersionHistory
      month="2026-07"
      versions={[]}
      weeklyTargetSource="legacy_frozen_inputs"
      weeklyBandCount={4}
    />,
  );

  assert.match(html, /Original weekly allocation is frozen/);
  assert.match(html, /did not save W1–W4 targets/);
  assert.match(html, /captured inputs and its 4 retained release-band rules/);
  assert.match(html, /not from today’s live plan or current rules/);
});