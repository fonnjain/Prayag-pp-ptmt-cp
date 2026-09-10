import { and, desc, eq } from "drizzle-orm";
import {
  db,
  bufferCategoriesTable,
  itemMasterTable,
  masterProductsTable,
  mrpControlRowsTable,
  mrpControlSourcesTable,
  uploadedFilesTable,
  type ItemMaster,
  type MasterProduct,
} from "@workspace/db";
import {
  deriveMrpPlanningCategory,
  normalizeMrpSeries,
  resolveMrpClassification,
  type MrpClassificationRow,
} from "./mrp-classification";
import { getPrayagCategoryEvidence, type PrayagPlanningCategory } from "./prayag-category-evidence";
import { fetchPtmtReportRoster, fetchRateListSheetRows, normalizeCodeStrict, type PtmtReportRosterRow } from "./sheets";
import { logger } from "./logger";

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
  rosterSource: "workbook" | "rate-list" | "catalogue" | "mrp";
  rateListName?: string | null;
  rateListRange?: string | null;
  mrpSeries?: string | null;
  planningCategorySource?: "prayag-planning-tabs" | "mrp" | "rate-list" | "catalogue" | "workbook";
};

export function buildPtmtReportRoster(rows: PtmtReportRosterRow[]): EffectivePtmtRosterItem[] {
  return rows.map((row, index) => ({
    id: -1 * (index + 1),
    segment: "PTMT",
    category: row.category,
    itemCode: normalizeRateListCode(row.itemCode),
    colour: row.colour.trim(),
    classificationStatus: "classified",
    classificationSource: "workbook",
    classificationNote: `PTMT ${row.report} roster row; REPORT tabs are authoritative at code/colour grain.`,
    rosterSource: "workbook",
    rateListName: null,
    rateListRange: null,
    mrpSeries: null,
    planningCategorySource: "workbook",
  })) as EffectivePtmtRosterItem[];
}

export type PtmtRosterRawSpellingCollisionEntry = {
  rawCode: string;
  colour: string;
  category: string;
  entryPath: EffectivePtmtRosterItem["rosterSource"];
  demand: number | null;
};

export type PtmtRosterRawSpellingCollision = {
  strictKey: string;
  entries: PtmtRosterRawSpellingCollisionEntry[];
};

export type RateListReconciliation = {
  rateListCodeCount: number;
  rosterCodeCount: number;
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

export type PlumbingRosterPlanningRow = {
  itemCode: string;
  category: string;
};

export type PlumbingRosterMrpRow = MrpClassificationRow & {
  rowType?: "product" | "discontinued";
  discontinued?: boolean;
  productName?: string | null;
};

export type PlumbingRosterCoverageEntry = {
  code: string;
  planningCategory: string | null;
  effectiveCategory: string | null;
  categorySource: "prayag-planning-tabs" | "mrp" | "unclassified";
  mrpSeries: string | null;
  mrpDerivedCategory: string | null;
  mrpDivision: string | null;
  mrpStatus: "active" | "discontinued" | null;
  productName: string | null;
};

export type PlumbingRosterCoverageReport = {
  rosterCodeCount: number;
  mrpCodeCount: number;
  bothCodeCount: number;
  mrpOnlyCodeCount: number;
  rosterOnlyCodeCount: number;
  both: PlumbingRosterCoverageEntry[];
  mrpOnly: PlumbingRosterCoverageEntry[];
  rosterOnly: PlumbingRosterCoverageEntry[];
};

export type RateListRangeAudit = {
  rangeName: string;
  category: string;
  codeCount: number;
};

export type RateListCategorySplit = {
  category: string;
  codeCount: number;
  julySourceQuantity: number;
  multiplier: number | null;
};

export type RateListCategorySplitReport = {
  before: RateListCategorySplit[];
  after: RateListCategorySplit[];
};

const CODE_ALIASES = ["code", "Code", "Item Code", "Old Item Code", "Cat No", "Cat-No", "Item No."] as const;
const QTY_ALIASES = ["Qty", "Quantity", "Closing Stock", "C/Stock", "C Stock", "Net Stock"] as const;
const PTMT_CATEGORY_ORDER = [
  "Cocks Standard",
  "Cocks Premium",
  "Faucets & Jetsprays & Shower",
  "Accessorise",
  "Ball Cock",
  "Cistern & Seat Cover",
  "Cabinet",
  "P.V.C. Connections",
  "Waste Pipes",
  "Unclassified",
] as const;

function normaliseHeader(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function normalizeRateListCode(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\.0$/, "");
}

export function normalizeRateListRangeName(value: unknown): string {
  const normalized = String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  const formattingAliases: Record<string, string> = {
    "BLAZE (62)": "BLAZE 62",
    "CYGNUS(71)": "CYGNUS 71",
    "EVIAN (87)": "EVIAN 87",
    "LAGUNA(93)": "LAGUNA 93",
    "MARCUS(68)": "MARCUS 68",
    "POLO (60)": "POLO 60",
    "SAPPHIRE(68 BLACK)": "SAPPHIRE (68 BLACK)",
    "ZIRCON(71 ROSE GOLD)": "ZIRCON(71 ROSE GOLD)",
  };
  return formattingAliases[normalized] ?? normalized;
}

const PTMT_RANGE_CATEGORY_OVERRIDES: Readonly<Record<string, string>> = {
  "SINK COCK (132)": "Cocks Standard",
  "BIB COCK FANCY (123)": "Cocks Standard",
  "SINK COCK (133)": "Cocks Standard",
  "BIB COCK LONG BODY (124)": "Cocks Standard",
  "PILLAR COCK (130)": "Cocks Standard",
  "BIB COCK STANDARD (121)": "Cocks Standard",
  "PILLAR COCK (131)": "Cocks Standard",
  "BIB COCK STANDARD (120)": "Cocks Standard",
  "2 WAY BIB COCK (129)": "Cocks Standard",
  "BIB COCK STANDARD (125)": "Cocks Standard",
  "ANGLE COCK (144)": "Cocks Standard",
  "BIB COCK NOZZLE (127)": "Cocks Standard",
  "2 WAY ANGLE COCK (145)": "Cocks Standard",
  "BIB COCK (122)": "Cocks Standard",
  "SINK MIXER (134)": "Cocks Standard",
  "PUSH COCK": "Cocks Standard",
  "URINAL COCK": "Cocks Standard",
  "PILLAR COCK SWAN NECK (147)": "Cocks Premium",
  "WALL MIXER (1375)": "Cocks Premium",
  "WALL MIXER (135)": "Cocks Premium",
  "STOP COCK": "Cocks Premium",
  "CONCEALED STOP COCK": "Cocks Premium",
  "MUTE SERIES": "Cocks Premium",
  "OVER HEAD SHOWER": "Faucets & Jetsprays & Shower",
  "CENTER HOLE BASIN": "Faucets & Jetsprays & Shower",
  "SINGLE LEVER BASIN (400)": "Faucets & Jetsprays & Shower",
  "2 IN 1 FAUCET": "Faucets & Jetsprays & Shower",
  "WASHING MACHINE TAP": "Faucets & Jetsprays & Shower",
  "WASHING MACHINE": "Faucets & Jetsprays & Shower",
  "JET SPRAY": "Faucets & Jetsprays & Shower",
  "HAND SHOWER": "Faucets & Jetsprays & Shower",
  "HEALTH FAUCET": "Faucets & Jetsprays & Shower",
  "FLUSH VALVE": "Faucets & Jetsprays & Shower",
  // These range names have dedicated PTMT categories in the authoritative
  // workbook/report taxonomy; rate-list fallback must resolve the same way.
  "WASTE PIPE": "Waste Pipes",
  "CONNECTION": "P.V.C. Connections",
  "GRATING": "Accessorise",
  "LIQUID SOAP CONTAINER": "Accessorise",
  "WASTE COUPLING": "Accessorise",
  "SOAP DISH": "Accessorise",
  "TOWEL RING": "Accessorise",
  "TOWEL RAIL": "Accessorise",
  "TOWEL RACK": "Accessorise",
  "SHELF": "Accessorise",
  "BOTTLE TRAP": "Accessorise",
  "TOILET PAPER HOLDER": "Accessorise",
  "TOOTH BRUSH HOLDER": "Accessorise",
  "TANK NIPPLES": "Accessorise",
  "NIPPLE": "Accessorise",
  "FLANGE": "Accessorise",
  "LINE FILTER": "Accessorise",
  "END PLUG": "Accessorise",
  "SPINDLES SET": "Accessorise",
  "BALL COCK": "Ball Cock",
  "BALL COCK CHUTKI": "Ball Cock",
  "CISTERN": "Cistern & Seat Cover",
  "SEAT COVER": "Cistern & Seat Cover",
  "CISTERN ACCESSORIES": "Cistern & Seat Cover",
  "CABINET": "Cabinet",
};

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

/**
 * The live governed sheet is authoritative. The uploaded CSV remains a
 * deliberate recovery path for connector outages or a temporarily malformed
 * live sheet, so a planning run does not silently lose its roster.
 */
export async function loadRateListRows(): Promise<RateListRow[]> {
  try {
    const liveRows = await fetchRateListSheetRows();
    const parsed = parseRateListRows(liveRows);
    if (parsed.length > 0) return parsed;
  } catch (err) {
    logger.warn({ err: String(err) }, "Live PTMT rate list unavailable; falling back to uploaded CSV/source");
  }

  const [latest] = await db
    .select({ rows: uploadedFilesTable.rows })
    .from(uploadedFilesTable)
    .where(eq(uploadedFilesTable.kind, RATE_LIST_UPLOAD_KIND))
    .orderBy(desc(uploadedFilesTable.uploadedAt))
    .limit(1);
  return latest ? parseRateListRows(latest.rows as Record<string, unknown>[]) : [];
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
  const value = normalizeRateListRangeName(row.rangeName).toUpperCase();
  return PTMT_RANGE_CATEGORY_OVERRIDES[value] ?? "Unclassified";
}

function legacyRateListPlanningCategory(row: RateListRow): string {
  const value = normalizeRateListRangeName(row.rangeName).toUpperCase();
  if (value.includes("BALL COCK")) return "Ball Cock";
  if (value.includes("CISTERN") || value.includes("SEAT COVER")) return "Cistern & Seat Cover";
  if (value.includes("CABINET")) return "Cabinet";
  if (value.includes("ACCESSOR") || value.includes("SPARE PART")) return "Accessorise";
  return "Unclassified";
}

export function buildRateListRangeAudit(rateRows: RateListRow[]): RateListRangeAudit[] {
  const byRange = new Map<string, { category: string; codes: Set<string> }>();
  for (const row of rateRows) {
    const rangeName = normalizeRateListRangeName(row.rangeName);
    const current = byRange.get(rangeName) ?? {
      category: rateListPlanningCategory(row),
      codes: new Set<string>(),
    };
    current.codes.add(row.code);
    byRange.set(rangeName, current);
  }
  return [...byRange.entries()]
    .map(([rangeName, value]) => ({
      rangeName,
      category: value.category,
      codeCount: value.codes.size,
    }))
    .sort((a, b) => b.codeCount - a.codeCount || a.rangeName.localeCompare(b.rangeName));
}

function isReviewedCatalogueProduct(row: MasterProduct): boolean {
  return row.segment === "PTMT" && Boolean(row.planningCategory?.trim());
}

/**
 * H2r guard: strict-code collisions are only noteworthy when they contain
 * distinct raw code spellings. Multiple colours of one raw code are valid
 * roster variants and must not be reported.
 *
 * Demand is deliberately supplied by the caller rather than read here. Roster
 * construction is also used before a new plan exists, so it has no legitimate
 * #2419 context to query. A caller with a frozen plan can provide demand keyed
 * by ptmtRosterDemandKey without coupling roster identity to a historical run.
 */
export function ptmtRosterDemandKey(itemCode: string, colour: string): string {
  return `${itemCode}\u0000${colour}`;
}

export function findPtmtRawSpellingCollisions(
  roster: EffectivePtmtRosterItem[],
  demandByItem?: ReadonlyMap<string, number>,
): PtmtRosterRawSpellingCollision[] {
  const byStrictKey = new Map<string, EffectivePtmtRosterItem[]>();
  for (const row of roster) {
    const strictKey = normalizeCodeStrict(row.itemCode);
    if (!strictKey) continue;
    const rows = byStrictKey.get(strictKey) ?? [];
    rows.push(row);
    byStrictKey.set(strictKey, rows);
  }

  return [...byStrictKey.entries()]
    .map(([strictKey, rows]) => {
      const rawSpellings = new Set(rows.map((row) => row.itemCode));
      if (rawSpellings.size < 2) return null;
      return {
        strictKey,
        entries: rows.map((row) => ({
          rawCode: row.itemCode,
          colour: row.colour,
          category: row.category,
          entryPath: row.rosterSource,
          demand: demandByItem?.get(ptmtRosterDemandKey(row.itemCode, row.colour)) ?? null,
        })),
      };
    })
    .filter((collision): collision is PtmtRosterRawSpellingCollision => collision !== null)
    .sort((a, b) => a.strictKey.localeCompare(b.strictKey));
}

function warnOnPtmtRawSpellingCollisions(
  roster: EffectivePtmtRosterItem[],
): void {
  const collisions = findPtmtRawSpellingCollisions(roster);
  for (const collision of collisions) {
    logger.warn(
      {
        strictKey: collision.strictKey,
        entries: collision.entries,
        demandSource: "not available at roster construction; supply a frozen-plan demand map when reporting plan demand",
      },
      "H2r PTMT roster raw-spelling collision detected; warning only",
    );
  }
}

function buildEffectivePtmtRosterWithClassifier(
  itemRows: ItemMaster[],
  rateRows: RateListRow[],
  catalogueRows: MasterProduct[] = [],
  classifyRateRow: (row: RateListRow) => string = rateListPlanningCategory,
  mrpRows: MrpClassificationRow[] = [],
  modelCategories: ReadonlySet<string> = new Set<string>(),
  usePrayagEvidence = false,
): EffectivePtmtRosterItem[] {
  const rateByCode = rateListByCode(rateRows);
  const mrpByCode = new Map(mrpRows.map((row) => [normalizeRateListCode(row.itemCode), row]));
  const prayagEvidence = usePrayagEvidence ? getPrayagCategoryEvidence() : null;
  const isAmbiguousPrayagCode = (code: string): boolean =>
    prayagEvidence?.ambiguousCodes.includes(code) ?? false;
  const prayagCategoryFor = (code: string): PrayagPlanningCategory | undefined =>
    isAmbiguousPrayagCode(code) ? undefined : prayagEvidence?.codeToCategory.get(code);
  const represented = new Set<string>();
  const result: EffectivePtmtRosterItem[] = [];

  for (const row of itemRows) {
    if (row.segment !== "PTMT") continue;
    const code = normalizeRateListCode(row.itemCode);
    const rate = rateByCode.get(code);
    const fallbackCategory = row.classificationStatus === "classified" && row.category !== "Unclassified"
      ? row.category
      : rate ? classifyRateRow(rate) : row.category;
    const rangeCategory = rate ? classifyRateRow(rate) : null;
    const mrp = mrpByCode.get(code);
    const mrpClassification = mrp
      ? resolveMrpClassification(mrp, fallbackCategory, modelCategories, rangeCategory)
      : null;
    const prayagAmbiguous = isAmbiguousPrayagCode(code);
    const prayagCategory = prayagCategoryFor(code);
    const category = prayagAmbiguous
      ? "Unclassified"
      : prayagCategory ?? mrpClassification?.category ?? fallbackCategory;
    const status = prayagAmbiguous
      ? "unclassified"
      : prayagCategory
      ? "classified"
      : mrpClassification?.status ?? (row.classificationStatus === "classified" && row.category !== "Unclassified"
      ? row.classificationStatus
      : category === "Unclassified" ? "unclassified" : "classified");
    result.push({
      ...row,
      itemCode: code,
      category,
      classificationStatus: status,
      classificationSource: prayagAmbiguous || prayagCategory ? "prayag-planning-tabs" : mrpClassification?.source ?? (rate ? "rate-list" : (row.classificationSource ?? "workbook")),
      classificationNote: prayagAmbiguous
        ? `AMBIGUOUS_IN_SOURCE: Prayag planning tabs assign this code to ${prayagEvidence?.rawCategoryByCode.get(code) ?? "multiple categories"}; retained as Unclassified.`
        : prayagCategory
        ? `Prayag planning tab: ${prayagEvidence?.rawCategoryByCode.get(code) ?? prayagCategory}. MRP series retained: ${mrp?.series ?? "not present"}.`
        : mrpClassification?.note ?? (rate
        ? `Rate list: ${rate.rangeName}${category === "Unclassified" ? " (category review required)" : ""}`
        : row.classificationNote),
      rosterSource: rate ? "rate-list" : "workbook",
      rateListName: rate?.name ?? null,
      rateListRange: rate?.rangeName ?? null,
      mrpSeries: mrp?.series ?? null,
      planningCategorySource: prayagAmbiguous || prayagCategory ? "prayag-planning-tabs" : mrpClassification?.source === "mrp"
        ? "mrp"
        : rate ? "rate-list" : row.classificationSource === "catalogue" || row.classificationSource === "workbook"
          ? row.classificationSource
          : "workbook",
    });
    represented.add(code);
  }

  // A reviewed catalogue product is the third source in the precedence chain.
  // It is only promoted when it has an explicit planning category.
  for (const row of catalogueRows) {
    if (!isReviewedCatalogueProduct(row)) continue;
    const code = normalizeRateListCode(row.itemCode);
    if (represented.has(code)) continue;
    const prayagAmbiguous = isAmbiguousPrayagCode(code);
    const prayagCategory = prayagCategoryFor(code);
    const mrpClassification = resolveMrpClassification(
      mrpByCode.get(code),
      row.planningCategory!.trim(),
      modelCategories,
      null,
    );
    result.push({
      id: -1 * (result.length + 1),
      segment: "PTMT",
      category: prayagAmbiguous ? "Unclassified" : prayagCategory ?? mrpClassification.category,
      itemCode: code,
      colour: "",
      classificationStatus: prayagAmbiguous ? "unclassified" : prayagCategory ? "classified" : mrpClassification.status,
      classificationSource: prayagAmbiguous || prayagCategory ? "prayag-planning-tabs" : mrpClassification.source === "mrp" ? "mrp" : "catalogue",
      classificationNote: prayagAmbiguous
        ? `AMBIGUOUS_IN_SOURCE: Prayag planning tabs assign this code to ${prayagEvidence?.rawCategoryByCode.get(code) ?? "multiple categories"}; retained as Unclassified.`
        : prayagCategory
        ? `Prayag planning tab: ${prayagEvidence?.rawCategoryByCode.get(code) ?? prayagCategory}. MRP series retained: ${mrpByCode.get(code)?.series ?? "not present"}.`
        : mrpClassification.note ?? "Reviewed catalogue product promoted into the governed PTMT roster.",
      rosterSource: "catalogue",
      rateListName: null,
      rateListRange: null,
      mrpSeries: mrpByCode.get(code)?.series ?? null,
      planningCategorySource: prayagCategory ? "prayag-planning-tabs" : mrpClassification.source === "mrp" ? "mrp" : "catalogue",
    });
    represented.add(code);
  }

  // A small, explicit MRP-only bridge is required for the approved Luxor and
  // Glory exception. These identities are present in the authoritative MRP
  // and pending source but are absent from both item_master and the governed
  // rate list. Do not generalise this to every MRP-only product: unresolved
  // MRP rows must remain out of the executable roster until their product
  // family has been reviewed.
  for (const row of mrpRows) {
    const code = normalizeRateListCode(row.itemCode);
    if (represented.has(code) || !["LUXOR", "GLORY"].includes(normalizeMrpSeries(row.series))) continue;
    const classification = resolveMrpClassification(
      row,
      "Unclassified",
      modelCategories,
      null,
    );
    if (classification.status !== "classified" || !classification.category) continue;
    const prayagAmbiguous = isAmbiguousPrayagCode(code);
    const prayagCategory = prayagCategoryFor(code);
    result.push({
      id: -1 * (result.length + 1),
      segment: "PTMT",
      category: prayagAmbiguous ? "Unclassified" : prayagCategory ?? classification.category,
      itemCode: code,
      colour: "",
      classificationStatus: prayagAmbiguous ? "unclassified" : prayagCategory ? "classified" : classification.status,
      classificationSource: prayagAmbiguous || prayagCategory ? "prayag-planning-tabs" : "mrp",
      classificationNote: prayagAmbiguous
        ? `AMBIGUOUS_IN_SOURCE: Prayag planning tabs assign this code to ${prayagEvidence?.rawCategoryByCode.get(code) ?? "multiple categories"}; retained as Unclassified.`
        : prayagCategory
        ? `Prayag planning tab: ${prayagEvidence?.rawCategoryByCode.get(code) ?? prayagCategory}. MRP series retained: ${row.series}.`
        : classification.note ?? `MRP-only approved identity: ${row.series}.`,
      rosterSource: "mrp",
      rateListName: null,
      rateListRange: null,
      mrpSeries: row.series,
      planningCategorySource: prayagCategory ? "prayag-planning-tabs" : "mrp",
    });
    represented.add(code);
  }

  // The rate list is authoritative for PTMT identities, including code-only
  // rows that have not appeared in the planning workbook yet.
  for (const row of rateByCode.values()) {
    if (represented.has(row.code)) continue;
    const classification = resolveMrpClassification(
      mrpByCode.get(row.code),
      classifyRateRow(row),
      modelCategories,
      classifyRateRow(row),
    );
    const prayagAmbiguous = isAmbiguousPrayagCode(row.code);
    const prayagCategory = prayagCategoryFor(row.code);
    result.push({
      id: -1 * (result.length + 1),
      segment: "PTMT",
      category: prayagAmbiguous ? "Unclassified" : prayagCategory ?? classification.category,
      itemCode: row.code,
      colour: "",
      classificationStatus: prayagAmbiguous ? "unclassified" : prayagCategory ? "classified" : classification.status,
      classificationSource: prayagAmbiguous || prayagCategory ? "prayag-planning-tabs" : classification.source,
      classificationNote: prayagAmbiguous
        ? `AMBIGUOUS_IN_SOURCE: Prayag planning tabs assign this code to ${prayagEvidence?.rawCategoryByCode.get(row.code) ?? "multiple categories"}; retained as Unclassified.`
        : prayagCategory
        ? `Prayag planning tab: ${prayagEvidence?.rawCategoryByCode.get(row.code) ?? prayagCategory}. MRP series retained: ${mrpByCode.get(row.code)?.series ?? "not present"}.`
        : classification.note
        ?? `Rate list: ${row.rangeName}${classification.category === "Unclassified" ? " (category review required)" : ""}`,
      rosterSource: "rate-list",
      rateListName: row.name,
      rateListRange: row.rangeName,
      mrpSeries: mrpByCode.get(row.code)?.series ?? null,
      planningCategorySource: prayagCategory ? "prayag-planning-tabs" : classification.source,
    });
    represented.add(row.code);
  }

  const sorted = result.sort((a, b) => a.itemCode.localeCompare(b.itemCode) || a.colour.localeCompare(b.colour));
  // H2r intentionally warns without changing roster content. This becomes
  // fatal only after the canonical-key decision resolves the seven current
  // groups; do not merge, deduplicate, or drop rows here.
  warnOnPtmtRawSpellingCollisions(sorted);
  return sorted;
}

export function buildEffectivePtmtRoster(
  itemRows: ItemMaster[],
  rateRows: RateListRow[],
  catalogueRows: MasterProduct[] = [],
  mrpRows: MrpClassificationRow[] = [],
  modelCategories: ReadonlySet<string> = new Set<string>(),
): EffectivePtmtRosterItem[] {
  return buildEffectivePtmtRosterWithClassifier(
    itemRows,
    rateRows,
    catalogueRows,
    rateListPlanningCategory,
    mrpRows,
    modelCategories,
    false,
  );
}

function uniqueSorted(values: Iterable<string>): string[] {
  return [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort();
}

function planningCategoryFromRows(rows: PlumbingRosterPlanningRow[]): string | null {
  const categories = uniqueSorted(rows.map((row) => row.category));
  if (categories.length === 0) return null;
  return categories.length === 1 ? categories[0]! : `AMBIGUOUS: ${categories.join(" | ")}`;
}

/**
 * Compare the current Prayag Plumbing planning-tab roster with the authoritative
 * MRP Pipes & Fittings division. This is intentionally a read model: it reports
 * the exact delta before the MRP-only rows are allowed into plan construction.
 *
 * Category precedence is explicit:
 *   1. planning-tab material × type when a code is in the current roster
 *   2. MRP series crosswalk for an MRP-only code
 *   3. unresolved remains visible rather than guessed
 */
export function buildPlumbingRosterCoverage(
  planningRows: PlumbingRosterPlanningRow[],
  mrpRows: PlumbingRosterMrpRow[],
): PlumbingRosterCoverageReport {
  const planningByCode = new Map<string, PlumbingRosterPlanningRow[]>();
  for (const row of planningRows) {
    const code = normalizeCodeStrict(row.itemCode);
    if (!code) continue;
    const rows = planningByCode.get(code) ?? [];
    rows.push({ ...row, itemCode: normalizeRateListCode(row.itemCode) });
    planningByCode.set(code, rows);
  }

  const mrpByCode = new Map<string, PlumbingRosterMrpRow[]>();
  for (const row of mrpRows) {
    if (row.division.trim() !== "Pipes & Fittings") continue;
    const code = normalizeCodeStrict(row.itemCode);
    if (!code) continue;
    const rows = mrpByCode.get(code) ?? [];
    rows.push({ ...row, itemCode: normalizeRateListCode(row.itemCode) });
    mrpByCode.set(code, rows);
  }

  const allCodes = uniqueSorted([...planningByCode.keys(), ...mrpByCode.keys()]);
  const entryFor = (code: string): PlumbingRosterCoverageEntry => {
    const planning = planningByCode.get(code) ?? [];
    const mrp = mrpByCode.get(code) ?? [];
    const planningCategory = planningCategoryFromRows(planning);
    const derivedCategories = uniqueSorted(
      mrp.map((row) => deriveMrpPlanningCategory(row.itemCode, row.division, row.series).category ?? ""),
    );
    const mrpDerivedCategory = derivedCategories.length === 1
      ? derivedCategories[0]!
      : derivedCategories.length > 1
        ? `AMBIGUOUS: ${derivedCategories.join(" | ")}`
        : null;
    const effectiveCategory = planningCategory ?? mrpDerivedCategory;
    return {
      code: planning[0]?.itemCode ?? mrp[0]?.itemCode ?? code,
      planningCategory,
      effectiveCategory,
      categorySource: planningCategory
        ? "prayag-planning-tabs"
        : mrpDerivedCategory
          ? "mrp"
          : "unclassified",
      mrpSeries: uniqueSorted(mrp.map((row) => row.series)).join(" | ") || null,
      mrpDerivedCategory,
      mrpDivision: uniqueSorted(mrp.map((row) => row.division)).join(" | ") || null,
      mrpStatus: mrp.length === 0
        ? null
        : mrp.some((row) => row.rowType !== "discontinued" && !row.discontinued)
          ? "active"
          : "discontinued",
      productName: mrp.find((row) => row.productName)?.productName ?? null,
    };
  };

  const bothCodes = allCodes.filter((code) => planningByCode.has(code) && mrpByCode.has(code));
  const mrpOnlyCodes = allCodes.filter((code) => mrpByCode.has(code) && !planningByCode.has(code));
  const rosterOnlyCodes = allCodes.filter((code) => planningByCode.has(code) && !mrpByCode.has(code));
  return {
    rosterCodeCount: planningByCode.size,
    mrpCodeCount: mrpByCode.size,
    bothCodeCount: bothCodes.length,
    mrpOnlyCodeCount: mrpOnlyCodes.length,
    rosterOnlyCodeCount: rosterOnlyCodes.length,
    both: bothCodes.map(entryFor),
    mrpOnly: mrpOnlyCodes.map(entryFor),
    rosterOnly: rosterOnlyCodes.map(entryFor),
  };
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
    rosterCodeCount: acceptedCodes.size,
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

function sourceQuantitiesByCode(sourceRows: Record<string, unknown>[]): Map<string, number> {
  const quantities = new Map<string, number>();
  for (const row of sourceRows) {
    const code = normalizeRateListCode(firstValue(row, CODE_ALIASES));
    if (!code) continue;
    quantities.set(code, (quantities.get(code) ?? 0) + numericValue(firstValue(row, QTY_ALIASES)));
  }
  return quantities;
}

export function buildRateListCategorySplit(
  roster: EffectivePtmtRosterItem[],
  sourceQuantities: Map<string, number>,
  bufferByCategory: ReadonlyMap<string, number>,
): RateListCategorySplit[] {
  const categoryByCode = new Map<string, string>();
  const ambiguousCodes = new Set<string>();
  for (const item of roster) {
    const code = normalizeRateListCode(item.itemCode);
    if (!code) continue;
    if (ambiguousCodes.has(code)) continue;
    const category = item.category?.trim() || "Unclassified";
    const existing = categoryByCode.get(code);
    if (!existing || existing === category) {
      categoryByCode.set(code, category);
    } else {
      // A code appearing under multiple categories is not safe to assign to
      // either governed category for a partitioned demand view. Keep the
      // ambiguous state terminal so query row order cannot reclassify it.
      categoryByCode.set(code, "Unclassified");
      ambiguousCodes.add(code);
    }
  }
  const categories = new Map<string, Set<string>>();
  for (const [code, category] of categoryByCode) {
    const codes = categories.get(category) ?? new Set<string>();
    codes.add(code);
    categories.set(category, codes);
  }
  const orderedCategories = [
    ...PTMT_CATEGORY_ORDER,
    ...[...categories.keys()].filter((category) => !(PTMT_CATEGORY_ORDER as readonly string[]).includes(category)).sort(),
  ];
  return orderedCategories.map((category) => {
    const codes = categories.get(category) ?? new Set<string>();
    const julySourceQuantity = [...codes].reduce(
      (total, code) => total + (sourceQuantities.get(code) ?? 0),
      0,
    );
    return {
      category,
      codeCount: codes.size,
      julySourceQuantity: Math.round(julySourceQuantity),
      multiplier: category === "Unclassified" ? null : bufferByCategory.get(category) ?? null,
    };
  });
}

export async function getEffectivePtmtRoster(): Promise<EffectivePtmtRosterItem[]> {
  try {
    const reportRows = await fetchPtmtReportRoster();
    if (reportRows.length > 0) {
      return buildPtmtReportRoster(reportRows);
    }
  } catch (err) {
    // Keep the legacy sources as an explicit recovery path for connector
    // outages. A successful REPORT read always wins and is never merged with
    // category-tab/rate-list identities.
    logger.warn({ err: String(err) }, "PTMT REPORT 1-9 roster unavailable; using legacy reference-data recovery path");
  }

  const [itemRows, rateRows, catalogueRows, mrpSource, bufferRows] = await Promise.all([
    db.select().from(itemMasterTable).where(eq(itemMasterTable.segment, "PTMT")),
    loadRateListRows(),
    db.select().from(masterProductsTable).where(and(
      eq(masterProductsTable.segment, "PTMT"),
      eq(masterProductsTable.isActive, true),
    )),
    db.select({ id: mrpControlSourcesTable.id }).from(mrpControlSourcesTable)
      .orderBy(desc(mrpControlSourcesTable.importedAt)).limit(1),
    db.select({ name: bufferCategoriesTable.name }).from(bufferCategoriesTable)
      .where(eq(bufferCategoriesTable.segment, "PTMT")),
  ]);
  const mrpRows = mrpSource[0]
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
  return buildEffectivePtmtRosterWithClassifier(
    itemRows,
    rateRows,
    catalogueRows,
    rateListPlanningCategory,
    mrpRows,
    new Set(bufferRows.map((row) => row.name)),
    true,
  );
}

export async function getRateListReport() {
  const [rateRows, rateUpload, pendingUploads, itemRows, catalogueRows, bufferRows, mrpSource] = await Promise.all([
    loadRateListRows(),
    db.select({
      id: uploadedFilesTable.id,
      filename: uploadedFilesTable.filename,
      rowCount: uploadedFilesTable.rowCount,
      uploadedAt: uploadedFilesTable.uploadedAt,
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
      .where(eq(uploadedFilesTable.kind, "last_month_pending"))
      .orderBy(desc(uploadedFilesTable.uploadedAt)),
    db.select().from(itemMasterTable),
    db.select().from(masterProductsTable).where(and(
      eq(masterProductsTable.segment, "PTMT"),
      eq(masterProductsTable.isActive, true),
    )),
    db.select({
      name: bufferCategoriesTable.name,
      multiplier: bufferCategoriesTable.multiplier,
    }).from(bufferCategoriesTable).where(eq(bufferCategoriesTable.segment, "PTMT")),
    db.select({ id: mrpControlSourcesTable.id }).from(mrpControlSourcesTable)
      .orderBy(desc(mrpControlSourcesTable.importedAt)).limit(1),
  ]);
  // The DB row identifies the CSV recovery source; the actual rows above may
  // come from the live governed sheet.
  const latestRate = rateUpload[0];
  const julyPending = pendingUploads.find((upload) => /july/i.test(upload.filename));
  const sourceRows = julyPending ? julyPending.rows as Record<string, unknown>[] : [];
  const sourceQuantities = sourceQuantitiesByCode(sourceRows);
  const bufferByCategory = new Map(bufferRows.map((row) => [row.name, row.multiplier]));
  const mrpRows: MrpClassificationRow[] = mrpSource[0]
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
  const beforeRoster = buildEffectivePtmtRosterWithClassifier(itemRows, rateRows, catalogueRows, legacyRateListPlanningCategory);
  const afterRoster = buildEffectivePtmtRosterWithClassifier(
    itemRows,
    rateRows,
    catalogueRows,
    rateListPlanningCategory,
    mrpRows,
    new Set(bufferRows.map((row) => row.name)),
    true,
  );
  const rateCodes = new Set(rateRows.map((row) => row.code));
  const effectiveRosterCodes = new Set(afterRoster.map((row) => normalizeRateListCode(row.itemCode)));
  const prayagEvidence = getPrayagCategoryEvidence();
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
  const legacyReconciliation = julyPending
    ? buildCodeReconciliation(ptmtItemCodes, sourceRows)
    : null;
  const reconciliation = julyPending
    ? {
      ...buildCodeReconciliation(effectiveRosterCodes, sourceRows),
      rateListCodeCount: rateCodes.size,
    }
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
    rangeAudit: buildRateListRangeAudit(rateRows),
    categorySplit: {
      before: buildRateListCategorySplit(beforeRoster, sourceQuantities, bufferByCategory),
      after: buildRateListCategorySplit(afterRoster, sourceQuantities, bufferByCategory),
    } satisfies RateListCategorySplitReport,
    julySource: julyPending ? {
      id: julyPending.id,
      filename: julyPending.filename,
      rowCount: sourceRows.length,
      uploadedAt: julyPending.uploadedAt,
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
    prayagPlanningEvidence: {
      status: prayagEvidence.status,
      sourcePath: prayagEvidence.sourcePath,
      mappedCodeCount: prayagEvidence.codeToCategory.size,
      sharedRowCount: prayagEvidence.sharedRowCount,
      sourceCategoryCount: prayagEvidence.rawCategoryByCode.size,
      unknownCategories: prayagEvidence.unknownCategories,
      appOnlyCodes: prayagEvidence.appOnlyCodes,
      appOnlyRowCount: prayagEvidence.appOnlyRowCount,
      appOnlyMrpSeries: prayagEvidence.appOnlyCodes.map((code) => ({
        code,
        series: mrpRows.find((row) => normalizeRateListCode(row.itemCode) === code)?.series ?? null,
      })),
    },
  };
}