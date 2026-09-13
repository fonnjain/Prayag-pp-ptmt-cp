import { pgTable, serial, integer, text, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { planRunsTable } from "./plan-runs";

/**
 * Durable MB.1 idempotency/audit record.  Request and response JSON are
 * intentionally retained independently: a successful Pipe call must remain
 * inspectable even when Fitting subsequently fails.
 */
export const plumbingFitAttemptsTable = pgTable("plumbing_fit_attempts", {
  id: serial("id").primaryKey(),
  sourceRunId: integer("source_run_id")
    .notNull()
    .references(() => planRunsTable.id, { onDelete: "cascade" }),
  requestFingerprint: text("request_fingerprint").notNull(),
  state: text("state").notNull().default("running"),
  failedKind: text("failed_kind"),
  errorText: text("error_text"),
  pipeRequestedAt: timestamp("pipe_requested_at", { withTimezone: true }),
  pipeRespondedAt: timestamp("pipe_responded_at", { withTimezone: true }),
  fittingRequestedAt: timestamp("fitting_requested_at", { withTimezone: true }),
  fittingRespondedAt: timestamp("fitting_responded_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  pipeRequestJson: jsonb("pipe_request_json").$type<Record<string, unknown> | null>(),
  pipeResponseJson: jsonb("pipe_response_json").$type<Record<string, unknown> | null>(),
  fittingRequestJson: jsonb("fitting_request_json").$type<Record<string, unknown> | null>(),
  fittingResponseJson: jsonb("fitting_response_json").$type<Record<string, unknown> | null>(),
  warningsJson: jsonb("warnings_json").$type<string[] | null>(),
  summaryJson: jsonb("summary_json").$type<Record<string, unknown> | null>(),
  productionRunId: integer("production_run_id").references(() => planRunsTable.id, { onDelete: "set null" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("plumbing_fit_attempts_fingerprint_idx")
    .on(table.requestFingerprint)
    .where(sql`state <> 'abandoned'`),
  index("plumbing_fit_attempts_source_run_idx").on(table.sourceRunId),
]);

export type PlumbingFitAttempt = typeof plumbingFitAttemptsTable.$inferSelect;