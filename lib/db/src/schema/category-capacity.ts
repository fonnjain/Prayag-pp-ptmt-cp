import { pgTable, serial, text, real, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export type CapacityWindowStats = {
  startDate: string;
  endDate: string;
  daysObserved: number;
  meanPerDay: number;
  p90PerDay: number;
  bestDay: number;
};

export type CapacityMonthlyStats = CapacityWindowStats & { month: string };

export type CapacityComparison = {
  fullWindow: CapacityWindowStats;
  recent90d: CapacityWindowStats;
  monthly: CapacityMonthlyStats[];
  /** Endpoint change from the first positive-production month to the latest. */
  driftPct: number | null;
  /** Recovery/range signal from the minimum positive monthly p90 to the latest. */
  recoveryDriftPct: number | null;
  /** Population coefficient of variation across positive monthly p90s, expressed as a percentage. */
  monthlyP90CvPct: number | null;
  latestMonthlyP90: number | null;
  minPositiveMonthlyP90: number | null;
  /** Months with no positive-production observations; not capacity zeros. */
  zeroProductionMonths: string[];
};

export const categoryCapacityTable = pgTable("category_capacity", {
  id: serial("id").primaryKey(),
  segment: text("segment").notNull().default("PTMT"),
  category: text("category").notNull().unique(),
  meanPerDay: real("mean_per_day").notNull().default(0),
  p90PerDay: real("p90_per_day").notNull().default(0),
  bestDay: real("best_day").notNull().default(0),
  daysObserved: integer("days_observed").notNull().default(0),
  trailingDays: integer("trailing_days").notNull().default(90),
  isThinData: integer("is_thin_data").notNull().default(0),
  suggestedCapacity: real("suggested_capacity").notNull().default(0),
  overrideCapacity: real("override_capacity"),
  workingDaysPerWeek: integer("working_days_per_week").notNull().default(6),
  planNeedsPerDay: real("plan_needs_per_day").notNull().default(0),
  windowStartDate: text("window_start_date"),
  windowEndDate: text("window_end_date"),
  comparisonJson: jsonb("comparison_json").$type<CapacityComparison | null>(),
  lastComputedAt: timestamp("last_computed_at").notNull().defaultNow(),
});

export const insertCategoryCapacitySchema = createInsertSchema(categoryCapacityTable).omit({ id: true });
export const selectCategoryCapacitySchema = createSelectSchema(categoryCapacityTable);

export type CategoryCapacity = typeof categoryCapacityTable.$inferSelect;
export type InsertCategoryCapacity = typeof categoryCapacityTable.$inferInsert;
