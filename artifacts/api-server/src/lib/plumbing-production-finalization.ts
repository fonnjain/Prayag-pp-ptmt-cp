const EPSILON = 1e-9;

export interface PlumbingProductionFinalizationRow {
  productionPlan: number | null | undefined;
  demandPlan?: number | null;
  temporaryPlan?: number | null;
  cannotBeMade?: number | null;
  feasibilityStatus?: string | null;
}

export type PlumbingZeroExecutableClassification =
  | "UNFITTED_PLACEHOLDER"
  | "ALL_UNFEASIBLE";

export interface PlumbingProductionFinalizationBlock {
  error: "PLUMBING_PRODUCTION_NOT_FITTED";
  classification: PlumbingZeroExecutableClassification;
  rosterCount: number;
  executableTotal: number;
  demandTotal: number;
  unfeasibleTotal: number;
  message: string;
}

function nonNegative(value: number | null | undefined): number {
  return Math.max(0, Number(value ?? 0));
}

function demandFor(row: PlumbingProductionFinalizationRow): number {
  return nonNegative(row.demandPlan ?? row.temporaryPlan ?? row.productionPlan);
}

/**
 * A Plumbing Production Plan can be created as an unfitted draft, but a
 * non-empty roster with zero executable pieces must not become governed output.
 *
 * Empty rosters are allowed through this guard so the existing empty-result
 * validation remains responsible for them. All-unfeasible results are still
 * blocked, but are classified separately from an untouched placeholder.
 */
export function getPlumbingProductionFinalizationBlock(
  segment: string,
  planType: string,
  rows: PlumbingProductionFinalizationRow[],
): PlumbingProductionFinalizationBlock | null {
  if (segment !== "Plumbing" || planType !== "production" || rows.length === 0) {
    return null;
  }

  const executableTotal = rows.reduce(
    (sum, row) => sum + nonNegative(row.productionPlan),
    0,
  );
  if (executableTotal > EPSILON) {
    return null;
  }

  const demandTotal = rows.reduce((sum, row) => sum + demandFor(row), 0);
  const unfeasibleTotal = rows.reduce(
    (sum, row) => sum + nonNegative(row.cannotBeMade),
    0,
  );
  const allUnfeasible =
    demandTotal > EPSILON && unfeasibleTotal >= demandTotal - EPSILON;
  const classification: PlumbingZeroExecutableClassification = allUnfeasible
    ? "ALL_UNFEASIBLE"
    : "UNFITTED_PLACEHOLDER";

  return {
    error: "PLUMBING_PRODUCTION_NOT_FITTED",
    classification,
    rosterCount: rows.length,
    executableTotal,
    demandTotal,
    unfeasibleTotal,
    message: allUnfeasible
      ? "Cannot finalize this Plumbing Production Plan: the non-empty roster has zero executable pieces because all demand is currently unfeasible. The outcome must remain explicitly classified rather than being published as an unexamined zero."
      : "Cannot finalize this Plumbing Production Plan: it is a non-empty unfitted placeholder with zero executable pieces. Run the Plumbing machine cascade before publishing governed output.",
  };
}