import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { planRunsTable } from "./plan-runs";

export const plantMonitoringSnapshotsTable = pgTable("plant_monitoring_snapshots", {
  month: text("month").primaryKey(),
  planRunId: integer("plan_run_id").references(() => planRunsTable.id),
  actualsJson: jsonb("actuals_json").notNull().default([]),
  targetsJson: jsonb("targets_json").notNull().default([]),
  bundleJson: jsonb("bundle_json").notNull().default({}),
  weeklyJson: jsonb("weekly_json").notNull().default({}),
  sourceInfoJson: jsonb("source_info_json").notNull().default({}),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlantMonitoringSnapshotSchema = createInsertSchema(plantMonitoringSnapshotsTable).omit({ capturedAt: true });
export type InsertPlantMonitoringSnapshot = z.infer<typeof insertPlantMonitoringSnapshotSchema>;
export type PlantMonitoringSnapshot = typeof plantMonitoringSnapshotsTable.$inferSelect;