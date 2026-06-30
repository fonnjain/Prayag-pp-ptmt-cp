import {
  pgTable,
  bigserial,
  text,
  boolean,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// Machine Roster Reconciliation runs for the CP Pipe & Fitting plant.
// One row per month: stores the full reconciliation result (which machines
// appeared in Report-5, Report-11, Report-12 and where they diverge).
export const reconciliationRuns = pgTable(
  "reconciliation_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    month: text("month").notNull(), // "2026-06"
    status: text("status").notNull().default("ok"), // "ok" | "empty_pipe" | "error"
    pipeEmpty: boolean("pipe_empty").default(false),
    payload: jsonb("payload"),
    errorMsg: text("error_msg"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("ix_reconciliation_runs_month").on(t.month)],
);

export type ReconciliationRun = typeof reconciliationRuns.$inferSelect;
