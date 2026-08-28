import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCatalogueCategoryReport,
  buildCoverageReport,
  calculateSyncCounts,
  CATALOGUE_PAGE_SIZE,
  fetchAllCatalogueProducts,
  mapCatalogueDivision,
  normalizeCatalogueCode,
  reviewedBufferMultiplier,
  type CatalogueProduct,
} from "./master-products";

function product(
  itemCode: string,
  division = "PTMT & Plastic Fittings",
  category: string | null = "PTMT Taps",
): CatalogueProduct {
  return {
    sourceProductId: itemCode,
    itemCode,
    productName: `Product ${itemCode}`,
    division,
    category,
    uom: "PCS",
  };
}

test("clean catalogue divisions map and only the reviewed combined division maps", () => {
  assert.equal(mapCatalogueDivision("PTMT & Plastic Fittings"), "PTMT");
  assert.equal(mapCatalogueDivision("Pipes & Fittings"), "Plumbing");
  assert.equal(mapCatalogueDivision("CP Fittings / Faucets"), "CP");
  assert.equal(mapCatalogueDivision("Ceramic Sanitaryware | PTMT & Plastic Fittings"), "PTMT");
  assert.equal(mapCatalogueDivision("CP Fittings / Faucets | PTMT & Plastic Fittings"), null);
  assert.equal(mapCatalogueDivision("Hardware"), null);
});

test("catalogue code normalization removes Excel trailing .0 signatures", () => {
  assert.equal(normalizeCatalogueCode("120.0"), "120");
  assert.equal(normalizeCatalogueCode(" 1231 "), "1231");
});

test("only classified products with an approved category receive a buffer multiplier", () => {
  const buffers = new Map([["PTMT Taps", 1.5]]);
  assert.equal(reviewedBufferMultiplier("classified", "PTMT Taps", buffers), 1.5);
  assert.equal(reviewedBufferMultiplier("unclassified", "PTMT Taps", buffers), null);
  assert.equal(reviewedBufferMultiplier("ambiguous", "PTMT Taps", buffers), null);
  assert.equal(reviewedBufferMultiplier("classified", "Unreviewed", buffers), null);
});

test("category report is deterministic and retains blank categories", () => {
  const report = buildCatalogueCategoryReport([
    product("b", "Pipes & Fittings", null),
    product("a", "Pipes & Fittings", "CPVC Fittings"),
    product("c", "Hardware", "HW Trading"),
  ]);
  assert.deepEqual(report.divisions.map((row) => row.division), ["Hardware", "Pipes & Fittings"]);
  assert.deepEqual(report.divisions[1]?.categories, [
    { category: null, products: 1 },
    { category: "CPVC Fittings", products: 1 },
  ]);
  assert.equal(report.divisions[0]?.mappingStatus, "excluded");
});

test("catalogue pagination fetches every page at pageSize 200", async () => {
  const calls: string[] = [];
  const rows = Array.from({ length: 201 }, (_, index) => ({
    id: index,
    itemCode: `P-${index}`,
    productName: `Product ${index}`,
    division: "PTMT & Plastic Fittings",
    category: "PTMT Taps",
    uom: "PCS",
  }));
  const fetcher: typeof fetch = async (url) => {
    calls.push(String(url));
    const page = new URL(String(url)).searchParams.get("page");
    const start = page === "1" ? 0 : CATALOGUE_PAGE_SIZE;
    return new Response(JSON.stringify({
      rows: rows.slice(start, start + CATALOGUE_PAGE_SIZE),
      total: rows.length,
      page: Number(page),
      pageSize: CATALOGUE_PAGE_SIZE,
    }), { status: 200 });
  };
  const oldKey = process.env["PRAYAG_CATALOGUE_API_KEY"];
  process.env["PRAYAG_CATALOGUE_API_KEY"] = "unit-test-key";
  try {
    const products = await fetchAllCatalogueProducts(fetcher);
    assert.equal(products.length, 201);
    assert.equal(calls.length, 2);
    assert.match(calls[0] ?? "", /page=1&pageSize=200/);
    assert.match(calls[1] ?? "", /page=2&pageSize=200/);
  } finally {
    if (oldKey === undefined) delete process.env["PRAYAG_CATALOGUE_API_KEY"];
    else process.env["PRAYAG_CATALOGUE_API_KEY"] = oldKey;
  }
});

test("sync counts distinguish unchanged, changed, reactivated, inserted, and deactivated rows", () => {
  const existing = [
    { ...product("same"), segment: "PTMT", planningCategory: null, isActive: true },
    { ...product("changed"), productName: "Old", segment: "PTMT", planningCategory: null, isActive: true },
    { ...product("inactive"), segment: "PTMT", planningCategory: null, isActive: false },
    { ...product("gone"), segment: "PTMT", planningCategory: null, isActive: true },
  ];
  const incoming = [
    { ...product("same"), segment: "PTMT", planningCategory: null },
    { ...product("changed"), segment: "PTMT", planningCategory: "Cocks Standard" },
    { ...product("inactive"), segment: "PTMT", planningCategory: null },
    { ...product("new"), segment: "Plumbing", planningCategory: null },
  ];
  const counts = calculateSyncCounts(existing, incoming);
  assert.deepEqual(
    { inserted: counts.inserted, updated: counts.updated, unchanged: counts.unchanged, deactivated: counts.deactivated },
    { inserted: 1, updated: 2, unchanged: 1, deactivated: 1 },
  );
  assert.equal(counts.bySegment.Plumbing?.inserted, 1);
  assert.equal(counts.bySegment.PTMT?.deactivated, 1);
});

test("coverage compares codes per segment and preserves review context", () => {
  const report = buildCoverageReport(
    [
      { ...product("A"), segment: "PTMT", planningCategory: "Cocks Standard" },
      { ...product("B"), segment: "PTMT", planningCategory: null },
      { ...product("P"), division: "Pipes & Fittings", segment: "Plumbing", planningCategory: null },
    ],
    [
      { itemCode: "A", category: "Cocks Standard", colour: "WHITE", segment: "PTMT" },
      { itemCode: "OLD", category: "Cocks Standard", colour: "0", segment: "PTMT" },
    ],
  );
  assert.deepEqual(report[0], {
    segment: "PTMT",
    inBoth: 1,
    masterOnly: 1,
    itemMasterOnly: 1,
    masterOnlyProducts: [{
      itemCode: "B",
      productName: "Product B",
      division: "PTMT & Plastic Fittings",
      category: "PTMT Taps",
      planningCategory: null,
    }],
    itemMasterOnlyProducts: [{ itemCode: "OLD", category: "Cocks Standard", colour: "0" }],
  });
});