import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  buildEffectivePtmtRoster,
  buildRateListReconciliation,
  normalizeRateListCode,
  parseRateListRows,
  rateListPlanningCategory,
} from "./rate-list";
import { extractRateListRows } from "../routes/uploads";

function rate(code: string, rangeName = "New Range") {
  return {
    source_tab: "PTMT",
    code,
    name: `Product ${code}`,
    range: rangeName.toUpperCase(),
    range_name: rangeName,
  };
}

test("rate-list parser canonicalises codes and rejects empty recognised files", () => {
  assert.equal(normalizeRateListCode(" 324-k.0 "), "324-K");
  assert.throws(
    () => parseRateListRows([{ source_tab: "PTMT", code: "", name: "", range: "", range_name: "" }]),
    /no recognised code rows/i,
  );
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([["source_tab", "code", "name", "range", "range_name"]]),
    "PTMT",
  );
  assert.throws(
    () => extractRateListRows(workbook),
    /no recognised code rows/i,
  );
});

test("rate-list category promotion is conservative", () => {
  assert.equal(rateListPlanningCategory({ ...parseRateListRows([rate("1", "Ball Cock")])[0]! }), "Ball Cock");
  assert.equal(rateListPlanningCategory(parseRateListRows([rate("2", "Unfamiliar Family")])[0]!), "Unclassified");
});

test("effective PTMT roster preserves workbook variants and adds rate-list identities", () => {
  const item = {
    id: 1,
    segment: "PTMT",
    category: "Cocks Standard",
    itemCode: "101",
    colour: "WHITE",
    classificationStatus: "classified",
    classificationSource: "workbook",
    classificationNote: null,
  } as any;
  const roster = buildEffectivePtmtRoster(
    [item],
    parseRateListRows([rate("101"), rate("324-K")]),
  );
  assert.deepEqual(
    roster.map((row) => [row.itemCode, row.colour, row.rosterSource]),
    [["101", "WHITE", "rate-list"], ["324-K", "", "rate-list"]],
  );
  assert.equal(roster.find((row) => row.itemCode === "324-K")?.classificationStatus, "unclassified");
});

test("rate-list reconciliation keeps -K variants distinct and reports source quantities", () => {
  const report = buildRateListReconciliation(
    parseRateListRows([rate("324"), rate("324-K"), rate("323-K")]),
    [
      { "Item Code": "324", Qty: 10 },
      { "Item Code": "324-K", Qty: 20 },
      { "Item Code": "323-K", Qty: 30 },
      { "Item Code": "ABSENT", Qty: 7 },
    ],
  );
  assert.equal(report.rateListCodeCount, 3);
  assert.equal(report.matchedCodeCount, 3);
  assert.equal(report.matchedQuantity, 60);
  assert.deepEqual(report.unmatchedCodes, [{ code: "ABSENT", quantity: 7 }]);
});