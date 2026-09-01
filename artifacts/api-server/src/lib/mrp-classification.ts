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
  "CISTERN": "Cistern & Seat Cover",
  "CISTERN'S & SEAT COVER'S ACCESSORIES": "Cistern & Seat Cover",
  "TOILET SEAT COVERS": "Cistern & Seat Cover",
  "WASTE COUPLING": "Accessorise",
  "TANK NIPPLES": "Accessorise",
  "WATER TANK LINE FILTER": "Accessorise",
  "WASHING MACHINE": "Faucets & Jetsprays & Shower",
};

/**
 * These exact series were proposed as Cocks Premium, but premium-versus-
 * standard is a business decision and must not receive a buffer yet.
 */
export const PENDING_REVIEW_MRP_SERIES: ReadonlySet<string> = new Set([
  "EROSA (BLACK)",
  "COBRA",
  "HELIX",
  "LUXOR",
  "QUADRA (ROYAL)",
  "CRYSTAL",
  "GLORY",
  "ASTRA",
  "ROMAN",
  "DIAMOND",
  "FLORA (ROYAL)",
]);

export function normalizeMrpSeries(value: unknown): string {
  return String(value ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

export function getMrpSeriesCrosswalkDecision(series: unknown): MrpSeriesCrosswalkDecision {
  const normalized = normalizeMrpSeries(series);
  const category = REVIEWED_MRP_SERIES_CROSSWALK[normalized];
  if (category) return { category, status: "applied" };
  if (PENDING_REVIEW_MRP_SERIES.has(normalized)) return { category: null, status: "pending_review" };
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
 * Apply the terminal MRP precedence rule. A non-empty series is never allowed
 * to fall through to the rate list: it either maps to a configured planning
 * category or remains visible as an unclassified/held series. Only an absent
 * series may use the rate-list fallback.
 */
export function resolveMrpClassification(
  mrp: MrpClassificationRow | undefined,
  fallbackCategory: string,
  modelCategories: ReadonlySet<string>,
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
  const derivedCategory = derived.category?.trim() || "Unclassified";
  const category = derivedCategory === "Unclassified"
    || (derived.status === "hold" && !EXPLICIT_HELD_CATEGORIES.has(derivedCategory))
    ? "Unclassified"
    : derivedCategory;
  const executable = derived.status === "resolved" && modelCategories.has(category);
  return {
    category,
    status: executable ? "classified" : "unclassified",
    source: "mrp",
    note: executable
      ? `MRP series: ${series}.`
      : `MRP series: ${series}; held until an executable planning category and capacity line are approved.`,
  };
}