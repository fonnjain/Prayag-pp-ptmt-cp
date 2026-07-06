import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const monitoringThresholdsTable = pgTable("monitoring_thresholds", {
  code: text("code").primaryKey(),
  thresholdJson: jsonb("threshold_json").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const insertMonitoringThresholdSchema = createInsertSchema(monitoringThresholdsTable).omit({
  updatedAt: true,
});
export type InsertMonitoringThreshold = z.infer<typeof insertMonitoringThresholdSchema>;
export type MonitoringThreshold = typeof monitoringThresholdsTable.$inferSelect;
