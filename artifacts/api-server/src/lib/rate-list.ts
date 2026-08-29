import { and, desc, eq } from "drizzle-orm";
import {
  db,
  itemMasterTable,
  masterProductsTable,
  uploadedFilesTable,
  type ItemMaster,
  type MasterProduct,
} from "@workspace/db";

export const RATE_LIST_UPLOAD_KIND = "rate_list";
export const RATE_LIST_REQUIRED_HEADERS = ["source_tab", "code", "name", "range", "range_name"] as const;

export type RateListRow = {
  sourceTab: string;
  code: string;
  name: string;
  range: string;
  rangeName: string;
};

export type EffectivePtmtRosterItem = ItemMaster & {
  rosterSource: "workbook" | "rate-list" | "catalogue";
  rateListName?: string | null;
  rateListRange?: string | null;
};

export type RateListReconciliation = {
  rateListCodeCount: number;
  sourceCodeCount: number;
  matchedCodeCount: number;
  unmatchedCodeCount: number;
  matchedQuantity: number;
  unmatchedQuantity: number;
  unmatchedCodes: Array<{ code: string; quantity: number }>;
};

export type RateListCoverageReport = {
  rateListOnlyCodeCount: number;
  itemMasterOnlyCodeCount: number;
  bothSourceCodeCount: number;
  crossSegmentCodeCount: number;
  legacyReconciliation: RateListReconciliation | null;
  explainedExclusions: Array<{ code: string; quantity: number }>;
  remainingReviewCodes: Array<{ code: string; quantity: number }>;
};

const CODE_ALIASES = ["code", "Code", "Item Code", "Old Item Code", "Cat No", "Cat-No", "Item No."] as const;
const QTY_ALIASES = ["Qty", "Quantity", "Closing Stock", "C/Stock", "C Stock", "Net Stock"] as const;

function normaliseHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeRateListCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\.0$/, "");
}

function firstValue(row: Record<string, unknown>, aliases: readonly string[]): unknown {
  const keys = Object.keys(row);
  for (const alias of aliases) {
    const exact = row[alias];
    if (exact !== undefined && exact !== null && String(exact).trim() !== "") return exact;
    const key = keys.find((candidate) => normaliseHeader(candidate) === normaliseHeader(alias));
    const value = key == null ? undefined : row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return undefined;
}

function numericValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "").replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Validates and canonicalises parsed CSV rows. This is deliberately separate
 * from the HTTP upload handler so the same rules can be used in tests and
 * reconciliation reports.
 */
export function parseRateListRows(rows: Record<string, unknown>[]): RateListRow[] {
  const first = rows[0] ?? {};
  const headers = Object.keys(first);
  const missing = RATE_LIST_REQUIRED_HEADERS.filter((required) =>
    !headers.some((header) => normaliseHeader(header) === normaliseHeader(required)),
  );
  if (missing.length > 0) {
    throw new Error(`Rate-list CSV is missing required headers: ${missing.join(", ")}.`);
  }

  const parsed = rows.flatMap((row, index) => {
    const code = normalizeRateListCode(firstValue(row, ["code"]));
    if (!code) return [];
    const sourceTab = String(firstValue(row, ["source_tab"]) ?? "").trim();
    const name = String(firstValue(row, ["name"]) ?? "").trim();
    const range = String(firstValue(row, ["range"]) ?? "").trim();
    const rangeName = String(firstValue(row, ["range_name"]) ?? "").trim();
    // The supplied rate list contains legitimate code-only rows. Require the
    // identity and source tab, but preserve blank descriptive columns.
    if (!sourceTab) {
      throw new Error(`Rate-list row ${index + 2} is missing source_tab.`);
    }
    return [{ sourceTab, code, name, range, rangeName }];
  });
  if (parsed.length === 0) {
    throw new Error("Rate-list CSV contains the required headers but no recognised code rows.");
  }
  return parsed;
}

function rateListByCode(rows: RateListRow[]): Map<string, RateListRow> {
  const byCode = new Map<string, RateListRow>();
  for (const row of rows) {
    if (!byCode.has(row.code)) byCode.set(row.code, row);
  }
  return byCode;
}

/**
 * Only mappings with a stable business meaning are promoted. Everything else
 * remains explicitly Unclassified so a new rate-list naming convention
 * cannot silently invent a production multiplier.
 */
export function rateListPlanningCategory(row: RateListRow): string {
  const value = `${row.rangeName} ${row.name}`.toUpperCase();
  if (value.includes("BALL COCK")) return "Ball Cock";
  if (value.includes("CISTERN") || value.includes("SEAT COVER")) return "Cistern & Seat Cover";
  if (value.includes("CABINET")) return "Cabinet";
  if (value.includes("ACCESSOR") || value.includes("SPARE PART")) return "Accessorise";
  return "Unclassified";
}

function isReviewedCatalogueProduct(row: MasterProduct): boolean {
  return row.segment === "PTMT" && Boolean(row.planningCategory?.trim());
}

export function buildEffectivePtmtRoster(
  itemRows: ItemMaster[],
  rateRows: RateListRow[],
  catalogueRows: MasterProduct[] = [],
): EffectivePtmtRosterItem[] {
  const rateByCode = rateListByCode(rateRows);
  const represented = new Set<string>();
  const result: EffectivePtmtRosterItem[] = [];

  for (const row of itemRows) {
    if (row.segment !== "PTMT") continue;
    const code = normalizeRateListCode(row.itemCode);
    const rate = rateByCode.get(code);
    const category = row.classificationStatus === "classified" && row.category !== "Unclassified"
      ? row.category
      : rate ? rateListPlanningCategory(rate) : row.category;
    const status = row.classificationStatus === "classified" && row.category !== "Unclassified"
      ? row.classificationStatus
      : category === "Unclassified" ? "unclassified" : "classified";
    result.push({
      ...row,
      itemCode: code,
      category,
      classificationStatus: status,
      classificationSource: rate ? "rate-list" : (row.classificationSource ?? "workbook"),
      classificationNote: rate
        ? `Rate list: ${rate.rangeName}${category === "Unclassified" ? " (category review required)" : ""}`
        : row.classificationNote,
      rosterSource: rate ? "rate-list" : "workbook",
      rateListName: rate?.name ?? null,
      rateListRange: rate?.rangeName ?? null,
    });
    represented.add(code);
  }

  // A reviewed catalogue product is the third source in the precedence chain.
  // It is only promoted when it has an explicit planning category.
  for (const row of catalogueRows) {
    if (!isReviewedCatalogueProduct(row)) continue;
    const code = normalizeRateListCode(row.itemCode);
    if (represented.has(code)) continue;
    result.push({
      id: -1 * (result.length + 1),
      segment: "PTMT",
      category: row.planningCategory!.trim(),
      itemCode: code,
      colour: "",
      classificationStatus: "classified",
      classificationSource: "catalogue",
      classificationNote: "Reviewed catalogue product promoted into the governed PTMT roster.",
      rosterSource: "catalogue",
      rateListName: null,
      rateListRange: null,
    });
    represented.add(code);
  }

  // The rate list is authoritative for PTMT identities, including code-only
  // rows that have not appeared in the planning workbook yet.
  for (const row of rateByCode.values()) {
    if (represented.has(row.code)) continue;
    result.push({
      id: -1 * (result.length + 1),
      segment: "PTMT",
      category: rateListPlanningCategory(row),
      itemCode: row.code,
      colour: "",
      classificationStatus: rateListPlanningCategory(row) === "Unclassified" ? "unclassified" : "classified",
      classificationSource: "rate-list",
      classificationNote: `Rate list: ${row.rangeName}${rateListPlanningCategory(row) === "Unclassified" ? " (category review required)" : ""}`,
      rosterSource: "rate-list",
      rateListName: row.name,
      rateListRange: row.rangeName,
    });
    represented.add(row.code);
  }

  return result.sort((a, b) => a.itemCode.localeCompare(b.itemCode) || a.colour.localeCompare(b.colour));
}

function buildCodeReconciliation(
  acceptedCodes: Set<string>,
  sourceRows: Record<string, unknown>[],
): RateListReconciliation {
  const quantities = new Map<string, number>();
  for (const row of sourceRows) {
    const code = normalizeRateListCode(firstValue(row, CODE_ALIASES));
    if (!code) continue;
    const quantity = numericValue(firstValue(row, QTY_ALIASES));
    quantities.set(code, (quantities.get(code) ?? 0) + quantity);
  }
  let matchedQuantity = 0;
  let unmatchedQuantity = 0;
  const unmatchedCodes: Array<{ code: string; quantity: number }> = [];
  for (const [code, quantity] of quantities) {
    if (acceptedCodes.has(code)) matchedQuantity += quantity;
    else {
      unmatchedQuantity += quantity;
      if (quantity !== 0) unmatchedCodes.push({ code, quantity: Math.round(quantity) });
    }
  }
  unmatchedCodes.sort((a, b) => b.quantity - a.quantity || a.code.localeCompare(b.code));
  return {
    rateListCodeCount: acceptedCodes.size,
    sourceCodeCount: quantities.size,
    matchedCodeCount: [...quantities.keys()].filter((code) => acceptedCodes.has(code)).length,
    unmatchedCodeCount: unmatchedCodes.length,
    matchedQuantity: Math.round(matchedQuantity),
    unmatchedQuantity: Math.round(unmatchedQuantity),
    unmatchedCodes,
  };
}

export function buildRateListReconciliation(
  rateRows: RateListRow[],
  sourceRows: Record<string, unknown>[],
): RateListReconciliation {
  return buildCodeReconciliation(new Set(rateRows.map((row) => row.code)), sourceRows);
}

export async function getEffectivePtmtRoster(): Promise<EffectivePtmtRosterItem[]> {
  const [itemRows, rateUpload, catalogueRows] = await Promise.all([
    db.select().from(itemMasterTable).where(eq(itemMasterTable.segment, "PTMT")),
    db.select({ rows: uploadedFilesTable.rows }).from(uploadedFilesTable)
      .where(eq(uploadedFilesTable.kind, RATE_LIST_UPLOAD_KIND))
      .orderBy(desc(uploadedFilesTable.uploadedAt)).limit(1),
    db.select().from(masterProductsTable).where(and(
      eq(masterProductsTable.segment, "PTMT"),
      eq(masterProductsTable.isActive, true),
    )),
  ]);
  const rawRateRows = (rateUpload[0]?.rows ?? []) as Record<string, unknown>[];
  const rateRows = rawRateRows.length > 0 ? parseRateListRows(rawRateRows) : [];
  return buildEffectivePtmtRoster(itemRows, rateRows, catalogueRows);
}

export async function getRateListReport() {
  const [rateUpload, stockUploads, itemRows] = await Promise.all([
    db.select({
      id: uploadedFilesTable.id,
      filename: uploadedFilesTable.filename,
      rowCount: uploadedFilesTable.rowCount,
      uploadedAt: uploadedFilesTable.uploadedAt,
      rows: uploadedFilesTable.rows,
    }).from(uploadedFilesTable)
      .where(eq(uploadedFilesTable.kind, RATE_LIST_UPLOAD_KIND))
      .orderBy(desc(uploadedFilesTable.uploadedAt)).limit(1),
    db.select({
      id: uploadedFilesTable.id,
      filename: uploadedFilesTable.filename,
      rowCount: uploadedFilesTable.rowCount,
      uploadedAt: uploadedFilesTable.uploadedAt,
      rows: uploadedFilesTable.rows,
    }).from(uploadedFilesTable)
      .where(eq(uploadedFilesTable.kind, "current_stock"))
      .orderBy(desc(uploadedFilesTable.uploadedAt)),
    db.select({
      itemCode: itemMasterTable.itemCode,
      segment: itemMasterTable.segment,
    }).from(itemMasterTable),
  ]);
  const latestRate = rateUpload[0];
  const rateRows = latestRate ? parseRateListRows(latestRate.rows as Record<string, unknown>[]) : [];
  const julyStock = stockUploads.find((upload) => /july/i.test(upload.filename));
  const sourceRows = julyStock ? julyStock.rows as Record<string, unknown>[] : [];
  const rateCodes = new Set(rateRows.map((row) => row.code));
  const ptmtItemCodes = new Set(
    itemRows
      .filter((row) => row.segment === "PTMT")
      .map((row) => normalizeRateListCode(row.itemCode)),
  );
  const allItemSegments = new Map<string, Set<string>>();
  for (const row of itemRows) {
    const code = normalizeRateListCode(row.itemCode);
    const segments = allItemSegments.get(code) ?? new Set<string>();
    segments.add(row.segment);
    allItemSegments.set(code, segments);
  }
  const legacyReconciliation = julyStock
    ? buildCodeReconciliation(ptmtItemCodes, sourceRows)
    : null;
  const reconciliation = julyStock
    ? buildCodeReconciliation(rateCodes, sourceRows)
    : null;
  const explainedExclusions = reconciliation && legacyReconciliation
    ? legacyReconciliation.unmatchedCodes
      .filter(({ code }) => rateCodes.has(code))
    : [];
  return {
    source: latestRate ? {
      id: latestRate.id,
      filename: latestRate.filename,
      rowCount: latestRate.rowCount,
      uploadedAt: latestRate.uploadedAt,
      distinctCodeCount: new Set(rateRows.map((row) => row.code)).size,
    } : null,
    julySource: julyStock ? {
      id: julyStock.id,
      filename: julyStock.filename,
      rowCount: julyStock.rowCount,
      uploadedAt: julyStock.uploadedAt,
    } : null,
    reconciliation,
    coverage: latestRate ? {
      rateListOnlyCodeCount: [...rateCodes].filter((code) => !ptmtItemCodes.has(code)).length,
      itemMasterOnlyCodeCount: [...ptmtItemCodes].filter((code) => !rateCodes.has(code)).length,
      bothSourceCodeCount: [...rateCodes].filter((code) => ptmtItemCodes.has(code)).length,
      crossSegmentCodeCount: [...rateCodes].filter((code) =>
        [...(allItemSegments.get(code) ?? [])].some((segment) => segment !== "PTMT"),
      ).length,
      legacyReconciliation,
      explainedExclusions,
      remainingReviewCodes: reconciliation?.unmatchedCodes ?? [],
    } satisfies RateListCoverageReport : null,
  };
}