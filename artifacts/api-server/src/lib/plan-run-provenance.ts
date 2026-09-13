export type PlanRunFactorStatus = "PASS" | "DISCREPANCY" | "UNAVAILABLE";

export type PlanRunFactorProvenance = {
  effectiveMultiplier: number | null;
  recordedMultiplier: number | null;
  status: PlanRunFactorStatus;
};

export type PlanRunUploadProvenance = {
  sourceKind: string;
  sourceUploadId: number | null;
  sourceFilename: string | null;
  rowCount: number | null;
  uploadedAt: string | null;
  usedForPlanning: boolean;
};

export type PlanRunProvenance = {
  version: 1;
  capturedAt: string;
  roster: {
    source: "REPORT_1_9" | "FALLBACK" | null;
    workbookId: string | null;
    rowCount: number | null;
    fallbackReason: string | null;
  };
  salesHistory: {
    workbookId: string | null;
    label: string | null;
  };
  uploads: Record<string, PlanRunUploadProvenance>;
  factors: Record<string, PlanRunFactorProvenance>;
};

type FactorRow = {
  category: string;
  avg3MoSale: number;
  bufferReq: number | null | undefined;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

/**
 * Recover the multiplier that produced a frozen category's buffer values.
 *
 * BufferReq and Avg3MoSale are both persisted after the planner's two-decimal
 * rounding, so use the category-wide weighted ratio rather than one arbitrary
 * row. This reflects the executable factor without changing the frozen rows.
 */
export function deriveEffectiveMultiplier(
  rows: FactorRow[],
  category: string,
): number | null {
  let totalAverage = 0;
  let totalBuffer = 0;
  for (const row of rows) {
    if (row.category !== category || row.avg3MoSale <= 0 || row.bufferReq == null) continue;
    totalAverage += row.avg3MoSale;
    totalBuffer += row.bufferReq;
  }
  if (totalAverage <= 0) return null;
  return round2(totalBuffer / totalAverage);
}

export function factorStatus(
  effectiveMultiplier: number | null,
  recordedMultiplier: number | null,
): PlanRunFactorStatus {
  if (effectiveMultiplier == null || recordedMultiplier == null) return "UNAVAILABLE";
  return Math.abs(effectiveMultiplier - recordedMultiplier) <= 0.01
    ? "PASS"
    : "DISCREPANCY";
}

export function buildFactorProvenance(
  rows: FactorRow[],
  recordedMultipliers: Record<string, number>,
  categories: string[],
): Record<string, PlanRunFactorProvenance> {
  return Object.fromEntries(categories.map((category) => {
    const effectiveMultiplier = deriveEffectiveMultiplier(rows, category);
    const recordedValue = recordedMultipliers[category];
    const recordedMultiplier = typeof recordedValue === "number" && Number.isFinite(recordedValue)
      ? recordedValue
      : null;
    return [category, {
      effectiveMultiplier,
      recordedMultiplier,
      status: factorStatus(effectiveMultiplier, recordedMultiplier),
    }];
  }));
}