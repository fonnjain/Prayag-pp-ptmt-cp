import {
  pgTable,
  bigserial,
  bigint,
  text,
  integer,
  jsonb,
  boolean,
  timestamp,
  date,
  unique,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { planRuns } from "./plan";

export const importBatches = pgTable(
  "import_batches",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    division: text("division"),
    dataType: text("data_type"),
    planMonth: date("plan_month"),
    sourceFileId: text("source_file_id"),
    contentHash: text("content_hash"),
    rowsAdded: integer("rows_added"),
    rowsUpdated: integer("rows_updated"),
    rowsSkipped: integer("rows_skipped"),
    rowsRejected: integer("rows_rejected"),
    sanityVerdict: text("sanity_verdict"),
    sanitySummary: text("sanity_summary"),
    // Provenance of the model ACTUALLY used by the (deep) sanity call — kept on
    // the batch so the PDF footer can show it even when Claude returns zero
    // findings (no per-finding provenance row to read from).
    sanityModel: text("sanity_model"),
    sanityTier: text("sanity_tier"),
    sanityDowngraded: boolean("sanity_downgraded").default(false),
    acknowledged: boolean("acknowledged").default(false),
    pulledBy: text("pulled_by"),
    pulledAt: timestamp("pulled_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    unique("import_batches_uq").on(
      t.division,
      t.dataType,
      t.planMonth,
      t.contentHash,
    ),
  ],
);

export const validationFindings = pgTable(
  "validation_findings",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    importBatchId: bigint("import_batch_id", { mode: "number" }).references(
      () => importBatches.id,
      { onDelete: "cascade" },
    ),
    severity: text("severity"),
    type: text("type"),
    message: text("message"),
    detail: jsonb("detail"),
    source: text("source"),
    model: text("model"),
    tier: text("tier"),
    downgraded: boolean("downgraded").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [
    index("ix_findings_batch").on(t.importBatchId),
    check(
      "findings_severity_chk",
      sql`${t.severity} in ('info','warning','blocker')`,
    ),
  ],
);

// one-time legacy import guard
export const importLedger = pgTable(
  "import_ledger",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    source: text("source").notNull(),
    scope: text("scope").notNull(),
    doneAt: timestamp("done_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [unique("import_ledger_uq").on(t.source, t.scope)],
);

// generated reports (PDF) provenance
export const reports = pgTable("reports", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  planRunId: bigint("plan_run_id", { mode: "number" }).references(
    () => planRuns.id,
    { onDelete: "cascade" },
  ),
  periodType: text("period_type"),
  model: text("model"),
  tier: text("tier"),
  downgraded: boolean("downgraded").default(false),
  pdfPath: text("pdf_path"),
  summary: text("summary"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export type ImportBatch = typeof importBatches.$inferSelect;
export type ValidationFinding = typeof validationFindings.$inferSelect;
export type ImportLedger = typeof importLedger.$inferSelect;
export type Report = typeof reports.$inferSelect;
