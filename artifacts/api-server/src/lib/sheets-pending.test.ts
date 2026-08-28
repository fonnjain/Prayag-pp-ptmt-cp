import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parsePendingOrderRows,
  pendingCoverageFromParsedRows,
  pendingOrderParsedValues,
  pendingOrderRecordsFromRows,
  pendingPlanDiagnosticsFromParsedRows,
  buildPendingRosterIndex,
  pendingJoinModeForItem,
  pendingRosterItemKey,
  pendingTotalsByRosterItem,
  pendingOrderTotalsFromRows,
  normalizeCode,
  normalizeColour,
} from "./sheets";

const rows = [
  { SEGMENT: "PT", "ITEM CODE": "PT-1", COLOR: "WHITE", "BAL QTY": "10", Quantity: "999" },
  { Segment: "PTMT", "Item Code": "PT-2", Colour: "BLUE", "Bal. Qty": 5, Quantity: 500 },
  { Segment: "P", "Item Code": "PL-1", COLOR: "GREY", "Bal. Qty": "100", Quantity: 1000 },
  { Segment: "PL", "Old ERP Code": "PL-2", COLOR: "BLACK", "Bal. Qty": 25 },
  { Segment: "AGRI", "Item Code": "AG-1", COLOR: "BROWN", "Bal. Qty": 7 },
  { Segment: "OTHER", "Item Code": "NOPE", COLOR: "WHITE", "Bal. Qty": 1000 },
];

test("live pending PTMT filter uses Bal. Qty and supports normalised headers", () => {
  const totals = pendingOrderTotalsFromRows(rows, "PTMT");

  assert.equal(totals.byCode.get("PT-1"), 10);
  assert.equal(totals.byCode.get("PT-2"), 5);
  assert.equal([...totals.byCode.values()].reduce((sum, value) => sum + value, 0), 15);
  assert.equal(totals.byCode.has("PL-1"), false);
});

test("uploaded pending aggregation filters mixed segments and never uses invoice Quantity", () => {
  const totals = pendingOrderTotalsFromRows([
    { Segment: "PT", "Item Code": "PT-1", Colour: "WHITE", Balance_Qty: 12, Quantity: 900 },
    { Segment: "PLUMBING", "Item Code": "PL-1", Colour: "WHITE", Balance_Qty: 700, Quantity: 900 },
    { Segment: "PTMT", "Item Code": "PT-2", Colour: "BLUE", "Bal. Qty": 8, Quantity: 500 },
    { Segment: "PTMT", "Item Code": "PT-3", Colour: "BLACK", Quantity: 1_000 },
  ], "PTMT");

  assert.deepEqual([...totals.byCode.entries()].sort(), [["PT-1", 12], ["PT-2", 8], ["PT-3", 0]]);
  assert.equal(totals.byCode.has("PL-1"), false);
  assert.equal(totals.pendingRows?.length, 3);
  assert.equal([...totals.byCode.values()].reduce((sum, value) => sum + value, 0), 20);
});

test("live pending Plumbing filter includes PLUMBING aliases P/PL/AGRI", () => {
  const totals = pendingOrderTotalsFromRows(rows, "Plumbing");

  assert.equal(totals.byCode.get("PL-1"), 100);
  assert.equal(totals.byCode.get("PL-2"), 25);
  assert.equal(totals.byCode.get("AG-1"), 7);
  assert.equal([...totals.byCode.values()].reduce((sum, value) => sum + value, 0), 132);
  assert.equal(totals.byCode.has("PT-1"), false);
});

test("live pending Plumbing filter includes current material-group segments", () => {
  const totals = pendingOrderTotalsFromRows([
    { SEGMENT: "CPVC", "Item Code": "CPVC-1", COLOR: "WHITE", "Bal. Qty": 96370 },
    { SEGMENT: "UPVC", "Item Code": "UPVC-1", COLOR: "WHITE", "Bal. Qty": 32274 },
    { SEGMENT: "SWR", "Item Code": "SWR-1", COLOR: "WHITE", "Bal. Qty": 18282 },
    { SEGMENT: "AGRI", "Item Code": "AGRI-1", COLOR: "WHITE", "Bal. Qty": 5699 },
    { SEGMENT: "PPR", "Item Code": "PPR-1", COLOR: "WHITE", "Bal. Qty": 5150 },
  ], "Plumbing");

  assert.equal([...totals.byCode.values()].reduce((sum, value) => sum + value, 0), 152625);
  assert.equal(totals.byCode.has("PPR-1"), false);
});

test("live pending report honours its embedded Old ERP Code header", () => {
  const topHeader = Array.from({ length: 24 }, () => "");
  topHeader[5] = "Item Group";
  topHeader[6] = "Item Code";
  topHeader[7] = "Item Name";
  topHeader[8] = "COLOR";
  topHeader[16] = "Bal. Qty";
  topHeader[23] = "SEGMENT";

  const embeddedHeader = Array.from({ length: 24 }, () => "");
  embeddedHeader[5] = "Old ERP Code";
  embeddedHeader[6] = "Item Name";
  embeddedHeader[7] = "Color";
  embeddedHeader[8] = "Name";
  embeddedHeader[16] = "Quantity";

  const row = Array.from({ length: 24 }, () => "");
  row[5] = "PS-2";
  row[6] = "CPVC PIPE 25MM";
  row[7] = "WHITE";
  row[16] = "125";
  row[23] = "CPVC";

  assert.deepEqual(
    pendingOrderParsedValues([topHeader, embeddedHeader, row], "Plumbing"),
    [{ catNo: "PS-2", colour: "WHITE", qty: 125 }],
  );
});

test("live pending records preserve segment and description for reconciliation", () => {
  assert.deepEqual(
    pendingOrderRecordsFromRows(
      [{
        SEGMENT: "CPVC",
        "Old ERP Code": "PS-2",
        "Item Code": "CPVC PIPE 25MM",
        Color: "WHITE",
        "Bal. Qty": 125,
      }],
      "Plumbing",
    ),
    [{
      segment: "CPVC",
      catNo: "PS-2",
      colour: "WHITE",
      description: "CPVC PIPE 25MM",
      qty: 125,
    }],
  );
});

test("pending coverage aggregates unmatched rows with an explicit disposition", () => {
  const coverage = pendingCoverageFromParsedRows([
    { segment: "P", catNo: "MATCH-1", colour: "WHITE", description: "Matched", qty: 100 },
    { segment: "P", catNo: "MISS-1", colour: "BLUE", description: "Unmatched", qty: 3 },
    { segment: "P", catNo: "MISS-1", colour: "BLUE", description: "Unmatched", qty: 4 },
  ], ["MATCH-1"]);

  assert.equal(coverage.totalQuantity, 107);
  assert.equal(coverage.matchedQuantity, 100);
  assert.equal(coverage.unmatchedQuantity, 7);
  assert.equal(coverage.matchedRowCount, 1);
  assert.equal(coverage.unmatchedRowCount, 1);
  assert.deepEqual(coverage.unmatchedRows[0], {
    segment: "P",
    code: "MISS-1",
    colour: "BLUE",
    description: "Unmatched",
    quantity: 7,
    disposition: "excluded",
    reason: "NO_ROSTER_MATCH",
  });
});

test("pending plan diagnostics separate unmatched codes from colour-resolution loss", () => {
  const diagnostics = pendingPlanDiagnosticsFromParsedRows([
    { segment: "PTMT", catNo: "SINGLE", colour: "RED", description: "single", qty: 10 },
    { segment: "PTMT", catNo: "MULTI", colour: "GREEN", description: "wrong colour", qty: 20 },
    { segment: "PTMT", catNo: "MISSING", colour: "WHITE", description: "missing", qty: 5 },
  ], [
    { itemCode: "SINGLE", colour: "0" },
    { itemCode: "MULTI", colour: "WHITE" },
    { itemCode: "MULTI", colour: "BLUE" },
  ]);

  assert.equal(diagnostics.sourceQuantity, 35);
  assert.equal(diagnostics.rosterMatchedQuantity, 30);
  assert.equal(diagnostics.planResolvedQuantity, 10);
  assert.equal(diagnostics.unmatchedQuantity, 5);
  assert.equal(diagnostics.resolutionLossQuantity, 20);
  assert.equal(diagnostics.unmatchedRows[0]?.reason, "NO_ROSTER_MATCH");
  assert.equal(diagnostics.resolutionLossRows[0]?.reason, "COLOUR_MISMATCH");
  assert.deepEqual(diagnostics.resolutionLossRows[0], {
    segment: "PTMT",
    sourceRole: "pending_current",
    code: "MULTI",
    colour: "GREEN",
    description: "wrong colour",
    quantity: 20,
    disposition: "resolution-loss",
    reason: "COLOUR_MISMATCH",
  });
  assert.equal(diagnostics.reconciliation.joinedQuantity, 10);
  assert.equal(diagnostics.reconciliation.explainedExclusionQuantity, 25);
  assert.equal(diagnostics.reconciliation.unexplainedResidual, 0);
});

test("PTMT last-month pending diagnostics retain source identity for both exclusion types", () => {
  const diagnostics = pendingPlanDiagnosticsFromParsedRows([
    { segment: "PTMT", catNo: "MATCH", colour: "WHITE", description: "matched", qty: 11 },
    { segment: "PTMT", catNo: "MULTI", colour: "GREEN", description: "wrong colour", qty: 7 },
    { segment: "PTMT", catNo: "MISSING", colour: "WHITE", description: "missing", qty: 3 },
  ], [
    { itemCode: "MATCH", colour: "WHITE" },
    { itemCode: "MULTI", colour: "WHITE" },
    { itemCode: "MULTI", colour: "BLUE" },
  ], { sourceRole: "pending_last_month" });

  assert.equal(diagnostics.sourceRole, "pending_last_month");
  assert.equal(diagnostics.reconciliation.reconciled, true);
  assert.deepEqual(diagnostics.resolutionLossRows[0], {
    segment: "PTMT",
    sourceRole: "pending_last_month",
    code: "MULTI",
    colour: "GREEN",
    description: "wrong colour",
    quantity: 7,
    disposition: "resolution-loss",
    reason: "COLOUR_MISMATCH",
  });
  assert.deepEqual(diagnostics.unmatchedRows[0], {
    segment: "PTMT",
    sourceRole: "pending_last_month",
    code: "MISSING",
    colour: "WHITE",
    description: "missing",
    quantity: 3,
    disposition: "unmatched",
    reason: "NO_ROSTER_MATCH",
  });
});

test("Plumbing current pending diagnostics retain segment and source role on exclusions", () => {
  const diagnostics = pendingPlanDiagnosticsFromParsedRows([
    { segment: "PL", catNo: "PIPE-1", colour: "", description: "matched", qty: 50 },
    { segment: "PL", catNo: "PIPE-MISSING", colour: "", description: "missing", qty: 9 },
  ], [{ itemCode: "PIPE-1", colour: "" }], { sourceRole: "pending_current" });

  assert.equal(diagnostics.sourceQuantity, 59);
  assert.equal(diagnostics.reconciliation.joinedQuantity, 50);
  assert.equal(diagnostics.reconciliation.explainedExclusionQuantity, 9);
  assert.deepEqual(diagnostics.unmatchedRows[0], {
    segment: "PL",
    sourceRole: "pending_current",
    code: "PIPE-MISSING",
    colour: "",
    description: "missing",
    quantity: 9,
    disposition: "unmatched",
    reason: "NO_ROSTER_MATCH",
  });
});

test("single-variant pending aggregates across source colours", () => {
  const diagnostics = pendingPlanDiagnosticsFromParsedRows([
    { segment: "PTMT", catNo: "ONE", colour: "RED", description: "", qty: 7 },
    { segment: "PTMT", catNo: "ONE", colour: "BLUE", description: "", qty: 9 },
  ], [{ itemCode: "ONE", colour: "0" }]);

  assert.equal(diagnostics.sourceQuantity, 16);
  assert.equal(diagnostics.planResolvedQuantity, 16);
  assert.equal(diagnostics.resolutionLossQuantity, 0);
});

test("pending join scopes variant counts by category", () => {
  const roster = [
    { itemCode: "SHARED", colour: "RED", category: "Cocks Standard" },
    { itemCode: "SHARED", colour: "BLUE", category: "Cocks Premium" },
  ];
  const index = buildPendingRosterIndex(roster);

  assert.equal(pendingJoinModeForItem(index, roster[0]), "code");
  assert.equal(pendingJoinModeForItem(index, roster[1]), "code");

  const diagnostics = pendingPlanDiagnosticsFromParsedRows([
    { segment: "PTMT", catNo: "SHARED", colour: "GREEN", description: "", qty: 10 },
  ], roster);
  assert.equal(diagnostics.rosterMatchedQuantity, 10);
  assert.equal(diagnostics.planResolvedQuantity, 0);
  assert.equal(diagnostics.resolutionLossQuantity, 10);
  assert.equal(diagnostics.resolutionLossRows[0]?.reason, "AMBIGUOUS_ROSTER_MATCH");
  assert.equal(diagnostics.reconciliation.reconciled, true);
});

test("pending roster allocation never duplicates an ambiguous code across categories", () => {
  const roster = [
    { itemCode: "SHARED", colour: "GREEN", category: "Cocks Standard" },
    { itemCode: "SHARED", colour: "GREEN", category: "Cocks Premium" },
  ];
  const index = buildPendingRosterIndex(roster);
  const pending = [
    { segment: "PTMT", catNo: "SHARED", colour: "GREEN", description: "", qty: 10 },
  ];

  const totals = pendingTotalsByRosterItem(pending, roster);
  assert.equal(totals.size, 0);

  const uniquelyScoped = pendingTotalsByRosterItem([
    { segment: "PTMT", catNo: "SHARED", colour: "GREEN", description: "", qty: 10 },
  ], [roster[0]!]);
  assert.equal(uniquelyScoped.get(pendingRosterItemKey(roster[0]!)), 10);
  assert.equal(index.byCode.get("SHARED")?.length, 2);
});

test("pending join normalizes placeholder colours and the legacy LSBB alias", () => {
  const diagnostics = pendingPlanDiagnosticsFromParsedRows([
    { segment: "PTMT", catNo: "123-LSBB", colour: "BLACK", description: "", qty: 12 },
    { segment: "PTMT", catNo: "SINGLE", colour: "Green", description: "", qty: 8 },
  ], [
    { itemCode: "123-LSB", colour: "BLUE" },
    { itemCode: "SINGLE", colour: "0" },
  ]);

  assert.equal(diagnostics.sourceQuantity, 20);
  assert.equal(diagnostics.planResolvedQuantity, 20);
  assert.equal(diagnostics.unmatchedQuantity, 0);
  assert.equal(diagnostics.resolutionLossQuantity, 0);
  assert.equal(diagnostics.reconciliation.reconciled, true);
});

test("pending joins normalize Excel code signatures and punctuated colours", () => {
  assert.equal(normalizeCode("120.0"), "120");
  assert.equal(normalizeColour("."), "");
  assert.equal(normalizeColour("0"), "");
  assert.equal(normalizeColour("NORMAL"), "");
  assert.equal(normalizeColour("R.BLUE"), "R BLUE");
  assert.equal(normalizeColour("R BLUE"), "R BLUE");

  const diagnostics = pendingPlanDiagnosticsFromParsedRows([
    { segment: "PTMT", catNo: "1813-CR", colour: "R BLUE", description: "", qty: 30 },
  ], [
    { itemCode: "1813-CR", colour: "R.BLUE" },
    { itemCode: "1813-CR", colour: "WHITE" },
  ]);
  assert.equal(diagnostics.planResolvedQuantity, 30);
  assert.equal(diagnostics.resolutionLossQuantity, 0);
});

test("Plumbing pending join preserves the confirmed July and August roster split", () => {
  const sourceRows = [
    { segment: "PL", catNo: "COMMON", colour: "", description: "", qty: 436894 },
    { segment: "PL", catNo: "JULY-ONLY", colour: "", description: "", qty: 5866 },
    { segment: "PL", catNo: "AUGUST-ONLY", colour: "", description: "", qty: 94067 },
    { segment: "PL", catNo: "ABSENT-BOTH", colour: "", description: "", qty: 7717 },
  ];
  const july = pendingPlanDiagnosticsFromParsedRows(sourceRows, [
    { itemCode: "COMMON", colour: "" },
    { itemCode: "JULY-ONLY", colour: "" },
  ], { sourceRole: "pending_last_month" });
  const august = pendingPlanDiagnosticsFromParsedRows(sourceRows, [
    { itemCode: "COMMON", colour: "" },
    { itemCode: "AUGUST-ONLY", colour: "" },
  ], { sourceRole: "pending_last_month" });

  assert.equal(july.sourceQuantity, 544544);
  assert.equal(july.planResolvedQuantity, 442760);
  assert.equal(july.unmatchedQuantity, 101784);
  assert.equal(july.reconciliation.joinedQuantity + july.reconciliation.explainedExclusionQuantity, 544544);
  assert.equal(july.unmatchedRows.find((row) => row.code === "AUGUST-ONLY")?.quantity, 94067);
  assert.equal(july.unmatchedRows.find((row) => row.code === "ABSENT-BOTH")?.quantity, 7717);
  assert.equal(july.unmatchedRows.every((row) =>
    row.segment === "PL" && row.sourceRole === "pending_last_month" && row.disposition === "unmatched",
  ), true);

  assert.equal(august.planResolvedQuantity, 530961);
  assert.equal(august.unmatchedQuantity, 13583);
  assert.equal(august.unmatchedRows.find((row) => row.code === "JULY-ONLY")?.quantity, 5866);
  assert.equal(august.unmatchedRows.find((row) => row.code === "ABSENT-BOTH")?.quantity, 7717);
  assert.equal(august.reconciliation.reconciled, true);
});

test("live pending parser preserves colour joins and applies legacy code alias", () => {
  const parsed = parsePendingOrderRows(
    [{ SEGMENT: "PTMT", "Item Code": "123-LSBB", COLOR: "BLACK", "Bal. Qty": 184 }],
    "PTMT",
  );

  assert.deepEqual(parsed, [{ catNo: "123-LSB", colour: "BLUE", qty: 184 }]);
}
);