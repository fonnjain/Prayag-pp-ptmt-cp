import { pgTable, serial, text, real, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bufferCategoriesTable = pgTable("buffer_categories", {
  id: serial("id").primaryKey(),
  segment: text("segment").notNull().default("PTMT"),
  name: text("name").notNull(),
  multiplier: real("multiplier").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  suggestedMultiplier: real("suggested_multiplier"),
  overrideMultiplier: real("override_multiplier"),
  cvValue: real("cv_value"),
  volatilityClass: text("volatility_class"),
  avgMonth: real("avg_month"),
  peakMonth: text("peak_month"),
  peakIndex: real("peak_index"),
  yoy: real("yoy"),
  signal: text("signal"),
  seasonalIndices: text("seasonal_indices"),
  lastComputedAt: timestamp("last_computed_at", { withTimezone: true }),
  dataQuality: text("data_quality"),
  zScore: real("z_score"),
  reliabilityFlag: text("reliability_flag"),
}, (table) => [unique("buffer_categories_segment_name_unique").on(table.segment, table.name)]);

export const insertBufferCategorySchema = createInsertSchema(bufferCategoriesTable).omit({
  id: true,
  updatedAt: true,
});
export type InsertBufferCategory = z.infer<typeof insertBufferCategorySchema>;
export type BufferCategory = typeof bufferCategoriesTable.$inferSelect;
