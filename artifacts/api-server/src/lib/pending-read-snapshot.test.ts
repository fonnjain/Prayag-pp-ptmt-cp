import { test } from "node:test";
import assert from "node:assert/strict";
import { pendingOrderTotalsFromRows } from "./sheets";
import {
  livePendingFailureDiagnostics,
  pendingReadBaselineEvidence,
  pendingReadSnapshotValues,
  selectFirstEligiblePendingRead,
} from "./pending-read-snapshot";

test("live pending snapshot retains raw descriptions and parsed rows", () => {
  const rawRows = [{
    Segment: "AGRI",
    "Old ERP Code": "AS-427",
    "Item Code": "AGRI EQUAL TEE 75",
    Color: "",
    "Bal. Qty": 300,
    Category: "AGRI FITTING",
  }];
  const totals = pendingOrderTotalsFromRows(rawRows, "Plumbing");
  const snapshot = pendingReadSnapshotValues({
    captureContext: "validation",
    segment: "Plumbing",
    totals,
    diagnostics: totals.diagnostics,
  });

  assert.equal(snapshot.status, "captured");
  assert.equal(snapshot.sourceKind, "pending_order_live_sheet");
  assert.equal(snapshot.sourceTabName, "report");
  assert.deepEqual(snapshot.rawRowsJson, rawRows);
  assert.deepEqual(snapshot.parsedRowsJson, [{
    segment: "AGRI",
    catNo: "AS-427",
    colour: "",
    description: "AGRI EQUAL TEE 75",
    qty: 300,
  }]);
  assert.equal((snapshot.diagnosticsJson as { rowCount: number }).rowCount, 1);
});

test("failed live pending capture remains distinguishable from a valid empty read", () => {
  const error = new Error("source read failed");
  const diagnostics = livePendingFailureDiagnostics("Plumbing", error);
  const snapshot = pendingReadSnapshotValues({
    captureContext: "validation",
    segment: "Plumbing",
    diagnostics,
    status: "failed",
    errorText: error.message,
  });

  assert.equal(snapshot.status, "failed");
  assert.deepEqual(snapshot.rawRowsJson, []);
  assert.deepEqual(snapshot.parsedRowsJson, []);
  assert.equal(snapshot.errorText, "source read failed");
  assert.deepEqual(diagnostics.reasons, [
    "missing required fields: code, quantity",
    "source read failed: source read failed",
  ]);
});

function eligibleSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    ...pendingReadSnapshotValues({
      captureContext: "validation",
      segment: "Plumbing",
      totals: pendingOrderTotalsFromRows([
        { Segment: "AGRI", "Item Code": "A-1", Color: "", "Bal. Qty": 100 },
        { Segment: "AGRI", "Item Code": "NOT-IN-ROSTER", Color: "", "Bal. Qty": 25 },
      ], "Plumbing"),
      diagnostics: {
        missingRequiredFields: [],
        source: "Pending order / report · Plumbing",
        pendingPlan: {
          sourceRole: "pending_current_live",
          sourceRowCount: 2,
          sourceQuantity: 125,
          rosterMatchedQuantity: 100,
          planResolvedQuantity: 100,
          unmatchedQuantity: 25,
          resolutionLossQuantity: 0,
          rosterMatchedRowCount: 1,
          planResolvedRowCount: 1,
          unmatchedRowCount: 1,
          resolutionLossRowCount: 0,
          unmatchedRows: [{
            segment: "AGRI",
            sourceRole: "pending_current_live",
            code: "NOT-IN-ROSTER",
            colour: "",
            description: "",
            quantity: 25,
            disposition: "excluded",
            reason: "NO_ROSTER_MATCH",
          }],
          resolutionLossRows: [],
          reconciliation: {
            sourceQuantity: 125,
            joinedQuantity: 100,
            explainedExclusionQuantity: 25,
            unexplainedResidual: 0,
            reconciled: true,
          },
        },
      },
      ...overrides,
    }),
    id: 2,
    capturedAt: new Date("2026-08-28T00:00:00.000Z"),
  };
}

test("only a complete captured live read with the intended source identity is eligible", () => {
  const snapshot = eligibleSnapshot();
  const evidence = pendingReadBaselineEvidence(snapshot);
  assert.equal(evidence?.sourceQuantity, 125);
  assert.equal(evidence?.joinedQuantity, 100);
  assert.equal(evidence?.explainedExclusionQuantity, 25);
  assert.equal(evidence?.unmatchedQuantity, 25);
  assert.equal(evidence?.unexplainedResidual, 0);
  assert.match(evidence?.fingerprint ?? "", /^[a-f0-9]{64}$/);

  assert.equal(
    pendingReadBaselineEvidence({ ...snapshot, status: "failed" }),
    null,
  );
  assert.equal(
    pendingReadBaselineEvidence({ ...snapshot, sourceTabName: "wrong-tab" }),
    null,
  );
  assert.equal(
    pendingReadBaselineEvidence({ ...snapshot, sourceSpreadsheetId: "other-sheet" }),
    null,
  );
});

test("incomplete reconciliation is not promoted even when the read itself succeeded", () => {
  const snapshot = {
    ...eligibleSnapshot(),
    diagnosticsJson: {
      pendingPlan: {
        sourceQuantity: 125,
        planResolvedQuantity: 100,
        unmatchedQuantity: 25,
        resolutionLossQuantity: 0,
        unmatchedRows: [],
        resolutionLossRows: [],
        reconciliation: {
          sourceQuantity: 125,
          joinedQuantity: 100,
          explainedExclusionQuantity: 0,
          unexplainedResidual: 25,
          reconciled: false,
        },
      },
    },
  };
  assert.equal(pendingReadBaselineEvidence(snapshot), null);
});

test("missing required fields are not eligible, while a valid empty read is", () => {
  const malformed = eligibleSnapshot();
  malformed.diagnosticsJson = {
    ...(malformed.diagnosticsJson as Record<string, unknown>),
    missingRequiredFields: ["quantity"],
  };
  assert.equal(pendingReadBaselineEvidence(malformed), null);

  const validEmpty = eligibleSnapshot({
    diagnosticsJson: {
      missingRequiredFields: [],
      pendingPlan: {
        sourceRole: "pending_current_live",
        sourceRowCount: 0,
        sourceQuantity: 0,
        rosterMatchedQuantity: 0,
        planResolvedQuantity: 0,
        unmatchedQuantity: 0,
        resolutionLossQuantity: 0,
        unmatchedRows: [],
        resolutionLossRows: [],
        reconciliation: {
          sourceQuantity: 0,
          joinedQuantity: 0,
          explainedExclusionQuantity: 0,
          unexplainedResidual: 0,
          reconciled: true,
        },
      },
    },
  });
  assert.notEqual(pendingReadBaselineEvidence(validEmpty), null);
});

test("baseline selection skips failed and incomplete captures and keeps the first eligible one", () => {
  const first = eligibleSnapshot();
  const selected = selectFirstEligiblePendingRead([
    { ...first, id: 1, status: "failed" },
    { ...first, id: 2, diagnosticsJson: { pendingPlan: { reconciliation: { reconciled: false } } } },
    { ...first, id: 3 },
    { ...first, id: 4 },
  ]);
  assert.equal(selected?.id, 3);
});

test("snapshot provenance keeps environment explicit", () => {
  const snapshot = pendingReadSnapshotValues({
    captureContext: "validation",
    segment: "Plumbing",
    environment: "production",
  });
  assert.equal(snapshot.environment, "production");
});