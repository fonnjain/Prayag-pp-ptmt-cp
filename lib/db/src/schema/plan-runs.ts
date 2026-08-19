import { pgTable, serial, text, real, timestamp, jsonb, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const planRunsTable = pgTable("plan_runs", {
  id: serial("id").primaryKey(),
  segment: text("segment").notNull().default("PTMT"),
  month: text("month").notNull(),
  effectiveFrom: text("effective_from"),
  asOfAt: timestamp("as_of_at", { withTimezone: true }).notNull().defaultNow(),
  status: text("status").notNull().default("draft"),
  factorsJson: jsonb("factors_json").notNull().$type<Record<string, number>>().default({}),
  note: text("note"),
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
  bufferReq: real("buffer_req").notNull().default(0),
  minProduction: real("min_production").notNull().default(0),
  productionPlan: real("production_plan").notNull().default(0),
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
