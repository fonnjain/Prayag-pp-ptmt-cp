import { pgTable, serial, text, real, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const categoryCapacityTable = pgTable("category_capacity", {
  id: serial("id").primaryKey(),
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
  lastComputedAt: timestamp("last_computed_at").notNull().defaultNow(),
});

export const insertCategoryCapacitySchema = createInsertSchema(categoryCapacityTable).omit({ id: true });
export const selectCategoryCapacitySchema = createSelectSchema(categoryCapacityTable);

export type CategoryCapacity = typeof categoryCapacityTable.$inferSelect;
export type InsertCategoryCapacity = typeof categoryCapacityTable.$inferInsert;
