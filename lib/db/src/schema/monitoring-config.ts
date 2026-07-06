import { pgTable, text, integer, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const monitoringConfigTable = pgTable("monitoring_config", {
  month: text("month").primaryKey(),
  workingDays: integer("working_days").notNull().default(27),
  shiftsPerDay: integer("shifts_per_day").notNull().default(2),
  shiftHours: integer("shift_hours").notNull().default(12),
  snapshotDate: text("snapshot_date"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertMonitoringConfigSchema = createInsertSchema(monitoringConfigTable).omit({
  updatedAt: true,
});
export type InsertMonitoringConfig = z.infer<typeof insertMonitoringConfigSchema>;
export type MonitoringConfig = typeof monitoringConfigTable.$inferSelect;
