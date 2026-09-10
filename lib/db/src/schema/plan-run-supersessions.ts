import { pgTable, serial, integer, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { planRunsTable } from "./plan-runs";
import { usersTable } from "./users";

export const planRunSupersessionsTable = pgTable(
  "plan_run_supersessions",
  {
    id: serial("id").primaryKey(),
    month: text("month").notNull(),
    segment: text("segment").notNull(),
    productionRunId: integer("production_run_id")
      .notNull()
      .references(() => planRunsTable.id),
    temporaryRunId: integer("temporary_run_id")
      .notNull()
      .references(() => planRunsTable.id),
    reason: text("reason").notNull(),
    requestedByUserId: integer("requested_by_user_id")
      .notNull()
      .references(() => usersTable.id),
    requestedByEmail: text("requested_by_email").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    supersedingRunId: integer("superseding_run_id").references(() => planRunsTable.id),
  },
  (table) => [
    uniqueIndex("plan_run_supersessions_production_run_idx").on(table.productionRunId),
    index("plan_run_supersessions_month_segment_idx").on(table.month, table.segment),
  ],
);

export type PlanRunSupersession = typeof planRunSupersessionsTable.$inferSelect;