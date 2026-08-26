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
  extractRows,
  PendingSheetSelectionError,
  SheetSelectionError,
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

function workbookWithSheets(sheets: Array<{ name: string; rows: unknown[][] }>): XLSX.WorkBook {
  const workbook = XLSX.utils.book_new();
  for (const { name, rows } of sheets) {
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return workbook;
}

test("all non-pending upload selectors prefer required columns over an earlier decoy", () => {
  const currentStock = workbookWithSheets([
    { name: "Invoice Register", rows: [["Item Code", "Quantity"], ["INV-1", 999]] },
    { name: "Renamed export", rows: [["Item Code", "Colour", "C/Stock"], ["STOCK-1", "WHITE", 17]] },
  ]);
  assert.deepEqual(extractRows(currentStock, "current_stock"), [
    { "Item Code": "STOCK-1", Colour: "WHITE", Qty: 17 },
  ]);

  const lastMonthPending = workbookWithSheets([
    { name: "CP", rows: [["Group", "Item code", "Qty"], ["CP", "CP-1", 999]] },
    { name: "Renamed pending export", rows: [["Item Code", "Colour", "Qty"], ["PENDING-1", "BLUE", 23]] },
  ]);
  assert.deepEqual(extractRows(lastMonthPending, "last_month_pending"), [
    { "Item Code": "PENDING-1", Colour: "BLUE", Qty: 23 },
  ]);

  const plumbingStock = workbookWithSheets([
    { name: "Notes", rows: [["Item Code", "Description"], ["NOTE-1", "not stock"]] },
    { name: "Renamed FG export", rows: [["Item Code", "Item Name", "Category", "Net Stock"], ["PL-1", "PIPE", "CPVC-PIPE", 41]] },
  ]);
  assert.deepEqual(extractRows(plumbingStock, "plumbing_fg_stock"), [
    { "Item Code": "PL-1", "Item Name": "PIPE", Category: "CPVC-PIPE", "Net Stock": 41 },
  ]);

  const renamedPtmt = workbookWithSheets([
    { name: "Notes", rows: [["Description"], ["not PTMT"]] },
    { name: "Renamed PTMT export", rows: [["Item Code", "Colour", "Qty"], ["PT-1", "WHITE", 7]] },
  ]);
  assert.deepEqual(extractRows(renamedPtmt, "unknown-kind"), [
    { "Item Code": "PT-1", Colour: "WHITE", Qty: 7 },
  ]);
});

test("non-pending selectors fail with diagnostics instead of using the first sheet", () => {
  const workbook = workbookWithSheets([
    { name: "Invoice Register", rows: [["Item Code", "Quantity"], ["INV-1", 999]] },
    { name: "Renamed export", rows: [["Description"], ["not a supported upload sheet"]] },
  ]);

  assert.throws(
    () => extractRows(workbook, "current_stock"),
    (error: unknown) => {
      assert.ok(error instanceof SheetSelectionError);
      assert.equal(error.code, "CURRENT_STOCK_SHEET_NOT_FOUND");
      assert.deepEqual(error.sheets.map((sheet) => sheet.name), ["Invoice Register", "Renamed export"]);
      return true;
    },
  );
});
