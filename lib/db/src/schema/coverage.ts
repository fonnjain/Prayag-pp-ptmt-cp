import {
  pgTable,
  bigserial,
  text,
  date,
  jsonb,
  boolean,
  timestamp,
  unique,
  index,
} from "drizzle-orm/pg-core";

// Advisory "fuzzy coverage" review runs. The deterministic content-sanity gate
// lives on import_batches/validation_findings; THIS is a separate, strictly
// advisory layer (Drive-folder scan + expected-vs-found reconciliation) that
// never changes the plan gate and never auto-expands ingestion scope.
export const coverageRuns = pgTable(
  "coverage_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    division: text("division").notNull(),
    planMonth: date("plan_month").notNull(),
    model: text("model"),
    tier: text("tier"),
    looksComplete: boolean("looks_complete").default(false),
    notes: text("notes"),
    // { stale_or_partial: [...], drift: [...], unaccounted_files: [...] }
    payload: jsonb("payload"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [index("ix_coverage_runs_scope").on(t.division, t.planMonth)],
);

// Human "this is not a source we should ingest" decisions, so a dismissed
// unaccounted candidate stops resurfacing on every subsequent scan.
export const coverageDismissals = pgTable(
  "coverage_dismissals",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    division: text("division").notNull(),
    fileId: text("file_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => [unique("coverage_dismissals_uq").on(t.division, t.fileId)],
);

export type CoverageRun = typeof coverageRuns.$inferSelect;
export type CoverageDismissal = typeof coverageDismissals.$inferSelect;
