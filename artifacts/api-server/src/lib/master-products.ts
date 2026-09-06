import { and, asc, desc, eq, inArray, not, sql } from "drizzle-orm";
import {
  db,
  itemMasterTable,
  masterProductCategoryMappingsTable,
  masterProductsTable,
  bufferCategoriesTable,
  uploadedFilesTable,
  productClassificationAuditTable,
  mrpControlRowsTable,
  mrpControlSourcesTable,
  type MasterProduct,
} from "@workspace/db";
import { pendingOrderTotalsFromRows } from "./sheets";
import {
  normalizeRateListCode,
  loadRateListRows,
  rateListPlanningCategory,
} from "./rate-list";
import { resolveMrpClassification, type MrpClassificationRow } from "./mrp-classification";

export const MASTER_PRODUCT_SOURCE = "competition-analysis";
export const CATALOGUE_PAGE_SIZE = 200;
export const CATALOGUE_API_DEFAULT_BASE_URL = "https://prayag-competition-analysis.replit.app/api";
export const CATALOGUE_DIVISIONS = [
  "Pipes & Fittings",
  "PTMT & Plastic Fittings",
  "CP Fittings / Faucets",
  "Hardware",
  "Ceramic Sanitaryware",
] as const;
export const CATALOGUE_PLANNING_SEGMENTS = ["PTMT", "Plumbing", "CP"] as const;
export type CataloguePlanningSegment = (typeof CATALOGUE_PLANNING_SEGMENTS)[number];

export class InvalidProductClassificationError extends Error {
  readonly code = "INVALID_PRODUCT_CLASSIFICATION";
}

export function reviewedBufferMultiplier(
  status: string,
  category: string,
  buffers: ReadonlyMap<string, number>,
): number | null {
  if (status !== "classified") return null;
  return buffers.get(category) ?? null;
}

const DIVISION_SEGMENTS: Readonly<Record<string, CataloguePlanningSegment>> = {
  "Pipes & Fittings": "Plumbing",
  "PTMT & Plastic Fittings": "PTMT",
  "CP Fittings / Faucets": "CP",
};
const REVIEWED_COMBINED_DIVISION_SEGMENTS: Readonly<Record<string, CataloguePlanningSegment>> = {
  "Ceramic Sanitaryware | PTMT & Plastic Fittings": "PTMT",
};
const EXCLUDED_DIVISIONS = new Set(["Hardware", "Ceramic Sanitaryware"]);

export type CatalogueProduct = {
  sourceProductId: string | null;
  itemCode: string;
  productName: string | null;
  division: string;
  category: string | null;
  uom: string | null;
};

export type CataloguePage = {
  rows: unknown[];
  total: number;
  page: number;
  pageSize: number;
};

export type CategoryReport = {
  productsFetched: number;
  divisions: Array<{
    division: string;
    products: number;
    mappedSegment: CataloguePlanningSegment | null;
    mappingStatus: "mapped" | "excluded" | "review";
    categories: Array<{ category: string | null; products: number }>;
  }>;
};

export type SyncCounts = {
  productsFetched: number;
  inserted: number;
  updated: number;
  unchanged: number;
  deactivated: number;
  bySegment: Record<string, {
    fetched: number;
    inserted: number;
    updated: number;
    unchanged: number;
    deactivated: number;
  }>;
};

export type CoverageDetail = {
  itemCode: string;
  productName?: string | null;
  division?: string;
  category?: string | null;
  planningCategory?: string | null;
  colour?: string;
};

export type SegmentCoverage = {
  segment: CataloguePlanningSegment;
  inBoth: number;
  masterOnly: number;
  itemMasterOnly: number;
  masterOnlyProducts: CoverageDetail[];
  itemMasterOnlyProducts: CoverageDetail[];
};

export type ProductClassificationStatus = "classified" | "unclassified" | "ambiguous";
export type ProductClassificationSource = "workbook" | "rate-list" | "catalogue" | "seed" | "mrp" | null;

export type ProductListRow = {
  key: string;
  segment: CataloguePlanningSegment;
  itemCode: string;
  colour: string | null;
  productName: string | null;
  division: string | null;
  category: string;
  status: ProductClassificationStatus;
  source: ProductClassificationSource;
  note: string | null;
  inCatalogue: boolean;
  inPlanningWorkbook: boolean;
  lastSeenProductionMonth: string | null;
  pendingQuantity: number;
  dummyQuantity: number;
  bufferReq: number | null;
  auditCount: number;
};

function normalizedStatus(value: unknown): ProductClassificationStatus {
  return value === "ambiguous" || value === "unclassified" ? value : "classified";
}

function productKey(segment: string, itemCode: string, colour: string | null, category?: string): string {
  const categoryPart = category == null ? "" : `::${category.trim().toUpperCase()}`;
  return `${segment}::${normalizeCatalogueCode(itemCode)}::${(colour ?? "").trim().toUpperCase()}${categoryPart}`;
}

/**
 * Build the review roster without promoting catalogue-only products into
 * item_master. This is intentionally a read model: planning still consumes
 * item_master, while Products exposes the complete catalogue/planning view.
 */
export async function getProducts(input: {
  segment: CataloguePlanningSegment;
  status?: ProductClassificationStatus;
  category?: string;
  source?: Exclude<ProductClassificationSource, null>;
  search?: string;
}): Promise<{ rows: ProductListRow[]; total: number; categories: string[] }> {
  const [items, catalogues, buffers, pendingFile, lastMonthFile, audits, mrpSource, rateRows] = await Promise.all([
    db.select().from(itemMasterTable).where(eq(itemMasterTable.segment, input.segment)),
    db.select().from(masterProductsTable).where(and(
      eq(masterProductsTable.source, MASTER_PRODUCT_SOURCE),
      eq(masterProductsTable.isActive, true),
      eq(masterProductsTable.segment, input.segment),
    )),
    db.select().from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, input.segment)),
    db.select({ rows: uploadedFilesTable.rows }).from(uploadedFilesTable)
      .where(eq(uploadedFilesTable.kind, "pending_orders"))
      .orderBy(desc(uploadedFilesTable.uploadedAt)).limit(1),
    db.select({ rows: uploadedFilesTable.rows }).from(uploadedFilesTable)
      .where(eq(uploadedFilesTable.kind, "last_month_pending"))
      .orderBy(desc(uploadedFilesTable.uploadedAt)).limit(1),
    db.select().from(productClassificationAuditTable)
      .where(eq(productClassificationAuditTable.segment, input.segment)),
    db.select({ id: mrpControlSourcesTable.id }).from(mrpControlSourcesTable)
      .orderBy(desc(mrpControlSourcesTable.importedAt)).limit(1),
    loadRateListRows(),
  ]);

  const catalogueByCode = new Map(catalogues.map((row) => [normalizeCatalogueCode(row.itemCode), row]));
  const rateByCode = new Map(rateRows.map((row) => [row.code, row]));
  const bufferByCategory = new Map(buffers.map((row) => [row.name, row.multiplier]));
  const mrpRows: MrpClassificationRow[] = input.segment === "PTMT" && mrpSource[0]
    ? await db.select({
      itemCode: mrpControlRowsTable.itemCode,
      division: mrpControlRowsTable.division,
      series: mrpControlRowsTable.series,
    }).from(mrpControlRowsTable).where(and(
      eq(mrpControlRowsTable.sourceId, mrpSource[0].id),
      eq(mrpControlRowsTable.rowType, "product"),
      eq(mrpControlRowsTable.segment, "PTMT"),
      eq(mrpControlRowsTable.isLoadable, true),
    ))
    : [];
  const mrpByCode = new Map(mrpRows.map((row) => [normalizeCatalogueCode(row.itemCode), row]));
  const modelCategories = new Set(buffers.map((row) => row.name));
  const pendingCurrent = pendingOrderTotalsFromRows((pendingFile[0]?.rows ?? []) as Record<string, unknown>[], input.segment);
  const pendingLast = pendingOrderTotalsFromRows((lastMonthFile[0]?.rows ?? []) as Record<string, unknown>[], input.segment);
  const pendingByCode = new Map<string, number>();
  for (const [code, quantity] of pendingCurrent.byCode) pendingByCode.set(code, quantity);
  for (const [code, quantity] of pendingLast.byCode) pendingByCode.set(code, (pendingByCode.get(code) ?? 0) + quantity);
  const auditsByKey = new Map<string, number>();
  for (const audit of audits) {
    const key = productKey(audit.segment, audit.itemCode, audit.colour);
    auditsByKey.set(key, (auditsByKey.get(key) ?? 0) + 1);
  }

  const rows: ProductListRow[] = [];
  const representedCodes = new Set<string>();
  for (const item of items) {
    const code = normalizeCatalogueCode(item.itemCode);
    const catalogue = catalogueByCode.get(code);
    const colour = item.colour || null;
    const status = normalizedStatus(item.classificationStatus);
    const itemCategory = item.category?.trim() || "Unclassified";
    const rate = rateByCode.get(code);
    const retainsWorkbookClassification = status === "classified" && itemCategory !== "Unclassified";
    const fallbackCategory = retainsWorkbookClassification
      ? itemCategory
      : rate
        ? rateListPlanningCategory(rate)
        : itemCategory;
    const rangeCategory = rate ? rateListPlanningCategory(rate) : null;
    const mrpClassification = input.segment === "PTMT"
      ? resolveMrpClassification(mrpByCode.get(code), fallbackCategory, modelCategories, rangeCategory)
      : null;
    const category = mrpClassification?.category ?? fallbackCategory;
    const resolvedStatus = mrpClassification?.status ?? (retainsWorkbookClassification
      ? status
      : category === "Unclassified" ? "unclassified" : "classified");
    const pendingQuantity = pendingCurrent.exact.get(`${code}::${(colour ?? "").trim().toUpperCase()}`)
      ?? pendingByCode.get(code)
      ?? 0;
    rows.push({
      key: productKey(input.segment, code, colour, category),
      segment: input.segment,
      itemCode: code,
      colour,
      productName: catalogue?.productName ?? null,
      division: catalogue?.division ?? null,
      category,
      status: resolvedStatus,
      source: mrpClassification?.source === "mrp"
        ? "mrp"
        : rateByCode.has(code)
        ? "rate-list"
        : item.classificationSource === "workbook" || item.classificationSource === "catalogue" || item.classificationSource === "seed"
          ? item.classificationSource
        : null,
      note: mrpClassification?.note ?? (rate
        ? `Rate list: ${rate.rangeName}${category === "Unclassified" ? "; category review required." : "."}`
        : item.classificationNote ?? null),
      inCatalogue: Boolean(catalogue),
      inPlanningWorkbook: true,
      lastSeenProductionMonth: null,
      pendingQuantity: Math.max(0, pendingQuantity),
      dummyQuantity: 0,
      bufferReq: reviewedBufferMultiplier(resolvedStatus, category, bufferByCategory),
      auditCount: auditsByKey.get(productKey(input.segment, code, colour)) ?? 0,
    });
    representedCodes.add(code);
  }

  for (const rate of rateRows) {
    const code = normalizeRateListCode(rate.code);
    if (representedCodes.has(code)) continue;
    const catalogue = catalogueByCode.get(code);
    const classification = input.segment === "PTMT"
      ? resolveMrpClassification(
        mrpByCode.get(code),
        rateListPlanningCategory(rate),
        modelCategories,
        rateListPlanningCategory(rate),
      )
      : {
        category: rateListPlanningCategory(rate),
        status: rateListPlanningCategory(rate) === "Unclassified" ? "unclassified" as const : "classified" as const,
        source: "rate-list" as const,
        note: null,
      };
    const category = classification.category;
    rows.push({
      key: productKey(input.segment, code, null, category),
      segment: input.segment,
      itemCode: code,
      colour: null,
      productName: rate.name || catalogue?.productName || null,
      division: catalogue?.division ?? null,
      category,
      status: classification.status,
      source: classification.source,
      note: classification.note ?? (category === "Unclassified"
        ? `Rate list: ${rate.rangeName}; category review required.`
        : `Rate list: ${rate.rangeName}.`),
      inCatalogue: Boolean(catalogue),
      inPlanningWorkbook: false,
      lastSeenProductionMonth: null,
      pendingQuantity: Math.max(0, pendingByCode.get(code) ?? 0),
      dummyQuantity: 0,
      bufferReq: reviewedBufferMultiplier(category === "Unclassified" ? "unclassified" : "classified", category, bufferByCategory),
      auditCount: auditsByKey.get(productKey(input.segment, code, null)) ?? 0,
    });
    representedCodes.add(code);
  }

  for (const catalogue of catalogues) {
    const code = normalizeCatalogueCode(catalogue.itemCode);
    if (representedCodes.has(code)) continue;
    const fallbackCategory = catalogue.planningCategory?.trim() || "Unclassified";
    const classification = input.segment === "PTMT"
      ? resolveMrpClassification(mrpByCode.get(code), fallbackCategory, modelCategories, null)
      : {
        category: fallbackCategory,
        status: (catalogue.planningCategory ? "classified" : "unclassified") as ProductClassificationStatus,
        source: "rate-list" as const,
        note: null,
      };
    const category = classification.category;
    const status = classification.status;
    rows.push({
      key: productKey(input.segment, code, null, category),
      segment: input.segment,
      itemCode: code,
      colour: null,
      productName: catalogue.productName,
      division: catalogue.division,
      category,
      status,
      source: classification.source === "mrp" ? "mrp" : catalogue.planningCategory ? "catalogue" : null,
      note: classification.note ?? (catalogue.planningCategory ? "Catalogue classification; not yet in the planning roster." : "Catalogue product has no reviewed planning category."),
      inCatalogue: true,
      inPlanningWorkbook: false,
      lastSeenProductionMonth: null,
      pendingQuantity: Math.max(0, pendingByCode.get(code) ?? 0),
      dummyQuantity: 0,
      bufferReq: reviewedBufferMultiplier(status, category, bufferByCategory),
      auditCount: auditsByKey.get(productKey(input.segment, code, null)) ?? 0,
    });
  }

  const search = input.search?.trim().toUpperCase();
  const filtered = rows.filter((row) =>
    (!input.status || row.status === input.status)
    && (!input.category || row.category === input.category)
    && (!input.source || row.source === input.source)
    && (!search || row.itemCode.includes(search) || (row.productName ?? "").toUpperCase().includes(search)),
  ).sort((a, b) => a.itemCode.localeCompare(b.itemCode) || (a.colour ?? "").localeCompare(b.colour ?? ""));
  return {
    rows: filtered,
    total: filtered.length,
    categories: [...new Set(rows.map((row) => row.category))].sort((a, b) => a.localeCompare(b)),
  };
}

export async function reclassifyProduct(input: {
  segment: CataloguePlanningSegment;
  itemCode: string;
  colour: string;
  category: string;
  status: ProductClassificationStatus;
  reason: string;
  changedBy: string;
}) {
  const code = normalizeCatalogueCode(input.itemCode);
  const colour = input.colour.trim().toUpperCase();
  if (input.status === "classified") {
    const [approvedCategory] = await db.select({ name: bufferCategoriesTable.name })
      .from(bufferCategoriesTable)
      .where(and(
        eq(bufferCategoriesTable.segment, input.segment),
        eq(bufferCategoriesTable.name, input.category.trim()),
      ))
      .limit(1);
    if (!approvedCategory) {
      throw new InvalidProductClassificationError(
        `Category "${input.category.trim()}" has no approved buffer configuration for ${input.segment}.`,
      );
    }
  }
  const [previous] = await db.select().from(itemMasterTable).where(and(
    eq(itemMasterTable.segment, input.segment),
    eq(itemMasterTable.itemCode, code),
    eq(itemMasterTable.colour, colour),
  )).limit(1);
  if (!previous) return null;
  return db.transaction(async (tx) => {
    const [updated] = await tx.update(itemMasterTable).set({
      category: input.category.trim() || "Unclassified",
      classificationStatus: input.status,
      classificationSource: "catalogue",
      classificationNote: input.reason.trim(),
    }).where(eq(itemMasterTable.id, previous.id)).returning();
    await tx.insert(productClassificationAuditTable).values({
      segment: input.segment,
      itemCode: code,
      colour,
      previousCategory: previous.category,
      previousStatus: previous.classificationStatus,
      newCategory: updated.category,
      newStatus: updated.classificationStatus,
      reason: input.reason.trim(),
      changedBy: input.changedBy,
    });
    return updated;
  });
}

export function normalizeCatalogueCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\.0$/, "");
}

export function mapCatalogueDivision(division: string): CataloguePlanningSegment | null {
  return DIVISION_SEGMENTS[division] ?? REVIEWED_COMBINED_DIVISION_SEGMENTS[division] ?? null;
}

export function catalogueDivisionStatus(
  division: string,
): CategoryReport["divisions"][number]["mappingStatus"] {
  if (mapCatalogueDivision(division)) return "mapped";
  if (EXCLUDED_DIVISIONS.has(division)) return "excluded";
  return "review";
}

function parseProduct(row: unknown): CatalogueProduct {
  if (!row || typeof row !== "object") {
    throw new Error("Catalogue API returned a non-object product row.");
  }
  const record = row as Record<string, unknown>;
  const itemCode = normalizeCatalogueCode(record.itemCode ?? record.item_code);
  if (!itemCode) throw new Error("Catalogue API returned a product without itemCode.");
  const productNameValue = String(record.productName ?? record.product_name ?? "").trim();
  const productName = productNameValue || null;
  const division = String(record.division ?? "").trim();
  if (!division) throw new Error(`Catalogue product ${itemCode} has no division.`);
  const categoryValue = record.category;
  const category = categoryValue == null || String(categoryValue).trim() === ""
    ? null
    : String(categoryValue).trim();
  const uomValue = record.uom;
  return {
    sourceProductId: record.id == null ? null : String(record.id),
    itemCode,
    productName,
    division,
    category,
    uom: uomValue == null || String(uomValue).trim() === "" ? null : String(uomValue).trim(),
  };
}

function catalogueBaseUrl(): string {
  return (
    process.env["PRAYAG_CATALOGUE_API_BASE_URL"]?.trim().replace(/\/+$/, "") ||
    CATALOGUE_API_DEFAULT_BASE_URL
  );
}

export function catalogueApiUrl(page: number): string {
  return `${catalogueBaseUrl()}/v1/products?page=${page}&pageSize=${CATALOGUE_PAGE_SIZE}`;
}

export async function fetchCataloguePage(
  page: number,
  fetcher: typeof fetch = fetch,
): Promise<{ products: CatalogueProduct[]; total: number }> {
  const apiKey = process.env["PRAYAG_CATALOGUE_API_KEY"]?.trim();
  if (!apiKey) {
    throw new Error("PRAYAG_CATALOGUE_API_KEY is not configured.");
  }
  const response = await fetcher(catalogueApiUrl(page), {
    headers: { "X-API-Key": apiKey, Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Catalogue API request failed with HTTP ${response.status}.`);
  }
  const payload = (await response.json()) as Partial<CataloguePage>;
  const total = payload.total;
  if (!Array.isArray(payload.rows) || typeof total !== "number" || !Number.isInteger(total) || total < 0) {
    throw new Error("Catalogue API returned an invalid paginated response.");
  }
  return { products: payload.rows.map(parseProduct), total };
}

export async function fetchAllCatalogueProducts(
  fetcher: typeof fetch = fetch,
): Promise<CatalogueProduct[]> {
  const first = await fetchCataloguePage(1, fetcher);
  if (first.total === 0) {
    throw new Error("Catalogue API returned zero products; refusing to sync or deactivate the catalogue.");
  }
  const pageCount = Math.ceil(first.total / CATALOGUE_PAGE_SIZE);
  const products = [...first.products];
  for (let page = 2; page <= pageCount; page++) {
    const next = await fetchCataloguePage(page, fetcher);
    products.push(...next.products);
  }
  if (products.length !== first.total) {
    throw new Error(
      `Catalogue API pagination was incomplete: expected ${first.total} products, received ${products.length}.`,
    );
  }
  const seen = new Set<string>();
  for (const product of products) {
    if (seen.has(product.itemCode)) {
      throw new Error(`Catalogue API returned duplicate itemCode ${product.itemCode}.`);
    }
    seen.add(product.itemCode);
  }
  return products;
}

export function buildCatalogueCategoryReport(products: CatalogueProduct[]): CategoryReport {
  const byDivision = new Map<string, Map<string | null, number>>();
  for (const product of products) {
    const categories = byDivision.get(product.division) ?? new Map<string | null, number>();
    categories.set(product.category, (categories.get(product.category) ?? 0) + 1);
    byDivision.set(product.division, categories);
  }
  return {
    productsFetched: products.length,
    divisions: [...byDivision.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([division, categories]) => ({
        division,
        products: [...categories.values()].reduce((sum, count) => sum + count, 0),
        mappedSegment: mapCatalogueDivision(division),
        mappingStatus: catalogueDivisionStatus(division),
        categories: [...categories.entries()]
          .sort(([a], [b]) => (a ?? "").localeCompare(b ?? ""))
          .map(([category, count]) => ({ category, products: count })),
      })),
  };
}

function sameNullable(a: unknown, b: unknown): boolean {
  return a == null ? b == null : a === b;
}

export function calculateSyncCounts(
  existing: Pick<MasterProduct, "itemCode" | "productName" | "division" | "category" | "planningCategory" | "uom" | "segment" | "sourceProductId" | "isActive">[],
  incoming: Array<CatalogueProduct & { segment: string | null; planningCategory: string | null }>,
): SyncCounts {
  const existingByCode = new Map(existing.map((row) => [normalizeCatalogueCode(row.itemCode), row]));
  const bySegment: SyncCounts["bySegment"] = {};
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  const incomingCodes = new Set(incoming.map((product) => normalizeCatalogueCode(product.itemCode)));
  for (const product of incoming) {
    const bucket = product.segment ?? "unmapped";
    const stats = bySegment[bucket] ?? { fetched: 0, inserted: 0, updated: 0, unchanged: 0, deactivated: 0 };
    stats.fetched++;
    const old = existingByCode.get(normalizeCatalogueCode(product.itemCode));
    if (!old) {
      inserted++;
      stats.inserted++;
    } else {
      const changed = old.productName !== product.productName ||
        old.division !== product.division ||
        !sameNullable(old.category, product.category) ||
        !sameNullable(old.planningCategory, product.planningCategory) ||
        !sameNullable(old.uom, product.uom) ||
        !sameNullable(old.segment, product.segment) ||
        !sameNullable(old.sourceProductId, product.sourceProductId) ||
        !old.isActive;
      if (changed) {
        updated++;
        stats.updated++;
      } else {
        unchanged++;
        stats.unchanged++;
      }
    }
    bySegment[bucket] = stats;
  }
  for (const old of existing) {
    if (old.isActive && !incomingCodes.has(normalizeCatalogueCode(old.itemCode))) {
      const bucket = old.segment ?? "unmapped";
      const stats = bySegment[bucket] ?? { fetched: 0, inserted: 0, updated: 0, unchanged: 0, deactivated: 0 };
      stats.deactivated++;
      bySegment[bucket] = stats;
    }
  }
  return { productsFetched: incoming.length, inserted, updated, unchanged, deactivated: Object.values(bySegment).reduce((sum, row) => sum + row.deactivated, 0), bySegment };
}

export function buildCoverageReport(
  masterRows: Pick<MasterProduct, "itemCode" | "productName" | "division" | "category" | "planningCategory" | "segment">[],
  itemMasterRows: Array<{ itemCode: string; category: string; colour: string; segment: string }>,
): SegmentCoverage[] {
  return CATALOGUE_PLANNING_SEGMENTS.map((segment) => {
    const master = masterRows.filter((row) => row.segment === segment);
    const itemMaster = itemMasterRows.filter((row) => row.segment === segment);
    const masterByCode = new Map(master.map((row) => [normalizeCatalogueCode(row.itemCode), row]));
    const rosterByCode = new Map<string, typeof itemMaster[number]>();
    for (const row of itemMaster) {
      const code = normalizeCatalogueCode(row.itemCode);
      if (!rosterByCode.has(code)) rosterByCode.set(code, row);
    }
    const masterOnlyProducts = [...masterByCode.entries()]
      .filter(([code]) => !rosterByCode.has(code))
      .map(([, row]) => ({
        itemCode: row.itemCode,
        productName: row.productName,
        division: row.division,
        category: row.category,
        planningCategory: row.planningCategory,
      }))
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
    const itemMasterOnlyProducts = [...rosterByCode.entries()]
      .filter(([code]) => !masterByCode.has(code))
      .map(([, row]) => ({ itemCode: row.itemCode, category: row.category, colour: row.colour }))
      .sort((a, b) => a.itemCode.localeCompare(b.itemCode));
    return {
      segment,
      inBoth: masterByCode.size - masterOnlyProducts.length,
      masterOnly: masterOnlyProducts.length,
      itemMasterOnly: itemMasterOnlyProducts.length,
      masterOnlyProducts,
      itemMasterOnlyProducts,
    };
  });
}

type SyncableProduct = CatalogueProduct & { segment: string | null; planningCategory: string | null };

export async function syncMasterProducts(fetcher: typeof fetch = fetch): Promise<{
  summary: SyncCounts;
  categoryReport: CategoryReport;
}> {
  const products = await fetchAllCatalogueProducts(fetcher);
  const categoryReport = buildCatalogueCategoryReport(products);
  const mappings = await db
    .select()
    .from(masterProductCategoryMappingsTable)
    .where(and(eq(masterProductCategoryMappingsTable.source, MASTER_PRODUCT_SOURCE), eq(masterProductCategoryMappingsTable.isActive, true)));
  const mappingByKey = new Map(
    mappings.map((mapping) => [
      `${mapping.division}::${mapping.rawCategory}`,
      mapping,
    ]),
  );
  const incoming: SyncableProduct[] = products.map((product) => {
    const mapping = mappingByKey.get(`${product.division}::${product.category ?? ""}`);
    const segment = mapCatalogueDivision(product.division);
    return {
      ...product,
      segment,
      planningCategory: mapping?.planningCategory ?? null,
    };
  });
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(731_227)`);
    const existing = await tx
      .select()
      .from(masterProductsTable)
      .where(eq(masterProductsTable.source, MASTER_PRODUCT_SOURCE));
    const counts = calculateSyncCounts(existing, incoming);
    for (let offset = 0; offset < incoming.length; offset += 500) {
      const chunk = incoming.slice(offset, offset + 500).map((product) => ({
        source: MASTER_PRODUCT_SOURCE,
        sourceProductId: product.sourceProductId,
        itemCode: product.itemCode,
        productName: product.productName,
        division: product.division,
        segment: product.segment,
        category: product.category,
        planningCategory: product.planningCategory,
        uom: product.uom,
        isActive: true,
        syncedAt: now,
      }));
      await tx
        .insert(masterProductsTable)
        .values(chunk)
        .onConflictDoUpdate({
          target: [masterProductsTable.source, masterProductsTable.itemCode],
          set: {
            sourceProductId: sql`excluded.source_product_id`,
            productName: sql`excluded.product_name`,
            division: sql`excluded.division`,
            segment: sql`excluded.segment`,
            category: sql`excluded.category`,
            planningCategory: sql`excluded.planning_category`,
            uom: sql`excluded.uom`,
            isActive: true,
            syncedAt: now,
          },
        });
    }
    const codes = incoming.map((product) => product.itemCode);
    if (codes.length > 0) {
      const deactivated = await tx
        .update(masterProductsTable)
        .set({ isActive: false, syncedAt: now })
        .where(and(
          eq(masterProductsTable.source, MASTER_PRODUCT_SOURCE),
          eq(masterProductsTable.isActive, true),
          not(inArray(masterProductsTable.itemCode, codes)),
        ))
        .returning({ itemCode: masterProductsTable.itemCode, segment: masterProductsTable.segment });
      counts.deactivated = deactivated.length;
    }
    return counts;
  });
  return { summary: result, categoryReport };
}

export async function getMasterProductCoverage(): Promise<SegmentCoverage[]> {
  const [masterRows, itemMasterRows] = await Promise.all([
    db.select({
      itemCode: masterProductsTable.itemCode,
      productName: masterProductsTable.productName,
      division: masterProductsTable.division,
      category: masterProductsTable.category,
      planningCategory: masterProductsTable.planningCategory,
      segment: masterProductsTable.segment,
    }).from(masterProductsTable).where(and(
      eq(masterProductsTable.source, MASTER_PRODUCT_SOURCE),
      eq(masterProductsTable.isActive, true),
    )).orderBy(asc(masterProductsTable.itemCode)),
    db.select({
      itemCode: itemMasterTable.itemCode,
      category: itemMasterTable.category,
      colour: itemMasterTable.colour,
      segment: itemMasterTable.segment,
    }).from(itemMasterTable),
  ]);
  return buildCoverageReport(masterRows, itemMasterRows);
}

export async function getCategoryMappings() {
  return db.select().from(masterProductCategoryMappingsTable)
    .where(eq(masterProductCategoryMappingsTable.source, MASTER_PRODUCT_SOURCE))
    .orderBy(asc(masterProductCategoryMappingsTable.division), asc(masterProductCategoryMappingsTable.rawCategory));
}

export async function upsertCategoryMapping(input: {
  division: string;
  rawCategory: string | null;
  segment: CataloguePlanningSegment;
  planningCategory: string;
}) {
  return db.insert(masterProductCategoryMappingsTable).values({
    source: MASTER_PRODUCT_SOURCE,
    division: input.division,
    rawCategory: input.rawCategory ?? "",
    segment: input.segment,
    planningCategory: input.planningCategory,
    isActive: true,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: [
      masterProductCategoryMappingsTable.source,
      masterProductCategoryMappingsTable.division,
      masterProductCategoryMappingsTable.rawCategory,
    ],
    set: {
      segment: input.segment,
      planningCategory: input.planningCategory,
      isActive: true,
      updatedAt: new Date(),
    },
  }).returning();
}