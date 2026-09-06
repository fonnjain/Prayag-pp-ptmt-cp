import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import * as XLSX from "xlsx";
import {
  buildEffectivePtmtRoster,
  buildRateListCategorySplit,
  buildRateListReconciliation,
  buildRateListRangeAudit,
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
  assert.equal(
    rateListPlanningCategory(parseRateListRows([rate("2", "Connection")])[0]!),
    "P.V.C. Connections",
  );
  assert.equal(
    rateListPlanningCategory(parseRateListRows([rate("3", "Waste Pipe")])[0]!),
    "Waste Pipes",
  );
  assert.equal(rateListPlanningCategory(parseRateListRows([rate("4", "Unfamiliar Family")])[0]!), "Unclassified");
  assert.equal(rateListPlanningCategory(parseRateListRows([rate("5", "ACCESSORIES")])[0]!), "Unclassified");
  assert.equal(rateListPlanningCategory(parseRateListRows([rate("6", "SPARE PART")])[0]!), "Unclassified");
});

test("rate-list categories use RANGE NAME alone", () => {
  const row = parseRateListRows([{
    ...rate("1", "DROPLETS"),
    name: "Ball Cock Replacement",
  }])[0]!;
  assert.equal(rateListPlanningCategory(row), "Unclassified");
  assert.equal(
    rateListPlanningCategory(parseRateListRows([rate("2", "BALL COCK CHUTKI")])[0]!),
    "Ball Cock",
  );
});

test("rate-list range audit counts distinct codes and sorts by count", () => {
  const audit = buildRateListRangeAudit(parseRateListRows([
    rate("1", "Other"),
    rate("2", "Cabinet"),
    rate("3", "Cabinet"),
    rate("3", "Cabinet"),
    rate("4", "Accessories"),
    rate("5", ""),
  ]));
  assert.deepEqual(audit, [
    { rangeName: "CABINET", category: "Cabinet", codeCount: 2 },
    { rangeName: "", category: "Unclassified", codeCount: 1 },
    { rangeName: "ACCESSORIES", category: "Unclassified", codeCount: 1 },
    { rangeName: "OTHER", category: "Unclassified", codeCount: 1 },
  ]);
});

test("supplied rate-list audit has the governed 148 normalized range values", () => {
  const workbook = XLSX.read(
    readFileSync(path.resolve(process.cwd(), "../../attached_assets/prayag_rate_list_codes_1787993531227.csv")),
    { type: "buffer" },
  );
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[workbook.SheetNames[0]!]!);
  const audit = buildRateListRangeAudit(parseRateListRows(rows));
  assert.equal(audit.length, 148);
  assert.deepEqual(audit.slice(0, 4).map(({ rangeName, codeCount }) => ({ rangeName, codeCount })), [
    { rangeName: "SPARE PART", codeCount: 376 },
    { rangeName: "CP ACCESSORIES", codeCount: 338 },
    { rangeName: "", codeCount: 328 },
    { rangeName: "ACCESSORIES", codeCount: 101 },
  ]);
});

test("attached 58-row proposal resolves every range name and preserves explicit exclusions", () => {
  const mappingWorkbook = XLSX.read(
    readFileSync(path.resolve(process.cwd(), "../../attached_assets/ptmt_range_name_mapping_1788001669348.csv")),
    { type: "buffer" },
  );
  const mappingRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    mappingWorkbook.Sheets[mappingWorkbook.SheetNames[0]!]!,
  );
  assert.equal(mappingRows.length, 58);
  for (const [index, mapping] of mappingRows.entries()) {
    const rangeName = String(mapping.range_name ?? "");
    const expectedCategory = String(mapping.planning_category ?? "");
    const resolved = rateListPlanningCategory(parseRateListRows([rate(String(index + 1), rangeName)])[0]!);
    assert.equal(resolved, expectedCategory, rangeName);
  }
  for (const rangeName of ["DROPLETS", "", "CP ACCESSORIES", "ACCESSORIES", "DOOR HANDEL", "HINGE", "BOLT", "HOOK"]) {
    assert.equal(
      rateListPlanningCategory(parseRateListRows([rate("excluded-" + rangeName, rangeName)])[0]!),
      "Unclassified",
      rangeName || "(blank)",
    );
  }
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

test("effective PTMT roster bridges only approved Luxor and Glory MRP-only identities", () => {
  const roster = buildEffectivePtmtRoster(
    [],
    [],
    [],
    [
      { itemCode: "P-121", division: "PTMT & Plastic Fittings", series: "Luxor" },
      { itemCode: "PS-144", division: "PTMT & Plastic Fittings", series: "Glory" },
      { itemCode: "121-OSF", division: "PTMT & Plastic Fittings", series: "Standard (New Handle)" },
      { itemCode: "122-L", division: "PTMT & Plastic Fittings", series: "Lagoona" },
    ],
    new Set(["Cocks Standard", "Unclassified"]),
  );
  assert.deepEqual(
    roster.map((row) => [row.itemCode, row.category, row.rosterSource]),
    [
      ["P-121", "Cocks Standard", "mrp"],
      ["PS-144", "Cocks Standard", "mrp"],
    ],
  );
});

test("category split counts effective codes, July quantities, and reviewed multipliers", () => {
  const roster = buildEffectivePtmtRoster(
    [
      {
        id: 1,
        segment: "PTMT",
        category: "Unclassified",
        itemCode: "1",
        colour: "WHITE",
        classificationStatus: "unclassified",
        classificationSource: "seed",
        classificationNote: null,
      },
      {
        id: 2,
        segment: "PTMT",
        category: "Cocks Standard",
        itemCode: "2",
        colour: "WHITE",
        classificationStatus: "classified",
        classificationSource: "workbook",
        classificationNote: null,
      },
    ] as any,
    parseRateListRows([
      rate("1", "Bib Cock Standard (121)"),
      rate("2", "DROPLETS"),
      rate("3", "CABINET"),
      rate("4", "DROPLETS"),
    ]),
  );
  const split = buildRateListCategorySplit(
    roster,
    new Map([["1", 100], ["2", 50], ["3", 20], ["4", 70]]),
    new Map([["Cocks Standard", 1.5], ["Cabinet", 1.25]]),
  );
  assert.deepEqual(
    split.filter((entry) => entry.codeCount > 0),
    [
      { category: "Cocks Standard", codeCount: 2, julySourceQuantity: 150, multiplier: 1.5 },
      { category: "Cabinet", codeCount: 1, julySourceQuantity: 20, multiplier: 1.25 },
      { category: "Unclassified", codeCount: 1, julySourceQuantity: 70, multiplier: null },
    ],
  );
});

test("category split keeps ambiguous codes unclassified regardless of row order", () => {
  const rows = (categories: string[]) => categories.map((category, index) => ({
    id: index + 1,
    segment: "PTMT",
    category,
    itemCode: "124-FH",
    colour: index === 0 ? "WHITE" : "IVORY",
    classificationStatus: category === "Unclassified" ? "unclassified" : "classified",
    classificationSource: "workbook",
    classificationNote: null,
    rosterSource: "workbook",
  })) as any;
  const buffers = new Map([["Cocks Standard", 1.5], ["Cocks Premium", 1.2]]);
  const firstOrder = buildRateListCategorySplit(
    rows(["Cocks Standard", "Cocks Premium", "Cocks Standard"]),
    new Map([["124-FH", 900]]),
    buffers,
  );
  const secondOrder = buildRateListCategorySplit(
    rows(["Cocks Premium", "Cocks Standard", "Cocks Premium"]),
    new Map([["124-FH", 900]]),
    buffers,
  );
  const compact = (split: ReturnType<typeof buildRateListCategorySplit>) =>
    split.filter((entry) => entry.codeCount > 0);
  assert.deepEqual(compact(firstOrder), [
    { category: "Unclassified", codeCount: 1, julySourceQuantity: 900, multiplier: null },
  ]);
  assert.deepEqual(compact(secondOrder), compact(firstOrder));
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
  assert.equal(report.rosterCodeCount, 3);
  assert.equal(report.matchedCodeCount, 3);
  assert.equal(report.matchedQuantity, 60);
  assert.deepEqual(report.unmatchedCodes, [{ code: "ABSENT", quantity: 7 }]);
});