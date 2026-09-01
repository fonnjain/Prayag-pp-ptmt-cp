import * as crypto from "node:crypto";
import * as XLSX from "xlsx";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  mrpControlRowsTable,
  mrpControlSourcesTable,
  mrpSeriesValuesTable,
  uploadedFilesTable,
  itemMasterTable,
  bufferCategoriesTable,
} from "@workspace/db";
import { normalizeCatalogueCode, mapCatalogueDivision } from "./master-products";
import { parseRateListRows, rateListPlanningCategory, RATE_LIST_UPLOAD_KIND } from "./rate-list";
import {
  deriveMrpPlanningCategory,
  getMrpSeriesCrosswalkDecision,
  normalizeMrpSeries,
  resolveMrpClassification,
  type MrpClassificationRow,
} from "./mrp-classification";

export { deriveMrpPlanningCategory } from "./mrp-classification";

export const MRP_SOURCE_KIND = "mrp-authoritative";
const OPEN_SOURCE_QUESTION_CODES = [
  "324-K", "323-K", "PH-01", "PH-02",
  "PTA-18", "PTA-78", "PTA-15", "PTA-84", "PTA-50", "PTA-12", "PTA-3",
];
const PRODUCT_REQUIRED_HEADERS = ["item_code", "division", "series", "product_name", "mrp", "effective_date"];
const COLOUR_PRICE_HEADERS = ["mrp_ivory", "mrp_white_with_jet", "mrp_pink_green_blue"];
const UPSTREAM_DISCONTINUED_API_COVERAGE = {
  authoritativeFileRows: 233,
  apiDiscontinuedFromRows: 18,
  apiInvisibleAlreadyEffectiveRows: 215,
  authoritativeSource: "MRP file",
} as const;

export type MrpImportRow = {
  rowType: "product" | "discontinued";
  sourceRow: number;
  itemCode: string;
  division: string;
  series: string;
  productName: string | null;
  size: string | null;
  mrp: string | null;
  effectiveDate: string | null;
  previousMrp: string | null;
  colourPrices: Record<string, number | null>;
  discontinued: boolean;
  discontinuedFrom: string | null;
  segment: "PTMT" | "Plumbing" | "CP" | null;
  planningCategory: string | null;
  classificationStatus: "resolved" | "hold";
  isLoadable: boolean;
  raw: Record<string, unknown>;
};

export type MrpImportResult = {
  sourceId: number;
  sourceFilename: string;
  sourceSha256: string;
  productRowCount: number;
  discontinuedRowCount: number;
  excludedRowCount: number;
  seriesValueCount: number;
  planningApproved: false;
  holdReason: string;
};

export type MrpSeriesReviewRow = {
  series: string;
  category: string | null;
  status: "applied" | "pending_review" | "existing_rule" | "held";
  crosswalkStatus: "applied" | "pending_review" | "unmapped";
  effectiveStatus: "classified" | "unclassified" | "mixed";
  effectiveCategories: string[];
  codeCount: number;
  julyDemandQuantity: number;
  sampleCodes: string | null;
};

function normalizeHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
}

function asText(value: unknown): string | null {
  if (value == null || String(value).trim() === "") return null;
  return String(value).trim();
}

function asDate(value: unknown): string | null {
  if (value == null || String(value).trim() === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const raw = String(value).trim();
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString().slice(0, 10);
}

function asMoney(value: unknown): string | null {
  if (value == null || String(value).trim() === "") return null;
  const numeric = Number(String(value).replace(/,/g, "").trim());
  if (!Number.isFinite(numeric)) throw new Error(`Invalid MRP value "${String(value)}".`);
  return numeric.toFixed(2);
}

function asPrice(value: unknown): number | null {
  const money = asMoney(value);
  return money == null ? null : Number(money);
}

function parseCsv(buffer: Buffer): Record<string, string>[] {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== "");
  if (lines.length === 0) return [];
  const parseLine = (line: string): string[] => {
    const values: string[] = [];
    let value = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        if (quoted && line[i + 1] === '"') { value += '"'; i++; } else quoted = !quoted;
      } else if (char === "," && !quoted) { values.push(value.trim()); value = ""; } else value += char;
    }
    values.push(value.trim());
    return values;
  };
  const headers = parseLine(lines[0]).map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const values = parseLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]));
  });
}

function rowsFromSheet(workbook: XLSX.WorkBook, sheetName: string): Record<string, unknown>[] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error(`Authoritative MRP workbook is missing the "${sheetName}" sheet.`);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null, raw: false });
  if (rows.length === 0) throw new Error(`Authoritative MRP workbook sheet "${sheetName}" is empty.`);
  return rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])));
}


function parseProductRows(rows: Record<string, unknown>[], rowType: "product" | "discontinued", excludedCodes: Set<string>): MrpImportRow[] {
  return rows.map((row, index) => {
    const itemCode = normalizeCatalogueCode(row.item_code);
    if (!itemCode) throw new Error(`${rowType} row ${index + 2} has no item_code.`);
    const division = String(row.division ?? "").trim();
    const series = String(row.series ?? "").trim();
    if (rowType === "product" && (!division || !series || !row.mrp || !row.effective_date)) {
      throw new Error(`Product row ${index + 2} is missing division, series, mrp, or effective_date.`);
    }
    const derived = deriveMrpPlanningCategory(itemCode, division, series);
    return {
      rowType,
      sourceRow: index + 2,
      itemCode,
      division,
      series,
      productName: asText(row.product_name),
      size: asText(row.size),
      mrp: asMoney(row.mrp),
      effectiveDate: asDate(row.effective_date),
      previousMrp: asMoney(row.previous_mrp),
      colourPrices: Object.fromEntries(COLOUR_PRICE_HEADERS.map((key) => [key, asPrice(row[key])])),
      discontinued: rowType === "discontinued",
      discontinuedFrom: rowType === "discontinued" ? asDate(row.discontinued_from) : null,
      segment: mapCatalogueDivision(division),
      planningCategory: derived.category,
      classificationStatus: derived.status,
      isLoadable: !excludedCodes.has(itemCode),
      raw: row,
    };
  });
}

export function parseMrpSourceBuffers(
  workbookBuffer: Buffer,
  discontinuedCsvBuffer?: Buffer,
  seriesCsvBuffer?: Buffer,
  sourceFilename = "authoritative-mrp.xlsx",
): {
  filename: string;
  sha256: string;
  products: MrpImportRow[];
  discontinued: MrpImportRow[];
  excluded: Record<string, unknown>[];
  seriesValues: Array<{ series: string; codeCount: number; sampleCodes: string }>;
} {
  const workbook = XLSX.read(workbookBuffer, { type: "buffer", raw: false });
  const productRows = rowsFromSheet(workbook, "products");
  const required = PRODUCT_REQUIRED_HEADERS.filter((header) => !Object.prototype.hasOwnProperty.call(productRows[0], header));
  if (required.length) throw new Error(`Authoritative MRP products sheet is missing columns: ${required.join(", ")}.`);
  const excludedRows = rowsFromSheet(workbook, "excluded_do_not_load");
  const excludedCodes = new Set(
    excludedRows
      .filter((row) => /invalid input/i.test(String(row.status_note ?? "")) || /invalid input/i.test(String(row["why excluded"] ?? "")))
      .map((row) => normalizeCatalogueCode(row.item_code)),
  );
  const discontinuedRows = discontinuedCsvBuffer
    ? parseCsv(discontinuedCsvBuffer)
    : rowsFromSheet(workbook, "discontinued");
  const products = parseProductRows(productRows, "product", excludedCodes);
  const discontinued = parseProductRows(discontinuedRows, "discontinued", excludedCodes);
  const seriesRows = seriesCsvBuffer ? parseCsv(seriesCsvBuffer) : [];
  const seriesValues = seriesRows.length
    ? seriesRows.map((row) => ({
      series: String(row.series ?? "").trim(),
      codeCount: Number(row.code_count ?? 0) || 0,
      sampleCodes: String(row.sample_codes ?? "").trim(),
    })).filter((row) => row.series)
    : [...new Map(products.filter((row) => row.segment === "PTMT").map((row) => [row.series, row])).values()]
      .map((row) => ({ series: row.series, codeCount: products.filter((item) => item.series === row.series).length, sampleCodes: "" }));
  return {
    filename: sourceFilename,
    sha256: crypto.createHash("sha256").update(workbookBuffer).digest("hex"),
    products,
    discontinued,
    excluded: excludedRows,
    seriesValues,
  };
}

export async function importMrpSources(
  workbookBuffer: Buffer,
  options: { sourceFilename?: string; discontinuedCsvBuffer?: Buffer; seriesCsvBuffer?: Buffer } = {},
): Promise<MrpImportResult> {
  const parsed = parseMrpSourceBuffers(workbookBuffer, options.discontinuedCsvBuffer, options.seriesCsvBuffer, options.sourceFilename);
  const existing = await db.select().from(mrpControlSourcesTable).where(eq(mrpControlSourcesTable.sourceSha256, parsed.sha256)).limit(1);
  if (existing[0]) {
    // Re-importing an unchanged source is idempotent, but re-derives the
    // review fields so a corrected explicit mapping is reflected immediately.
    await db.transaction(async (tx) => {
      for (const row of [...parsed.products, ...parsed.discontinued]) {
        await tx.update(mrpControlRowsTable).set({
          planningCategory: row.planningCategory,
          classificationStatus: row.classificationStatus,
          segment: row.segment,
          isLoadable: row.isLoadable,
        }).where(and(
          eq(mrpControlRowsTable.sourceId, existing[0].id),
          eq(mrpControlRowsTable.rowType, row.rowType),
          eq(mrpControlRowsTable.sourceRow, row.sourceRow),
        ));
      }
    });
    return {
      sourceId: existing[0].id,
      sourceFilename: existing[0].sourceFilename,
      sourceSha256: existing[0].sourceSha256,
      productRowCount: existing[0].productRowCount,
      discontinuedRowCount: existing[0].discontinuedRowCount,
      excludedRowCount: existing[0].excludedRowCount,
      seriesValueCount: existing[0].seriesValueCount,
      planningApproved: false,
      holdReason: existing[0].holdReason ?? "Planning approval is required.",
    };
  }
  const holdReason = "PTMT planning is held until MRP-derived classifications and the P.V.C. Connections capacity treatment are approved.";
  return db.transaction(async (tx) => {
    const [source] = await tx.insert(mrpControlSourcesTable).values({
      sourceFilename: parsed.filename,
      sourceSha256: parsed.sha256,
      productRowCount: parsed.products.length,
      discontinuedRowCount: parsed.discontinued.length,
      excludedRowCount: parsed.excluded.length,
      seriesValueCount: parsed.seriesValues.length,
      planningApproved: false,
      holdReason,
      validationStatus: "valid",
    }).returning();
    const allRows = [...parsed.products, ...parsed.discontinued];
    for (let offset = 0; offset < allRows.length; offset += 500) {
      await tx.insert(mrpControlRowsTable).values(allRows.slice(offset, offset + 500).map((row) => ({
        sourceId: source.id,
        rowType: row.rowType,
        sourceRow: row.sourceRow,
        itemCode: row.itemCode,
        division: row.division,
        series: row.series,
        productName: row.productName,
        size: row.size,
        mrp: row.mrp,
        effectiveDate: row.effectiveDate,
        previousMrp: row.previousMrp,
        colourPrices: row.colourPrices,
        discontinued: row.discontinued,
        discontinuedFrom: row.discontinuedFrom,
        segment: row.segment,
        planningCategory: row.planningCategory,
        classificationStatus: row.classificationStatus,
        isLoadable: row.isLoadable,
        raw: row.raw,
      })));
    }
    if (parsed.seriesValues.length) await tx.insert(mrpSeriesValuesTable).values(parsed.seriesValues.map((row) => ({ sourceId: source.id, ...row })));
    return {
      sourceId: source.id,
      sourceFilename: parsed.filename,
      sourceSha256: parsed.sha256,
      productRowCount: parsed.products.length,
      discontinuedRowCount: parsed.discontinued.length,
      excludedRowCount: parsed.excluded.length,
      seriesValueCount: parsed.seriesValues.length,
      planningApproved: false as const,
      holdReason,
    };
  });
}

function quantityByCode(rows: Record<string, unknown>[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const row of rows) {
    const code = normalizeCatalogueCode(row["Item Code"] ?? row.item_code ?? row["Old ERP Code"]);
    if (!code) continue;
    const quantity = Number(String(row.Qty ?? row["Qty."] ?? row.Quantity ?? row["Balance Qty"] ?? row["Bal. Qty"] ?? 0).replace(/,/g, "")) || 0;
    result.set(code, (result.get(code) ?? 0) + quantity);
  }
  return result;
}

export function buildMrpSeriesReview(
  seriesValues: Array<{ series: string; codeCount: number; sampleCodes: string | null }>,
  mrpProductRows: Array<Pick<MrpClassificationRow, "itemCode" | "division" | "series">>,
  july: ReadonlyMap<string, number>,
  modelCategories: ReadonlySet<string>,
): MrpSeriesReviewRow[] {
  const rowsBySeries = new Map<string, typeof mrpProductRows>();
  for (const row of mrpProductRows) {
    const key = normalizeMrpSeries(row.series);
    const rows = rowsBySeries.get(key) ?? [];
    rows.push(row);
    rowsBySeries.set(key, rows);
  }
  return seriesValues.map((seriesValue) => {
    const decision = getMrpSeriesCrosswalkDecision(seriesValue.series);
    const seriesRows = rowsBySeries.get(normalizeMrpSeries(seriesValue.series)) ?? [];
    const rowsByCode = new Map(seriesRows.map((row) => [row.itemCode, row]));
    const effective = [...rowsByCode.values()].map((row) =>
      resolveMrpClassification(row, "Unclassified", modelCategories),
    );
    const effectiveCategories = [...new Set(effective.map((row) => row.category))].sort();
    const classifiedCount = effective.filter((row) => row.status === "classified").length;
    const effectiveStatus = effective.length > 0 && classifiedCount === effective.length
      ? "classified"
      : classifiedCount === 0
        ? "unclassified"
        : "mixed";
    const status = decision.status === "applied"
      ? "applied"
      : decision.status === "pending_review"
        ? "pending_review"
        : effectiveStatus === "classified"
          ? "existing_rule"
          : "held";
    const julyDemandQuantity = [...rowsByCode.keys()].reduce(
      (sum, code) => sum + (july.get(code) ?? 0),
      0,
    );
    return {
      series: seriesValue.series,
      category: decision.category ?? (effectiveCategories.length === 1 ? effectiveCategories[0] : null),
      status,
      crosswalkStatus: decision.status,
      effectiveStatus,
      effectiveCategories,
      codeCount: seriesValue.codeCount || rowsByCode.size,
      julyDemandQuantity: Math.round(julyDemandQuantity),
      sampleCodes: seriesValue.sampleCodes,
    };
  });
}

export async function getMrpReport() {
  const [source] = await db.select().from(mrpControlSourcesTable).orderBy(desc(mrpControlSourcesTable.importedAt)).limit(1);
  if (!source) return { source: null, summary: null };
  const [rows, seriesValues, rateUploads, pendingUploads, itemMasterRows, bufferRows] = await Promise.all([
    db.select().from(mrpControlRowsTable).where(eq(mrpControlRowsTable.sourceId, source.id)),
    db.select().from(mrpSeriesValuesTable).where(eq(mrpSeriesValuesTable.sourceId, source.id)),
    db.select({ rows: uploadedFilesTable.rows }).from(uploadedFilesTable).where(eq(uploadedFilesTable.kind, RATE_LIST_UPLOAD_KIND)).orderBy(desc(uploadedFilesTable.uploadedAt)).limit(1),
    db.select({ filename: uploadedFilesTable.filename, rows: uploadedFilesTable.rows }).from(uploadedFilesTable).where(eq(uploadedFilesTable.kind, "last_month_pending")).orderBy(desc(uploadedFilesTable.uploadedAt)),
    db.select().from(itemMasterTable).where(eq(itemMasterTable.segment, "PTMT")),
    db.select({
      name: bufferCategoriesTable.name,
      multiplier: bufferCategoriesTable.multiplier,
    }).from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, "PTMT")),
  ]);
  const segmentSummary = ["PTMT", "Plumbing", "CP"].map((segment) => {
    const segmentRows = rows.filter((row) => row.segment === segment);
    return {
      segment,
      rows: segmentRows.length,
      discontinued: segmentRows.filter((row) => row.discontinued).length,
      loadable: segmentRows.filter((row) => row.isLoadable).length,
      heldClassifications: segmentRows.filter((row) => row.classificationStatus === "hold").length,
    };
  });
  const rateRows = rateUploads[0] ? parseRateListRows(rateUploads[0].rows as Record<string, unknown>[]) : [];
  const rateByCode = new Map(rateRows.map((row) => [row.code, rateListPlanningCategory(row)]));
  const disagreements = rows
    .filter((row) => row.segment === "PTMT" && row.rowType === "product" && row.planningCategory && rateByCode.has(row.itemCode))
    .filter((row) => rateByCode.get(row.itemCode) !== row.planningCategory)
    .map((row) => ({ itemCode: row.itemCode, series: row.series, mrpCategory: row.planningCategory, rateListCategory: rateByCode.get(row.itemCode) }));
  const julyUpload = pendingUploads.find((upload) => /july/i.test(upload.filename));
  const july = julyUpload ? quantityByCode(julyUpload.rows as Record<string, unknown>[]) : new Map<string, number>();
  const mrpCodes = new Set(rows.filter((row) => row.segment === "PTMT" && row.isLoadable).map((row) => row.itemCode));
  const combinedCodes = new Set([...mrpCodes, ...rateByCode.keys()]);
  const historicalCodes = new Set(itemMasterRows.map((row) => normalizeCatalogueCode(row.itemCode)));
  let matchedQuantity = 0;
  let historicalMatchedQuantity = 0;
  const historicalUnmatchedCodes: Array<{ code: string; quantity: number }> = [];
  const unmatchedCodes: Array<{ code: string; quantity: number }> = [];
  for (const [code, quantity] of july) {
    if (historicalCodes.has(code)) historicalMatchedQuantity += quantity;
    else if (quantity !== 0) historicalUnmatchedCodes.push({ code, quantity: Math.round(quantity) });
    if (combinedCodes.has(code)) matchedQuantity += quantity;
    else if (quantity !== 0) unmatchedCodes.push({ code, quantity: Math.round(quantity) });
  }
  unmatchedCodes.sort((a, b) => b.quantity - a.quantity || a.code.localeCompare(b.code));
  historicalUnmatchedCodes.sort((a, b) => b.quantity - a.quantity || a.code.localeCompare(b.code));
  const sourceQuantity = [...july.values()].reduce((sum, value) => sum + value, 0);
  const modelCategories = new Set(bufferRows.map((row) => row.name));
  const mrpProductRows = rows.filter((row) =>
    row.segment === "PTMT" && row.rowType === "product" && row.isLoadable,
  );
  const seriesReview = buildMrpSeriesReview(seriesValues, mrpProductRows, july, modelCategories);
  const mrpByCode = new Map(
    mrpProductRows
      .map((row) => [row.itemCode, row]),
  );
  const rateCategoryByCode = new Map(rateRows.map((row) => [row.code, rateListPlanningCategory(row)]));
  const categoryByCode = new Map<string, string>();
  for (const code of combinedCodes) {
    const classification = resolveMrpClassification(
      mrpByCode.get(code),
      rateCategoryByCode.get(code) ?? "Unclassified",
      modelCategories,
    );
    categoryByCode.set(code, classification.category);
  }
  const categoryCodes = new Map<string, Set<string>>();
  for (const [code, category] of categoryByCode) {
    const codes = categoryCodes.get(category) ?? new Set<string>();
    codes.add(code);
    categoryCodes.set(category, codes);
  }
  const categoryOrder = [
    "Cocks Standard",
    "Cocks Premium",
    "Faucets & Jetsprays & Shower",
    "Accessorise",
    "Ball Cock",
    "Cistern & Seat Cover",
    "Cabinet",
    "Unclassified",
    ...[...categoryCodes.keys()]
      .filter((category) => ![
        "Cocks Standard",
        "Cocks Premium",
        "Faucets & Jetsprays & Shower",
        "Accessorise",
        "Ball Cock",
        "Cistern & Seat Cover",
        "Cabinet",
        "Unclassified",
      ].includes(category))
      .sort(),
  ];
  const julyCategorySplit = categoryOrder.map((category) => {
    const codes = categoryCodes.get(category) ?? new Set<string>();
    return {
      category,
      codeCount: codes.size,
      julyDemandQuantity: Math.round([...codes].reduce((sum, code) => sum + (july.get(code) ?? 0), 0)),
      capacityStatus: category !== "Unclassified" && modelCategories.has(category) ? "configured" : "held",
      multiplier: category === "Unclassified" ? null : bufferRows.find((row) => row.name === category)?.multiplier ?? null,
    };
  });
  const pvcSourceCodeQuantities = [...categoryByCode.entries()]
    .filter(([, category]) => category === "P.V.C. Connections")
    .map(([code]) => ({ code, quantity: Math.round(july.get(code) ?? 0) }))
    .filter((entry) => entry.quantity > 0)
    .sort((a, b) => a.code.localeCompare(b.code));
  const pvcSourceQuantity = pvcSourceCodeQuantities.reduce((sum, entry) => sum + entry.quantity, 0);
  const pvcPreviouslyStatedQuantity = 46_467;
  const pvcDifference = pvcSourceQuantity - pvcPreviouslyStatedQuantity;
  return {
    source: {
      id: source.id,
      filename: source.sourceFilename,
      sha256: source.sourceSha256,
      importedAt: source.importedAt,
      productRowCount: source.productRowCount,
      discontinuedRowCount: source.discontinuedRowCount,
      excludedRowCount: source.excludedRowCount,
      seriesValueCount: source.seriesValueCount,
      planningApproved: source.planningApproved,
      validationStatus: source.validationStatus,
      holdReason: source.holdReason,
    },
    summary: {
      workbookProducts: rows.filter((row) => row.rowType === "product").length,
      discontinued: rows.filter((row) => row.discontinued).length,
      excluded: source.excludedRowCount,
      segmentSummary,
      disagreements,
      disagreementCount: disagreements.length,
      seriesValues,
      upstreamDiscontinuedApiCoverage: UPSTREAM_DISCONTINUED_API_COVERAGE,
      july: julyUpload ? {
        filename: julyUpload.filename,
        sourceQuantity: Math.round(sourceQuantity),
        matchedQuantity: Math.round(matchedQuantity),
        unmatchedQuantity: Math.round(sourceQuantity - matchedQuantity),
        unmatchedCodes,
        historicalRoster: {
          matchedQuantity: Math.round(historicalMatchedQuantity),
          unmatchedQuantity: Math.round(sourceQuantity - historicalMatchedQuantity),
          unmatchedCodes: historicalUnmatchedCodes,
        },
         combinedCodeCount: combinedCodes.size,
         categorySplit: julyCategorySplit,
         pvcReconciliation: {
           previouslyStatedQuantity: pvcPreviouslyStatedQuantity,
           mrpGovernedQuantity: pvcSourceQuantity,
           differenceQuantity: pvcDifference,
           sourceCodeQuantities: pvcSourceCodeQuantities,
         },
      } : null,
      openSourceQuestionCodes: OPEN_SOURCE_QUESTION_CODES,
       seriesCrosswalk: {
         applied: seriesReview.filter((row) => row.status === "applied"),
         pendingReview: seriesReview.filter((row) => row.status === "pending_review"),
         existingRule: seriesReview.filter((row) => row.status === "existing_rule"),
         held: seriesReview.filter((row) => row.status === "held"),
         all: seriesReview,
       },
      readyToSendQuestion: `Please confirm the authoritative source, planning category, and capacity treatment for these 11 July-demand codes absent from both the MRP and rate list: ${OPEN_SOURCE_QUESTION_CODES.join(", ")}. Also confirm the MRP capacity treatment for P.V.C. Connections, Waste Pipes, Collapsible Waste Pipes, Special Cock, and Showers Sets before PTMT planning is released.`,
    },
  };
}

export async function getMrpPlanningGate(): Promise<{ held: boolean; reason?: string; sourceId?: number }> {
  const [source] = await db.select({
    id: mrpControlSourcesTable.id,
    planningApproved: mrpControlSourcesTable.planningApproved,
    holdReason: mrpControlSourcesTable.holdReason,
  }).from(mrpControlSourcesTable).orderBy(desc(mrpControlSourcesTable.importedAt)).limit(1);
  if (!source || source.planningApproved) return { held: false };
  return { held: true, reason: source.holdReason ?? "Authoritative MRP controls require approval before PTMT planning.", sourceId: source.id };
}