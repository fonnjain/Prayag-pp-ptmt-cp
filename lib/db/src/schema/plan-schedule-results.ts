import { pgTable, serial, text, real, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { planRunsTable } from "./plan-runs";

export const planScheduleResultsTable = pgTable("plan_schedule_results", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  runId: integer("run_id")
    .notNull()
    .references(() => planRunsTable.id, { onDelete: "cascade" }),
  month: text("month").notNull(),
  segment: text("segment").notNull(),
  kind: text("kind").notNull(),
  weekDays: integer("week_days").array().notNull(),
  requestJson: jsonb("request_json").notNull().$type<Record<string, unknown>>(),
  resultJson: jsonb("result_json").notNull().$type<Record<string, unknown>>(),
  demandPieces: real("demand_pieces").notNull().default(0),
  demandKg: real("demand_kg"),
  scheduledPieces: real("scheduled_pieces").notNull().default(0),
  scheduledKg: real("scheduled_kg"),
  unfinishedPieces: real("unfinished_pieces").notNull().default(0),
  unfinishedKg: real("unfinished_kg").notNull().default(0),
  unfinishedHours: real("unfinished_hours").notNull().default(0),
  capacityHours: real("capacity_hours").notNull().default(0),
  scheduledHours: real("scheduled_hours").notNull().default(0),
  idleHours: real("idle_hours").notNull().default(0),
  downtimeHoursLost: real("downtime_hours_lost").notNull().default(0),
  downtimeMachineDays: real("downtime_machine_days").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PlanScheduleResult = typeof planScheduleResultsTable.$inferSelect;