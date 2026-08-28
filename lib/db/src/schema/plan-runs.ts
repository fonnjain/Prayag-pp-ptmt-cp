import { pgTable, serial, text, real, timestamp, jsonb, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const planRunsTable = pgTable("plan_runs", {
  id: serial("id").primaryKey(),
  segment: text("segment").notNull().default("PTMT"),
  month: text("month").notNull(),
  planType: text("plan_type").notNull().default("production"),
  temporaryRunId: integer("temporary_run_id"),
  effectiveFrom: text("effective_from"),
  asOfAt: timestamp("as_of_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("draft"),
  weeklyReleaseVersion: integer("weekly_release_version").notNull().default(0),
  factorsJson: jsonb("factors_json").notNull().$type<Record<string, number>>().default({}),
  note: text("note"),
  planStatusReason: text("plan_status_reason"),
  pass2Json: jsonb("pass2_json").$type<Record<string, unknown> | null>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const planRunInputsTable = pgTable("plan_run_inputs", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => planRunsTable.id, { onDelete: "cascade" }),
  itemCode: text("item_code").notNull(),
  colour: text("colour").notNull(),
  avg3MoSale: real("avg_3mo_sale").notNull().default(0),
  stock: real("stock").notNull().default(0),
  pendingCurrent: real("pending_current").notNull().default(0),
  pendingLastMonth: real("pending_last_month").notNull().default(0),
});

export const planRunResultsTable = pgTable("plan_run_results", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => planRunsTable.id, { onDelete: "cascade" }),
  itemCode: text("item_code").notNull(),
  colour: text("colour").notNull(),
  category: text("category").notNull(),
  bufferReq: real("buffer_req"),
  minProduction: real("min_production").notNull().default(0),
  // Demand remains frozen separately from the executable production plan.
  // For Temporary runs both values are equal; for fitted Production runs
  // productionPlan is fitted output and demandPlan is the owed quantity.
  demandPlan: real("demand_plan").notNull().default(0),
  productionPlan: real("production_plan").notNull().default(0),
  temporaryPlan: real("temporary_plan").notNull().default(0),
  cannotBeMade: real("cannot_be_made").notNull().default(0),
  feasibilityStatus: text("feasibility_status").notNull().default("not-scheduled"),
  material: text("material"),
  weightKg: real("weight_kg"),
  urgencyRank: integer("urgency_rank"),
  releaseWeek: integer("release_week"),
  w1: real("w1").notNull().default(0),
  w2: real("w2").notNull().default(0),
  w3: real("w3").notNull().default(0),
  w4: real("w4").notNull().default(0),
});

export const pendingSnapshotsTable = pgTable("pending_snapshots", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => planRunsTable.id, { onDelete: "cascade" }),
  catNo: text("cat_no").notNull(),
  colour: text("colour").notNull(),
  qty: real("qty").notNull().default(0),
});

export const planRunInputSnapshotsTable = pgTable("plan_run_input_snapshots", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .notNull()
    .references(() => planRunsTable.id, { onDelete: "cascade" }),
  segment: text("segment").notNull(),
  sourceRole: text("source_role").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceUploadId: integer("source_upload_id"),
  sourceFilename: text("source_filename"),
  sourceUploadedAt: timestamp("source_uploaded_at", { withTimezone: true }),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  rawRowsJson: jsonb("raw_rows_json").notNull().$type<Record<string, unknown>[]>(),
  parsedRowsJson: jsonb("parsed_rows_json").notNull().$type<Array<{
    itemCode: string;
    colour: string;
    qty: number;
  }>>(),
  diagnosticsJson: jsonb("diagnostics_json").notNull().$type<Record<string, unknown>>(),
}, (table) => [
  uniqueIndex("plan_run_input_snapshots_run_role_idx").on(table.runId, table.sourceRole),
]);

export const pendingReadSnapshotsTable = pgTable("pending_read_snapshots", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .references(() => planRunsTable.id, { onDelete: "cascade" }),
  captureContext: text("capture_context").notNull(),
  segment: text("segment").notNull(),
  sourceRole: text("source_role").notNull().default("pending_current_live"),
  sourceKind: text("source_kind").notNull(),
  sourceName: text("source_name").notNull(),
  sourceSpreadsheetId: text("source_spreadsheet_id"),
  sourceTabName: text("source_tab_name"),
  environment: text("environment").notNull().default("development"),
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("captured"),
  rawRowsJson: jsonb("raw_rows_json").notNull().$type<Record<string, unknown>[]>().default([]),
  parsedRowsJson: jsonb("parsed_rows_json").notNull().$type<Record<string, unknown>[]>().default([]),
  diagnosticsJson: jsonb("diagnostics_json").notNull().$type<Record<string, unknown>>().default({}),
  errorText: text("error_text"),
}, (table) => [
  index("pending_read_snapshots_run_id_idx").on(table.runId),
  index("pending_read_snapshots_segment_captured_idx").on(table.segment, table.capturedAt),
]);

export const pendingReadBaselinesTable = pgTable("pending_read_baselines", {
  id: serial("id").primaryKey(),
  baselineKey: text("baseline_key").notNull().unique(),
  segment: text("segment").notNull(),
  sourceRole: text("source_role").notNull(),
  status: text("status").notNull(),
  captureId: integer("capture_id").references(() => pendingReadSnapshotsTable.id),
  environment: text("environment").notNull(),
  sourceKind: text("source_kind").notNull(),
  sourceName: text("source_name").notNull(),
  sourceSpreadsheetId: text("source_spreadsheet_id"),
  sourceTabName: text("source_tab_name"),
  observedAt: timestamp("observed_at", { withTimezone: true }),
  sourceQuantity: real("source_quantity").notNull(),
  joinedQuantity: real("joined_quantity").notNull(),
  explainedExclusionQuantity: real("explained_exclusion_quantity").notNull(),
  unexplainedResidual: real("unexplained_residual").notNull(),
  unmatchedQuantity: real("unmatched_quantity").notNull(),
  resolutionLossQuantity: real("resolution_loss_quantity").notNull(),
  fingerprint: text("fingerprint"),
  rationale: text("rationale").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertPlanRunSchema = createInsertSchema(planRunsTable).omit({
  id: true,
  asOfAt: true,
  createdAt: true,
});
export type InsertPlanRun = z.infer<typeof insertPlanRunSchema>;
export type PlanRun = typeof planRunsTable.$inferSelect;
export type PlanRunInput = typeof planRunInputsTable.$inferSelect;
export type PlanRunResult = typeof planRunResultsTable.$inferSelect;
export type PendingSnapshot = typeof pendingSnapshotsTable.$inferSelect;
export type PlanRunInputSnapshot = typeof planRunInputSnapshotsTable.$inferSelect;
export type PendingReadSnapshot = typeof pendingReadSnapshotsTable.$inferSelect;
export type PendingReadBaseline = typeof pendingReadBaselinesTable.$inferSelect;
