export interface ItemSourceRow {
  itemCode: string;
  colour: string;
  avg3MoSaleTotal3Mo: number;
  stock: number;
  stockNeedsReview: boolean;
  pendingOrderLastMonth: number;
  pendingOrder: number;
  order: number;
}

export interface WeeklyBandConfig {
  w1Upper: number;
  w2Upper: number;
  w3Upper: number;
  w4Upper: number;
}

export interface CalcPlanItem {
  itemCode: string;
  colour: string;
  category: string;
  avg3MoSale: number;
  stock: number;
  stockNeedsReview: boolean;
  bufferReq: number;
  minProduction: number;
  maxProduction: number;
  pendingOrderLastMonth: number;
  pendingOrder: number;
  order: number;
  achievementPct: number | null;
  cover: number | "OS";
  week: 1 | 2 | 3 | 4 | null;
  w1: number;
  w2: number;
  w3: number;
  w4: number;
}

export interface CategorySummary {
  category: string;
  minTotal: number;
  maxTotal: number;
}

export interface PlanSummaryResult {
  categories: CategorySummary[];
  grandMinTotal: number;
  grandMaxTotal: number;
}

const round = (n: number): number => Math.round(n * 100) / 100;

export interface PendingPlanReconciliationItem {
  itemCode: string;
  colour: string;
  category: string;
  baseDemandBeforeCurrentPending: number;
  currentPending: number;
  unclampedBaseline: number;
  planWithoutCurrentPending: number;
  planWithCurrentPending: number;
  pendingContribution: number;
  pendingLostToClamping: number;
}

export interface PendingPlanReconciliationCategory {
  category: string;
  itemCount: number;
  currentPending: number;
  pendingContribution: number;
  pendingLostToClamping: number;
}

export interface PendingPlanReconciliation {
  sourcePendingTotal: number;
  matchedPendingTotal: number;
  unmatchedPendingTotal: number;
  planMovement: number;
  clampLoss: number;
  unexplainedResidual: number;
  clampedItemCount: number;
  categories: PendingPlanReconciliationCategory[];
  clampedItems: PendingPlanReconciliationItem[];
}

/**
 * Reconcile the current-pending contribution to a plan without re-running any
 * source reads. The plan formula applies max(..., 0) per item, so the only
 * legitimate difference between matched pending and plan movement is pending
 * attached to an item whose pre-pending demand is negative.
 *
 * `matchedPendingTotal` and `unmatchedPendingTotal` come from the pending
 * coverage join. Keeping them separate prevents unmatched report rows from
 * being mistaken for a planning clamp.
 */
export function reconcilePendingPlan(
  items: CalcPlanItem[],
  sourcePendingTotal: number,
  matchedPendingTotal: number,
  unmatchedPendingTotal: number,
): PendingPlanReconciliation {
  const reconciliationItems = items.map((item): PendingPlanReconciliationItem => {
    const baseDemandBeforeCurrentPending = round(
      item.bufferReq - item.stock + item.pendingOrderLastMonth,
    );
    const planWithoutCurrentPending = round(Math.max(baseDemandBeforeCurrentPending, 0));
    const unclampedBaseline = round(baseDemandBeforeCurrentPending + item.pendingOrder);
    const planWithCurrentPending = round(item.maxProduction);
    const pendingContribution = round(planWithCurrentPending - planWithoutCurrentPending);
    const pendingLostToClamping = round(item.pendingOrder - pendingContribution);

    return {
      itemCode: item.itemCode,
      colour: item.colour,
      category: item.category,
      baseDemandBeforeCurrentPending,
      currentPending: round(item.pendingOrder),
      unclampedBaseline,
      planWithoutCurrentPending,
      planWithCurrentPending,
      pendingContribution,
      pendingLostToClamping,
    };
  });

  const categories = new Map<string, PendingPlanReconciliationCategory>();
  for (const item of reconciliationItems) {
    const category = categories.get(item.category) ?? {
      category: item.category,
      itemCount: 0,
      currentPending: 0,
      pendingContribution: 0,
      pendingLostToClamping: 0,
    };
    category.itemCount += 1;
    category.currentPending = round(category.currentPending + item.currentPending);
    category.pendingContribution = round(category.pendingContribution + item.pendingContribution);
    category.pendingLostToClamping = round(category.pendingLostToClamping + item.pendingLostToClamping);
    categories.set(item.category, category);
  }

  const planMovement = round(
    reconciliationItems.reduce((sum, item) => sum + item.pendingContribution, 0),
  );
  const clampLoss = round(
    reconciliationItems.reduce((sum, item) => sum + item.pendingLostToClamping, 0),
  );

  return {
    sourcePendingTotal: round(sourcePendingTotal),
    matchedPendingTotal: round(matchedPendingTotal),
    unmatchedPendingTotal: round(unmatchedPendingTotal),
    planMovement,
    clampLoss,
    unexplainedResidual: round(matchedPendingTotal - planMovement - clampLoss),
    clampedItemCount: reconciliationItems.filter((item) => item.pendingLostToClamping > 0).length,
    categories: [...categories.values()],
    clampedItems: reconciliationItems
      .filter((item) => item.pendingLostToClamping > 0)
      .sort((a, b) => b.pendingLostToClamping - a.pendingLostToClamping),
  };
}

/**
 * Computes a single item's production plan line.
 *
 * Formula (identical for all categories — PTMT, CPVC, UPVC, SWR, AGRI):
 *
 *   MaxProduction = max((BufferReq − Stock) + PendingOrderLastMonth + PendingOrder, 0)
 *
 * The per-item max(…, 0) clamp means items with negative production required
 * contribute 0 to their category total — which is mathematically equivalent to
 * "sum only the positive items" (as the master SUMIFS does for SWR / AGRI).
 *
 * Common to all categories:
 *   Avg3MoSale    = sum(last 3 months sale) / 3
 *   BufferReq     = Avg3MoSale × bufferMultiplier
 *   MinProduction = max(Avg3MoSale − Stock, 0)
 *   Cover         = Stock / Avg3MoSale (months of cover); "OS" when Avg3MoSale = 0.
 *   Order is a separate live order-book figure and is NOT included in MaxProduction.
 *
 * Buffer multipliers by material (applied/default):
 *   CPVC 1.5 × UPVC 1.5 × AGRI 1.5 × SWR 1.0
 *   These are stored in buffer_categories.multiplier and are editable per category.
 */
export function computeItemPlan(
  source: ItemSourceRow,
  category: string,
  bufferMultiplier: number,
): CalcPlanItem {
  const avg3MoSale = round(source.avg3MoSaleTotal3Mo / 3);
  const bufferReq = round(avg3MoSale * bufferMultiplier);
  const minProduction = round(Math.max(avg3MoSale - source.stock, 0));
  const maxProduction = round(
    Math.max(bufferReq - source.stock + source.pendingOrderLastMonth + source.pendingOrder, 0),
  );
  const cover: number | "OS" = avg3MoSale > 0 ? round(source.stock / avg3MoSale) : "OS";

  return {
    itemCode: source.itemCode,
    colour: source.colour,
    category,
    avg3MoSale,
    stock: source.stock,
    stockNeedsReview: source.stockNeedsReview,
    bufferReq,
    minProduction,
    maxProduction,
    pendingOrderLastMonth: source.pendingOrderLastMonth,
    pendingOrder: source.pendingOrder,
    order: source.order,
    achievementPct: null,
    cover,
    week: null,
    w1: 0,
    w2: 0,
    w3: 0,
    w4: 0,
  };
}

/**
 * Annotates items in-place with week assignments and W1–W4 quantities.
 * Uses half-open bands: W1 = [0, w1Upper), W2 = [w1Upper, w2Upper), ...
 * Items with cover = "OS", plan ≤ 0, or cover ≥ w4Upper are left unscheduled (week = null).
 */
export function annotateWeeklyRelease(
  items: CalcPlanItem[],
  bandsByCategory: Map<string, WeeklyBandConfig>,
): void {
  for (const item of items) {
    if (item.maxProduction <= 0 || item.cover === "OS") continue;
    const band = bandsByCategory.get(item.category);
    if (!band) continue;

    const c = item.cover as number;
    let week: 1 | 2 | 3 | 4 | null = null;
    if (c < band.w1Upper) week = 1;
    else if (c < band.w2Upper) week = 2;
    else if (c < band.w3Upper) week = 3;
    else if (c < band.w4Upper) week = 4;

    item.week = week;
    item.w1 = week === 1 ? item.maxProduction : 0;
    item.w2 = week === 2 ? item.maxProduction : 0;
    item.w3 = week === 3 ? item.maxProduction : 0;
    item.w4 = week === 4 ? item.maxProduction : 0;
  }
}

export function summarizePlan(items: CalcPlanItem[]): PlanSummaryResult {
  const byCategory = new Map<string, CategorySummary>();
  for (const item of items) {
    const existing = byCategory.get(item.category) ?? { category: item.category, minTotal: 0, maxTotal: 0 };
    existing.minTotal += item.minProduction;
    existing.maxTotal += item.maxProduction;
    byCategory.set(item.category, existing);
  }
  const categories = [...byCategory.values()].map((c) => ({
    category: c.category,
    minTotal: round(c.minTotal),
    maxTotal: round(c.maxTotal),
  }));
  const grandMinTotal = round(categories.reduce((sum, c) => sum + c.minTotal, 0));
  const grandMaxTotal = round(categories.reduce((sum, c) => sum + c.maxTotal, 0));
  return { categories, grandMinTotal, grandMaxTotal };
}
