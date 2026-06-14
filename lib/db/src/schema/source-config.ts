import { pgTable, bigserial, text, date, unique } from "drizzle-orm/pg-core";

// Google connector config (file IDs + tab patterns), incl. fiscal-year file rule
export const sourceConfig = pgTable(
  "source_config",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    division: text("division").notNull(),
    dataType: text("data_type").notNull(),
    fileId: text("file_id").notNull(),
    tabPattern: text("tab_pattern"),
    appliesFrom: date("applies_from"),
    appliesTo: date("applies_to"),
    notes: text("notes"),
  },
  (t) => [
    unique("source_config_uq").on(
      t.division,
      t.dataType,
      t.fileId,
      t.tabPattern,
    ),
  ],
);

export type SourceConfigRow = typeof sourceConfig.$inferSelect;
export type InsertSourceConfig = typeof sourceConfig.$inferInsert;
