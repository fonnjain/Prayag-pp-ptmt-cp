import assert from "node:assert/strict";
import test from "node:test";
import * as XLSX from "xlsx";
import {
  buildPendingFixtureWorkbook,
  buildUnrecognisedPendingFixtureWorkbook,
  PENDING_FIXTURE_HEADERS,
  serialisePendingFixture,
} from "../lib/pending-upload-fixtures.js";
import {
  extractPendingRows,
  PendingSheetSelectionError,
  selectPendingSheet,
} from "./uploads.js";

function segmentTotal(rows: Record<string, unknown>[], segment: string): number {
  return rows
    .filter((row) => row.Segment === segment)
    .reduce((total, row) => total + Number(row.Balance_Qty ?? 0), 0);
}

test("June and July pending fixtures use the balance-bearing sheet and preserve totals", () => {
  const fixtures = [
    { sheetName: "PendingOrder 1-apr to 30-Jun-26", expectedLabel: "June" },
    { sheetName: "PO 1-Jul-26 to 31-July-26", expectedLabel: "July" },
  ];

  for (const fixture of fixtures) {
    const workbook = buildPendingFixtureWorkbook(fixture.sheetName);
    const bytes = serialisePendingFixture(workbook);
    const reparsed = XLSX.read(bytes, { type: "buffer" });
    const selected = selectPendingSheet(reparsed);
    const extracted = extractPendingRows(reparsed);

    assert.ok(bytes.byteLength > 0, `${fixture.expectedLabel} fixture should serialize`);
    assert.equal(selected.name, fixture.sheetName);
    assert.equal(extracted.sheetName, fixture.sheetName);
    assert.equal(selected.headers.length, PENDING_FIXTURE_HEADERS.length);
    assert.deepEqual(
      extracted.rows.map((row) => ({
        code: row["Old Item Code"],
        colour: row.Colour,
        segment: row.Segment,
        balance: row.Balance_Qty,
      })),
      [
        { code: "PT-ANON-001", colour: "WHITE", segment: "PTMT", balance: 2_500 },
        { code: "PT-ANON-002", colour: "BLUE", segment: "PTMT", balance: 2_090 },
        { code: "PL-ANON-001", colour: "GREY", segment: "Plumbing", balance: 4_000 },
        { code: "PL-ANON-002", colour: "WHITE", segment: "Plumbing", balance: 1_710 },
      ],
    );
    assert.equal(segmentTotal(extracted.rows, "PTMT"), 4_590);
    assert.equal(segmentTotal(extracted.rows, "Plumbing"), 5_710);
  }
});

test("a balance-bearing worksheet wins over an earlier named decoy", () => {
  const workbook = buildPendingFixtureWorkbook("Balance Export", { includeNamedDecoy: true });
  const selected = selectPendingSheet(workbook);
  assert.equal(selected.name, "Balance Export");
  assert.equal(extractPendingRows(workbook).rows.length, 4);
});

test("an unrecognised pending-tab rename fails instead of parsing the invoice register", () => {
  assert.throws(
    () => selectPendingSheet(buildUnrecognisedPendingFixtureWorkbook()),
    (error: unknown) => {
      assert.ok(error instanceof PendingSheetSelectionError);
      assert.equal(error.code, "PENDING_SHEET_NOT_FOUND");
      assert.deepEqual(error.sheets.map((sheet) => sheet.name), [
        "Invoice Register",
        "Open Orders July",
      ]);
      assert.deepEqual(error.sheets[0]?.headers, [
        "Item Code",
        "Item Name",
        "Colour",
        "Segment",
        "Quantity",
        "Invoice Date",
      ]);
      assert.deepEqual(error.sheets[1]?.headers, [
        "Item Code",
        "Colour",
        "Segment",
        "Quantity",
      ]);
      return true;
    },
  );
});