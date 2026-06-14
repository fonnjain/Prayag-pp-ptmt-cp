import {
  pgTable,
  bigserial,
  bigint,
  text,
  numeric,
  date,
  integer,
  boolean,
  jsonb,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";

export const planRuns = pgTable(
  "plan_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    division: text("division").notNull(),
    planMonth: date("plan_month").notNull(),
    version: integer("version").notNull(),
    workingDays: integer("working_days"),
    multiplierMin: numeric("multiplier_min"),
    multiplierMax: numeric("multiplier_max"),
    multiplierMode: text("multiplier_mode"),
    params: jsonb("params"),
    reportModel: text("report_model"),
    reportTier: text("report_tier"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [unique("plan_runs_uq").on(t.division, t.planMonth, t.version)],
);

export const planLines = pgTable(
  "plan_lines",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    planRunId: bigint("plan_run_id", { mode: "number" })
      .notNull()
      .references(() => planRuns.id, { onDelete: "cascade" }),
    itemCode: text("item_code"),
    colour: text("colour").default(""),
    model: text("model"),
    category: text("category"),
    report: text("report"),
    last3Sale: numeric("last3_sale"),
    runRate: numeric("run_rate"),
    lastMonthSale: numeric("last_month_sale"),
    avgSaleAnnual: numeric("avg_sale_annual"),
    sale2m: numeric("sale_2m"),
    sale10m: numeric("sale_10m"),
    pendingCurrent: numeric("pending_current"),
    pendingLast: numeric("pending_last"),
    openingStock: numeric("opening_stock"),
    multiplier: numeric("multiplier"),
    bufferTarget: numeric("buffer_target"),
    minRequired: numeric("min_required"),
    maxRequired: numeric("max_required"),
    orderAsOn: numeric("order_as_on"),
    productionAsOn: numeric("production_as_on"),
    productionLeft: numeric("production_left"),
    coveragePct: numeric("coverage_pct"),
    urgentFlag: boolean("urgent_flag"),
    valueAmount: numeric("value_amount"),
  },
  (t) => [index("ix_planlines_run").on(t.planRunId)],
);

export type PlanRun = typeof planRuns.$inferSelect;
export type InsertPlanRun = typeof planRuns.$inferInsert;
export type PlanLine = typeof planLines.$inferSelect;
export type InsertPlanLine = typeof planLines.$inferInsert;
