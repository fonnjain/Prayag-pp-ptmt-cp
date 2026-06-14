// Pure deterministic buffer-planning engine. NO AI in this path.
// The multiplier is ALWAYS user input (single, min/max, or per-category
// overrides) — never a hard-coded literal.

export type MultiplierMode = "single" | "minmax" | "overrides";

export interface EngineConfig {
  mode: MultiplierMode;
  multiplier?: number | null;
  multiplierMin?: number | null;
  multiplierMax?: number | null;
  overrides?: Record<string, number>;
  includeCurrentPending: boolean;
  floor0: boolean;
}

// One aggregated record per natural key (PTMT: item+colour, CP: rolled item).
export interface EngineInput {
  itemCode: string;
  colour: string;
  model: string | null;
  category: string | null;
  report: string | null;
  last3Sale: number;
  lastMonthSale: number;
  avgSaleAnnual: number;
  sale2m: number;
  sale10m: number;
  openingStock: number;
  pendingLast: number;
  pendingCurrent: number;
  produced: number;
  orderAsOn: number;
  rate: number;
}

export interface EngineLine {
  itemCode: string;
  colour: string;
  model: string | null;
  category: string | null;
  report: string | null;
  runRate: number;
  last3Sale: number;
  lastMonthSale: number;
  avgSaleAnnual: number;
  sale2m: number;
  sale10m: number;
  openingStock: number;
  pendingLast: number;
  pendingCurrent: number;
  multiplier: number | null;
  bufferTarget: number | null;
  bufferTargetMin: number | null;
  bufferTargetMax: number | null;
  minRequired: number | null;
  maxRequired: number | null;
  productionRequired: number;
  orderAsOn: number;
  produced: number;
  left: number;
  coverage: number;
  urgent: boolean;
  valueAmount: number;
}

const URGENT_COVERAGE = 0.3; // months of cover at/below which an item is urgent

function round(n: number, dp = 2): number {
  const f = 10 ** dp;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function applyFloor(value: number, floor0: boolean): number {
  return floor0 ? Math.max(0, value) : value;
}

export function computeLine(input: EngineInput, cfg: EngineConfig): EngineLine {
  const runRate = input.last3Sale / 3;
  const demandPending =
    input.pendingLast + (cfg.includeCurrentPending ? input.pendingCurrent : 0);

  let multiplier: number | null = null;
  let bufferTarget: number | null = null;
  let bufferTargetMin: number | null = null;
  let bufferTargetMax: number | null = null;
  let minRequired: number | null = null;
  let maxRequired: number | null = null;
  let productionRequired = 0;

  if (cfg.mode === "minmax") {
    const mMin = cfg.multiplierMin ?? 0;
    const mMax = cfg.multiplierMax ?? 0;
    bufferTargetMin = runRate * mMin;
    bufferTargetMax = runRate * mMax;
    minRequired = applyFloor(
      bufferTargetMin - input.openingStock + demandPending,
      cfg.floor0,
    );
    maxRequired = applyFloor(
      bufferTargetMax - input.openingStock + demandPending,
      cfg.floor0,
    );
    productionRequired = maxRequired;
  } else {
    // single or overrides: a single multiplier per line
    const base = cfg.multiplier ?? 0;
    multiplier =
      cfg.mode === "overrides" && input.category
        ? (cfg.overrides?.[input.category] ?? base)
        : base;
    bufferTarget = runRate * multiplier;
    productionRequired = applyFloor(
      bufferTarget - input.openingStock + demandPending,
      cfg.floor0,
    );
    minRequired = productionRequired;
    maxRequired = productionRequired;
  }

  const coverage = runRate > 0 ? input.openingStock / runRate : input.openingStock > 0 ? 999 : 0;
  const urgent = runRate > 0 && coverage <= URGENT_COVERAGE;
  const left = applyFloor(productionRequired - input.produced, true);
  const valueAmount = productionRequired * (input.rate || 0);

  return {
    itemCode: input.itemCode,
    colour: input.colour,
    model: input.model,
    category: input.category,
    report: input.report,
    runRate: round(runRate),
    last3Sale: round(input.last3Sale),
    lastMonthSale: round(input.lastMonthSale),
    avgSaleAnnual: round(input.avgSaleAnnual),
    sale2m: round(input.sale2m),
    sale10m: round(input.sale10m),
    openingStock: round(input.openingStock),
    pendingLast: round(input.pendingLast),
    pendingCurrent: round(input.pendingCurrent),
    multiplier: multiplier === null ? null : round(multiplier, 4),
    bufferTarget: bufferTarget === null ? null : round(bufferTarget),
    bufferTargetMin: bufferTargetMin === null ? null : round(bufferTargetMin),
    bufferTargetMax: bufferTargetMax === null ? null : round(bufferTargetMax),
    minRequired: minRequired === null ? null : round(minRequired),
    maxRequired: maxRequired === null ? null : round(maxRequired),
    productionRequired: round(productionRequired),
    orderAsOn: round(input.orderAsOn),
    produced: round(input.produced),
    left: round(left),
    coverage: round(coverage),
    urgent,
    valueAmount: round(valueAmount),
  };
}

export function computeLines(
  inputs: EngineInput[],
  cfg: EngineConfig,
): EngineLine[] {
  return inputs.map((i) => computeLine(i, cfg));
}
