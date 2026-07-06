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

/**
 * Computes a single item's production plan line.
 * Formulas (confirmed against PTMT_Production_Plan_July_2026 workbook):
 *   Avg3MoSale   = sum(last 3 months sale) / 3
 *   BufferReq    = Avg3MoSale * bufferMultiplier
 *   MinProduction = max(Avg3MoSale - Stock, 0)
 *   MaxProduction = max((BufferReq - Stock) + PendingOrderLastMonth + PendingOrder, 0)
 *   Order is a separate live order-book figure and is NOT part of the Max formula.
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
    // Actual production tracking is out of scope for the planning engine; always null.
    achievementPct: null,
  };
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
