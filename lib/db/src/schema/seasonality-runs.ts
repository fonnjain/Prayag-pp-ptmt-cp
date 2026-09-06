import { pgTable, serial, text, timestamp, jsonb, unique } from "drizzle-orm/pg-core";

export const seasonalityRunsTable = pgTable("seasonality_runs", {
  id: serial("id").primaryKey(),
  month: text("month").notNull(),
  segment: text("segment").notNull(),
  engineKind: text("engine_kind").notNull(),
  status: text("status").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  details: jsonb("details").notNull().$type<Record<string, unknown>>().default({}),
}, (table) => [
  unique("seasonality_runs_month_segment_engine_unique").on(table.month, table.segment, table.engineKind),
]);

export type SeasonalityRun = typeof seasonalityRunsTable.$inferSelect;