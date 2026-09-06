import { pgTable, serial, text, real, timestamp, integer, unique } from "drizzle-orm/pg-core";

/**
 * Month-scoped PTMT seasonality output.
 *
 * `multiplier` is the effective value for this month/category row
 * (override when present, otherwise the engine suggestion). Temporary PTMT
 * Plans use this month-scoped value when it is available.
 */
export const ptmtBufferMultipliersTable = pgTable("ptmt_buffer_multipliers", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  category: text("category").notNull(),
  multiplier: real("multiplier"),
  suggestedMultiplier: real("suggested_multiplier"),
  overrideMultiplier: real("override_multiplier"),
  zScore: real("z_score"),
  cvValue: real("cv_value"),
  dataQuality: text("data_quality"),
  sourceObservations: integer("source_observations").notNull().default(0),
  lastComputedAt: timestamp("last_computed_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  unique("ptmt_buffer_multipliers_month_category_unique").on(table.month, table.category),
]);

export type PtmtBufferMultiplier = typeof ptmtBufferMultipliersTable.$inferSelect;