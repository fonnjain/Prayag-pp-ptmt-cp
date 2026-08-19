import { pgTable, serial, text, real, timestamp, jsonb, integer, boolean } from "drizzle-orm/pg-core";

export interface CorrectiveWeekStat {
  week: number;
  weekLabel: string;
  released: number;
  capacity: number;
  workingDays: number;
  produced: number;
  lag: number;
  loadFactor: number;
  status: "open" | "closed" | "future" | "unfulfillable";
}

export interface CorrectiveWarning {
  code: string;
  severity: "info" | "medium" | "high" | "critical";
  message: string;
  value?: number;
  threshold?: number;
  category?: string;
  items?: string[];
}

export const correctivePlanRunsTable = pgTable("corrective_plan_runs", {
  id: serial("id").primaryKey(),
  segment: text("segment").notNull().default("PTMT"),
  month: text("month").notNull(),
  effectiveFrom: text("effective_from"),
  weekClosed: integer("week_closed").notNull().default(0),
  dailyCapacity: real("daily_capacity").notNull().default(21335),
  workingDaysPerWeek: integer("working_days_per_week").notNull().default(6),
  producedToDate: real("produced_to_date").notNull().default(0),
  newOrdersQty: real("new_orders_qty").notNull().default(0),
  originalMonthTotal: real("original_month_total").notNull().default(0),
  revisedMonthTotal: real("revised_month_total").notNull().default(0),
  unfulfillableQty: real("unfulfillable_qty").notNull().default(0),
  // Per-category engine results (cap/feasible/shortfall + capacityMethod) as
  // computed at run time — exports MUST use these, never re-derive from the
  // category-capacity DB table (which can disagree with the engine's p90).
  categoriesJson: jsonb("categories_json").$type<unknown[]>(),
  // Working days remaining at run time (asOfDate-aware) — used by exports.
  workingDaysRemaining: integer("working_days_remaining"),
  weekStatsJson: jsonb("week_stats_json")
    .notNull()
    .$type<CorrectiveWeekStat[]>()
    .default([]),
  warningsJson: jsonb("warnings_json")
    .notNull()
    .$type<CorrectiveWarning[]>()
    .default([]),
  asOfDate: text("as_of_date"),
  // Immutable plan run this corrective run measured against (NULL = live rebuild baseline)
  planRunId: integer("plan_run_id"),
  note: text("note"),
  // SHA-256 of the full persisted run content (run fields + items + weekStats +
  // warnings). Used by the duplicate-run guard; NULL on legacy rows.
  fingerprint: text("fingerprint"),
  // Σ productionPlan from plan_run_results for the cited planRunId, captured at
  // run-creation time. Used by exports to cross-check the corrective baseline
  // against the original frozen plan (not against the same-source stored real).
  // NULL on legacy runs recorded before this column existed.
  frozenPlanGrandMax: integer("frozen_plan_grand_max"),
  // When true, the DELETE /corrective/runs/:id endpoint returns 409 instead of
  // deleting the run. Used to protect regression-suite golden runs from accidental
  // removal by the plant. Toggle via PATCH /corrective/runs/:id/pin.
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const correctivePlanItemsTable = pgTable("corrective_plan_items", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => correctivePlanRunsTable.id, { onDelete: "cascade" }),
  itemCode: text("item_code").notNull(),
  colour: text("colour").notNull(),
  category: text("category").notNull(),
  avg3MoSale: real("avg_3mo_sale").notNull().default(0),
  bufferMultiplier: real("buffer_multiplier").notNull().default(1),
  stockOpen: real("stock_open").notNull().default(0),
  producedToDate: real("produced_to_date").notNull().default(0),
  stockNow: real("stock_now").notNull().default(0),
  pendingAtPlan: real("pending_at_plan").notNull().default(0),
  pendingNow: real("pending_now").notNull().default(0),
  pendingLastMonth: real("pending_last_month").notNull().default(0),
  originalPlan: real("original_plan").notNull().default(0),
  originalWeek: integer("original_week"),
  bufferReqRev: real("buffer_req_rev").notNull().default(0),
  planRev: real("plan_rev").notNull().default(0),
  remainingToProduce: real("remaining_to_produce").notNull().default(0),
  kgRev: real("kg_rev").notNull().default(0),
  remainingKg: real("remaining_kg").notNull().default(0),
  deltaNewOrders: real("delta_new_orders").notNull().default(0),
  deltaProduction: real("delta_production").notNull().default(0),
  deltaNet: real("delta_net").notNull().default(0),
  coverNow: real("cover_now"),
  newWeek: integer("new_week"),
  w1Rev: real("w1_rev").notNull().default(0),
  w2Rev: real("w2_rev").notNull().default(0),
  w3Rev: real("w3_rev").notNull().default(0),
  w4Rev: real("w4_rev").notNull().default(0),
  status: text("status").notNull().default("on-plan"),
  isNewItem: integer("is_new_item").notNull().default(0),
});

export type CorrectivePlanRun = typeof correctivePlanRunsTable.$inferSelect;
export type CorrectivePlanItem = typeof correctivePlanItemsTable.$inferSelect;
