import { pgTable, serial, integer, text, jsonb, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Immutable target allocation captured when a plan variant is created.
 *
 * The source tables remain the audit authority for their own inputs, while this
 * table preserves the monitoring-ready item and week allocation that was in
 * force. A source can never silently acquire today's live weekly allocation.
 */
export const plantPlanVersionsTable = pgTable(
  "plant_plan_versions",
  {
    id: serial("id").primaryKey(),
    month: text("month").notNull(),
    segment: text("segment").notNull().default("PTMT"),
    kind: text("kind").notNull(),
    sourceId: integer("source_id").notNull(),
    effectiveFrom: text("effective_from").notNull(),
    sourceLabel: text("source_label"),
    targetsJson: jsonb("targets_json").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("plant_plan_versions_source_unique").on(table.kind, table.sourceId)],
);

export type PlantPlanVersion = typeof plantPlanVersionsTable.$inferSelect;