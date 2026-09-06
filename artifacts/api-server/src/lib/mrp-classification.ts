import type { ProductClassificationStatus } from "./master-products";

export type MrpDerivedClassification = {
  category: string | null;
  status: "resolved" | "hold";
};

export type MrpClassificationRow = {
  itemCode: string;
  division: string;
  series: string;
};

export type MrpSeriesReviewStatus = "applied" | "pending_review" | "unmapped";

export type MrpSeriesCrosswalkDecision = {
  category: string | null;
  status: MrpSeriesReviewStatus;
};

const EXPLICIT_HELD_CATEGORIES = new Set([
  "P.V.C. Connections",
  "Waste Pipes",
  "Collapsible Waste Pipes",
  "Special Cock",
  "Showers Sets",
]);

/**
 * These are exact reviewed MRP series values. They intentionally use a
 * normalized key so harmless capitalization and whitespace differences do not
 * create a second business mapping, while near-matches remain held.
 */
export const REVIEWED_MRP_SERIES_CROSSWALK: Readonly<Record<string, string>> = {
  "STANDARD (NEW HANDLE)": "Cocks Standard",
  "STANDARD (OLD HANDLE)": "Cocks Standard",
  // Prayag MRP product descriptions identify these finish series as the same
  // standard cock families already governed by 121/124/144 range mappings.
  LUXOR: "Cocks Standard",
  GLORY: "Cocks Standard",
  "CISTERN": "Cistern & Seat Cover",
  "CISTERN'S & SEAT COVER'S ACCESSORIES": "Cistern & Seat Cover",
  "TOILET SEAT COVERS": "Cistern & Seat Cover",
  "WASTE COUPLING": "Accessorise",
  "TANK NIPPLES": "Accessorise",
  "WATER TANK LINE FILTER": "Accessorise",
  "WASHING MACHINE": "Faucets & Jetsprays & Shower",
};

/**
 * These exact series have no matching product-level RANGE NAME evidence in the
 * working sheet and therefore still need Prayag review.
 */
export const PENDING_REVIEW_MRP_SERIES: ReadonlySet<string> = new Set([
  "EROSA",
  "CRYSTAL",
  "ASTRA",
]);

const RANGE_DRIVEN_FINISH_SERIES = new Set([
  "COBRA",
  "HELIX",
  "QUADRA",
  "ROMAN",
  "DIAMOND",
  "FLORA",
]);

export function normalizeMrpSeries(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

function normalizeFinishSeries(value: unknown): string {
  return normalizeMrpSeries(value).replace(
    /\s+\((?:BLACK|BLUE|GOLD|PEACH|ROYAL|WINE|DARK BLUE)\)$/,
    "",
  );
}

export function getMrpSeriesCrosswalkDecision(series: unknown): MrpSeriesCrosswalkDecision {
  const normalized = normalizeMrpSeries(series);
  const category = REVIEWED_MRP_SERIES_CROSSWALK[normalized];
  if (category) return { category, status: "applied" };
  if (PENDING_REVIEW_MRP_SERIES.has(normalizeFinishSeries(normalized))) {
    return { category: null, status: "pending_review" };
  }
  return { category: null, status: "unmapped" };
}

function materialPrefix(series: string): string | null {
  const upper = series.toUpperCase();
  if (upper.includes("CPVC")) return "CPVC";
  if (upper.includes("UPVC")) return "UPVC";
  if (upper.includes("SWR")) return "SWR";
  if (upper.includes("AGRI")) return "AGRI";
  if (upper.includes("OPVC")) return "OPVC";
  if (upper.includes("HDPE")) return "HDPE";
  if (upper.includes("PPR")) return "PPR";
  if (upper.includes("PE-AL-PE") || upper.includes("PEALPE")) return "PE-AL-PE";
  if (upper.includes("PEXI")) return "PEXI";
  return null;
}

/**
 * MRP series is the governing classification signal. Only series that map to
 * an existing executable planning category are marked resolved; the rest are
 * retained as visible holds rather than being guessed into a buffer.
 */
export function deriveMrpPlanningCategory(
  itemCode: string,
  division: string,
  series: string,
): MrpDerivedClassification {
  const value = series.trim();
  const upper = value.toUpperCase();
  const reviewed = getMrpSeriesCrosswalkDecision(value);
  if (reviewed.status === "applied") return { category: reviewed.category, status: "resolved" };
  if (reviewed.status === "pending_review") return { category: null, status: "hold" };
  if (RANGE_DRIVEN_FINISH_SERIES.has(normalizeFinishSeries(value))) {
    return { category: null, status: "hold" };
  }
  if (itemCode.toUpperCase() === "DB-02L") return { category: "Cistern & Seat Cover", status: "resolved" };
  if (division === "Pipes & Fittings") {
    const material = materialPrefix(value);
    if (material && upper.includes("PIPE")) return { category: `${material} Pipe`, status: "resolved" };
    if (material && upper.includes("FITTING")) return { category: `${material} Fitting`, status: "resolved" };
    return { category: value || null, status: "hold" };
  }
  if (division !== "PTMT & Plastic Fittings") return { category: value || null, status: "hold" };
  if (upper === "SPECIAL COCK") return { category: "Special Cock", status: "hold" };
  if (upper.includes("COLLAPSIBLE WASTE")) return { category: "Collapsible Waste Pipes", status: "hold" };
  if (upper.includes("WASTE PIPE")) return { category: "Waste Pipes", status: "hold" };
  if (upper.includes("SHOWERS SET")) return { category: "Showers Sets", status: "hold" };
  if (upper.includes("BALL COCK")) return { category: "Ball Cock", status: "resolved" };
  if (upper.includes("CISTERN") || upper.includes("SEAT COVER")) return { category: "Cistern & Seat Cover", status: "resolved" };
  if (upper.includes("CABINET")) return { category: "Cabinet", status: "resolved" };
  if (upper.includes("COCK") || upper.includes("MIXER") || upper.includes("PILLAR") || upper.includes("BIB ") || upper.includes("PUSH COCK")) {
    return { category: "Cocks Standard", status: "resolved" };
  }
  if (upper.includes("FAUCET") || upper.includes("JET SPRAY")) return { category: "Faucets & Jetsprays & Shower", status: "resolved" };
  if (upper === "ACCESSORIES" || upper.includes("ACCESSORIES")) return { category: "Accessorise", status: "resolved" };
  // These are explicit MRP series but have no approved capacity line yet.
  if (upper.includes("P.V.C. CONNECTION")) return { category: "P.V.C. Connections", status: "hold" };
  return { category: value || null, status: "hold" };
}

export type EffectiveMrpClassification = {
  category: string;
  status: ProductClassificationStatus;
  source: "mrp" | "rate-list";
  note: string | null;
};

/**
 * Apply the source precedence rule:
 * - an executable MRP series wins;
 * - an explicitly held MRP category remains held;
 * - a pending finish series may resolve from its product RANGE NAME;
 * - an unresolved MRP series falls back to the rate list;
 * - unresolved data stays Unclassified and held.
 *
 * MRP series values such as Helix and Quadra are finish labels, not planning
 * categories. Their product-level range category must therefore be supplied
 * separately rather than guessing one category for the whole series.
 */
export function resolveMrpClassification(
  mrp: MrpClassificationRow | undefined,
  fallbackCategory: string,
  modelCategories: ReadonlySet<string>,
  rangeCategory?: string | null,
): EffectiveMrpClassification {
  const series = mrp?.series.trim() ?? "";
  if (!mrp || !series) {
    return {
      category: fallbackCategory || "Unclassified",
      status: fallbackCategory && fallbackCategory !== "Unclassified" ? "classified" : "unclassified",
      source: "rate-list",
      note: null,
    };
  }

  const derived = deriveMrpPlanningCategory(mrp.itemCode, mrp.division, series);
  const derivedCategory = derived.category?.trim() || null;
  const pendingFinishReview = getMrpSeriesCrosswalkDecision(series).status === "pending_review";
  const rangeDrivenFinish = RANGE_DRIVEN_FINISH_SERIES.has(normalizeFinishSeries(series));

  if (pendingFinishReview) {
    return {
      category: "Unclassified",
      status: "unclassified",
      source: "mrp",
      note: `MRP series: ${series} has no working-sheet RANGE NAME evidence; Prayag review is required.`,
    };
  }

  if (rangeDrivenFinish) {
    const resolvedRangeCategory = rangeCategory?.trim() || "";
    const rangeExecutable = resolvedRangeCategory !== "Unclassified" &&
      modelCategories.has(resolvedRangeCategory);
    if (rangeExecutable) {
      return {
        category: resolvedRangeCategory,
        status: "classified",
        source: "rate-list",
        note: `MRP series: ${series} is a finish; RANGE NAME category: ${resolvedRangeCategory}.`,
      };
    }
    return {
      category: "Unclassified",
      status: "unclassified",
      source: "mrp",
      note: `MRP series: ${series} is a finish; an executable RANGE NAME category is required.`,
    };
  }

  // MRP-derived categories remain authoritative, including explicit held
  // categories such as P.V.C. Connections that do not yet have a capacity line.
  if (derivedCategory && (
    derived.status === "resolved" ||
    EXPLICIT_HELD_CATEGORIES.has(derivedCategory)
  )) {
    const executable = derived.status === "resolved" && modelCategories.has(derivedCategory);
    return {
      category: derivedCategory,
      status: executable ? "classified" : "unclassified",
      source: "mrp",
      note: executable
        ? `MRP series: ${series}.`
        : `MRP series: ${series}; held until an executable planning category and capacity line are approved.`,
    };
  }

  // A present but unrecognised MRP series does not override a resolvable rate
  // list category. The rate list represents what the plant actually makes.
  const rateCategory = fallbackCategory?.trim() || "Unclassified";
  const rateExecutable = rateCategory !== "Unclassified" && modelCategories.has(rateCategory);
  if (rateExecutable) {
    return {
      category: rateCategory,
      status: "classified",
      source: "rate-list",
      note: `MRP series: ${series} has no approved category; rate-list fallback: ${rateCategory}.`,
    };
  }

  return {
    category: "Unclassified",
    status: "unclassified",
    source: "rate-list",
    note: `MRP series: ${series} has no approved category and the rate list is also unresolved.`,
  };
}