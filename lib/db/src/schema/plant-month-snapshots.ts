import { pgTable, serial, text, jsonb, boolean, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/** Immutable, monitoring-ready response for a completed plant month. */
export const plantMonthSnapshotsTable = pgTable(
  "plant_month_snapshots",
  {
    id: serial("id").primaryKey(),
    month: text("month").notNull(),
    segment: text("segment").notNull().default("PTMT"),
    payloadJson: jsonb("payload_json").notNull(),
    sourcePlanVersionsJson: jsonb("source_plan_versions_json").notNull().default([]),
    closedAt: timestamp("closed_at", { withTimezone: true }).notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    capturedCommitSha: text("captured_commit_sha"),
    backfilled: boolean("backfilled").notNull().default(false),
    planStatus: text("plan_status").notNull().default("finalized"),
    planStatusReason: text("plan_status_reason"),
    planEvidenceJson: jsonb("plan_evidence_json").notNull().default({}),
  },
  (table) => [uniqueIndex("plant_month_snapshots_month_segment_unique").on(table.month, table.segment)],
);

export type PlantMonthSnapshot = typeof plantMonthSnapshotsTable.$inferSelect;