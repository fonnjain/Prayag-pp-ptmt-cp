import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import {
  buildMrpSeriesReview,
  deriveMrpPlanningCategory,
  parseMrpSourceBuffers,
} from "./mrp-control";
import {
  getMrpSeriesCrosswalkDecision,
  resolveMrpClassification,
} from "./mrp-classification";

test("MRP series mapping keeps disputed PTMT families visible as holds", () => {
  assert.deepEqual(
    deriveMrpPlanningCategory("324", "PTMT & Plastic Fittings", "P.V.C. Connections"),
    { category: "P.V.C. Connections", status: "hold" },
  );
  assert.deepEqual(
    deriveMrpPlanningCategory("3272-C", "PTMT & Plastic Fittings", "Collapsible Waste Pipe"),
    { category: "Collapsible Waste Pipes", status: "hold" },
  );
  assert.deepEqual(
    deriveMrpPlanningCategory("228-QW", "PTMT & Plastic Fittings", "Special Cock"),
    { category: "Special Cock", status: "hold" },
  );
  assert.deepEqual(
    deriveMrpPlanningCategory("DB-02L", "Ceramic Sanitaryware | PTMT & Plastic Fittings", "Cistern's & Seat Cover's Accessories"),
    { category: "Cistern & Seat Cover", status: "resolved" },
  );
});

test("MRP parser preserves blank colour prices and excludes invalid reference rows", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    {
      item_code: "324",
      division: "PTMT & Plastic Fittings",
      series: "P.V.C. Connections",
      product_name: "PVC Connector",
      mrp: "120.00",
      effective_date: "2026-09-01",
      mrp_ivory: "",
      mrp_white_with_jet: "125",
      mrp_pink_green_blue: "",
    },
    {
      item_code: "999",
      division: "PTMT & Plastic Fittings",
      series: "Cocks",
      product_name: "Excluded product",
      mrp: "100",
      effective_date: "2026-09-01",
    },
  ]), "products");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([
    { item_code: "999", status_note: "Invalid Input" },
  ]), "excluded_do_not_load");
  const parsed = parseMrpSourceBuffers(
    XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
    Buffer.from("item_code,division,series,product_name,mrp,effective_date\nD-1,PTMT & Plastic Fittings,Cocks,Discontinued Cock,80,2026-09-01\n"),
    Buffer.from("series,code_count,sample_codes\nP.V.C. Connections,1,324\n"),
    "test-mrp.xlsx",
  );

  assert.equal(parsed.products.length, 2);
  assert.equal(parsed.discontinued.length, 1);
  assert.equal(parsed.seriesValues.length, 1);
  assert.equal(parsed.products[0]?.isLoadable, true);
  assert.equal(parsed.products[1]?.isLoadable, false);
  assert.deepEqual(parsed.products[0]?.colourPrices, {
    mrp_ivory: null,
    mrp_white_with_jet: 125,
    mrp_pink_green_blue: null,
  });
});

test("MRP precedence is terminal for present series and rate-list fallback requires absence", () => {
  const modelCategories = new Set([
    "Cocks Standard",
    "Accessorise",
    "Unclassified",
  ]);
  assert.deepEqual(
    resolveMrpClassification(
      { itemCode: "324", division: "PTMT & Plastic Fittings", series: "P.V.C. Connections (Plain Nut Round)" },
      "Accessorise",
      modelCategories,
    ),
    {
      category: "P.V.C. Connections",
      status: "unclassified",
      source: "mrp",
      note: "MRP series: P.V.C. Connections (Plain Nut Round); held until an executable planning category and capacity line are approved.",
    },
  );
  assert.equal(
    resolveMrpClassification(
      { itemCode: "A-1", division: "PTMT & Plastic Fittings", series: "Apex" },
      "Accessorise",
      modelCategories,
    ).category,
    "Unclassified",
  );
  assert.equal(
    resolveMrpClassification(
      { itemCode: "A-2", division: "PTMT & Plastic Fittings", series: "" },
      "Accessorise",
      modelCategories,
    ).category,
    "Accessorise",
  );
});

test("the reviewed MRP series crosswalk applies only the nine high-confidence rows", () => {
  const applied: Array<[string, string]> = [
    ["Standard (New Handle)", "Cocks Standard"],
    ["Standard (Old Handle)", "Cocks Standard"],
    ["Cistern", "Cistern & Seat Cover"],
    ["Cistern's & Seat Cover's Accessories", "Cistern & Seat Cover"],
    ["Toilet Seat Covers", "Cistern & Seat Cover"],
    ["Waste Coupling", "Accessorise"],
    ["Tank Nipples", "Accessorise"],
    ["Water Tank Line Filter", "Accessorise"],
    ["Washing Machine", "Faucets & Jetsprays & Shower"],
  ];
  for (const [series, category] of applied) {
    assert.deepEqual(
      getMrpSeriesCrosswalkDecision(series),
      { category, status: "applied" },
    );
    assert.deepEqual(
      deriveMrpPlanningCategory("TEST", "PTMT & Plastic Fittings", series),
      { category, status: "resolved" },
    );
  }
});

test("reviewed series take precedence over mixed-division fallback", () => {
  assert.deepEqual(
    deriveMrpPlanningCategory(
      "MIXED-CISTERN",
      "Ceramic Sanitaryware | PTMT & Plastic Fittings",
      "Cistern",
    ),
    { category: "Cistern & Seat Cover", status: "resolved" },
  );
  assert.deepEqual(
    deriveMrpPlanningCategory(
      "MIXED-HELIX",
      "Ceramic Sanitaryware | PTMT & Plastic Fittings",
      "Helix",
    ),
    { category: null, status: "hold" },
  );
});

test("premium-cock proposals remain held and near-matches do not infer a category", () => {
  const pending = [
    "Erosa (Black)", "Cobra", "Helix", "Luxor", "Quadra (Royal)",
    "Crystal", "Glory", "Astra", "Roman", "Diamond", "Flora (Royal)",
  ];
  for (const series of pending) {
    assert.deepEqual(
      getMrpSeriesCrosswalkDecision(series),
      { category: null, status: "pending_review" },
    );
    assert.deepEqual(
      deriveMrpPlanningCategory("TEST", "PTMT & Plastic Fittings", series),
      { category: null, status: "hold" },
    );
    assert.equal(
      resolveMrpClassification(
        { itemCode: "TEST", division: "PTMT & Plastic Fittings", series },
        "Cocks Standard",
        new Set(["Cocks Standard", "Cocks Premium", "Unclassified"]),
      ).category,
      "Unclassified",
    );
  }
  assert.deepEqual(
    getMrpSeriesCrosswalkDecision("Standard  (New Handle)"),
    { category: "Cocks Standard", status: "applied" },
  );
  assert.deepEqual(
    getMrpSeriesCrosswalkDecision("Standard (New Handle) Extended"),
    { category: null, status: "unmapped" },
  );
});

test("MRP series review separates existing resolver classifications from truly held demand", () => {
  const review = buildMrpSeriesReview(
    [
      { series: "Ball Cocks", codeCount: 1, sampleCodes: "BC-1" },
      { series: "P.V.C. Connections", codeCount: 1, sampleCodes: "PVC-1" },
      { series: "Helix", codeCount: 1, sampleCodes: "H-1" },
    ],
    [
      { itemCode: "BC-1", division: "PTMT & Plastic Fittings", series: "Ball Cocks" },
      { itemCode: "PVC-1", division: "PTMT & Plastic Fittings", series: "P.V.C. Connections" },
      { itemCode: "H-1", division: "PTMT & Plastic Fittings", series: "Helix" },
    ],
    new Map([["BC-1", 10], ["PVC-1", 20], ["H-1", 30]]),
    new Set(["Ball Cock", "Unclassified"]),
  );
  assert.deepEqual(
    review.map(({ series, status, effectiveStatus, effectiveCategories, julyDemandQuantity }) => ({
      series,
      status,
      effectiveStatus,
      effectiveCategories,
      julyDemandQuantity,
    })),
    [
      {
        series: "Ball Cocks",
        status: "existing_rule",
        effectiveStatus: "classified",
        effectiveCategories: ["Ball Cock"],
        julyDemandQuantity: 10,
      },
      {
        series: "P.V.C. Connections",
        status: "held",
        effectiveStatus: "unclassified",
        effectiveCategories: ["P.V.C. Connections"],
        julyDemandQuantity: 20,
      },
      {
        series: "Helix",
        status: "pending_review",
        effectiveStatus: "unclassified",
        effectiveCategories: ["Unclassified"],
        julyDemandQuantity: 30,
      },
    ],
  );
});