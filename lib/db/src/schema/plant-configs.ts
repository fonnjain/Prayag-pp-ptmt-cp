import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";

export const plantConfigsTable = pgTable("plant_configs", {
  month: text("month").primaryKey(),
  workingDays: integer("working_days"),
  shiftsPerDay: integer("shifts_per_day").notNull().default(2),
  shiftHours: integer("shift_hours").notNull().default(12),
  snapshotDate: text("snapshot_date"),
  thresholdsJson: jsonb("thresholds_json").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type PlantConfig = typeof plantConfigsTable.$inferSelect;
